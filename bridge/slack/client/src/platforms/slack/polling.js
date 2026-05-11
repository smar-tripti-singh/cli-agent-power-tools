const { WebClient } = require('@slack/web-api');
const { Platform } = require('../../core/platform');
const { SlackMessage } = require('./message');
const { make } = require('../../lib/logger');

const log = make('slack:polling');
const POLL_INTERVAL_MS = 10000;

class SlackPollingPlatform extends Platform {
  constructor() {
    super();
    this._client = null;
    this._pollTimer = null;
    this._botUserId = null;
    this._myUserId = null;
    this._channels = [];
    this._lastTs = {};
    this._processed = new Set();
    this._polling = false;
    this._dispatcher = null;
    this._config = null;
  }

  get name() { return 'slack:polling'; }

  isConfigured(config) {
    return !!config.slack?.botToken;
  }

  async start(config, dispatcher) {
    this._client = new WebClient(config.slack.botToken);
    this._myUserId = config.userId;
    this._dispatcher = dispatcher;
    this._config = config;

    const auth = await this._client.auth.test();
    this._botUserId = auth.user_id;

    this._channels = await this._discoverChannels();
    if (this._channels.length === 0) {
      log.warn('bot is not in any channels — invite with /invite @SmartBridge');
    } else {
      log.info('polling channels', { count: this._channels.length });
    }

    const now = String(Date.now() / 1000);
    for (const ch of this._channels) this._lastTs[ch] = now;

    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    this._poll();

    log.info('polling started');
  }

  async _discoverChannels() {
    try {
      const result = await this._client.conversations.list({
        types: 'public_channel,private_channel,im',
        limit: 200,
        exclude_archived: true,
      });
      return (result.channels || []).filter(c => c.is_member).map(c => c.id);
    } catch (err) {
      log.error('failed to list channels', { err: err.message });
      return [];
    }
  }

  async _poll() {
    if (this._polling) return;
    this._polling = true;
    try {
      for (const channel of this._channels) {
        await this._pollChannel(channel);
      }
    } catch (err) {
      if (err.data?.error === 'ratelimited') {
        log.warn('rate limited, backing off');
      } else {
        log.error('poll error', { err: err.message });
      }
    } finally {
      this._polling = false;
    }
  }

  async _pollChannel(channel) {
    const oldest = this._lastTs[channel];
    const result = await this._client.conversations.history({
      channel,
      oldest,
      limit: 50,
      inclusive: false,
    });

    for (const msg of (result.messages || []).reverse()) {
      this._lastTs[channel] = msg.ts;
      if (this._processed.has(msg.ts)) continue;
      if (msg.bot_id || msg.subtype) continue;
      if (!msg.text?.includes(`<@${this._botUserId}>`)) continue;
      if (this._myUserId && msg.user !== this._myUserId) continue;

      this._processed.add(msg.ts);
      this._cleanProcessed();

      const text = (msg.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text) continue;

      log.info('message received', { user: msg.user, channel });

      const slackMsg = new SlackMessage({
        client: this._client,
        event: { ...msg, channel, text },
        platform: 'slack:polling',
      });

      this._dispatcher.handle(slackMsg, this._config).catch(err => {
        log.error('dispatch error', { err: err.message });
      });
    }
  }

  _cleanProcessed() {
    if (this._processed.size > 1000) {
      this._processed = new Set(Array.from(this._processed).slice(-500));
    }
  }

  async stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    log.info('polling stopped');
  }
}

module.exports = { SlackPollingPlatform };
