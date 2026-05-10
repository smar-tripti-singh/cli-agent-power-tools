const { WebClient } = require('@slack/web-api');
const { Platform, Message } = require('../core/platform');
const { make } = require('../lib/logger');

const log = make('slack');
const SLACK_LIMIT = 3500;
const POLL_INTERVAL_MS = 10000;

function chunk(text) {
  if (text.length <= SLACK_LIMIT) return [text];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + SLACK_LIMIT, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > i + 500) end = nl;
    }
    parts.push(text.slice(i, end));
    i = end;
    while (i < text.length && text[i] === '\n') i++;
  }
  return parts.filter(Boolean);
}

class SlackMessage extends Message {
  constructor({ client, event, platform }) {
    super({
      text: (event.text || '').trim(),
      userId: event.user,
      userName: event.user,
      threadId: event.thread_ts || event.ts,
      channelId: event.channel,
      platform,
    });
    this._client = client;
    this._channel = event.channel;
    this._threadTs = event.thread_ts || event.ts;
  }

  async reply(text) {
    const parts = chunk(String(text || '(empty)'));
    for (const part of parts) {
      await this._client.chat.postMessage({
        channel: this._channel,
        thread_ts: this._threadTs,
        text: part,
        mrkdwn: true,
      });
    }
  }

  async postStatus(text) {
    try {
      const res = await this._client.chat.postMessage({
        channel: this._channel,
        thread_ts: this._threadTs,
        text,
        mrkdwn: true,
      });
      this._statusMessageId = res.ts;
    } catch (err) {
      log.error('postStatus failed', { err: err.message, channel: this._channel });
    }
  }

  async updateStatus(text) {
    if (!this._statusMessageId) return;
    try {
      await this._client.chat.update({
        channel: this._channel,
        ts: this._statusMessageId,
        text,
        mrkdwn: true,
      });
    } catch {}
  }
}

class SlackPlatform extends Platform {
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
  }

  get name() { return 'slack'; }

  isConfigured(config) {
    return !!config.slack?.botToken;
  }

  async start(config, dispatcher) {
    const { botToken } = config.slack;
    this._myUserId = config.userId;
    this._dispatcher = dispatcher;
    this._config = config;

    this._client = new WebClient(botToken);

    const auth = await this._client.auth.test();
    this._botUserId = auth.user_id;

    this._channels = await this._discoverChannels();

    if (this._channels.length === 0) {
      log.warn('bot is not in any channels — invite it with /invite @SmartBridge');
    } else {
      log.info('polling channels', { count: this._channels.length, channels: this._channels });
    }

    // Set high-water mark to now (only process new messages from this point)
    const now = String(Date.now() / 1000);
    for (const ch of this._channels) {
      this._lastTs[ch] = now;
    }

    // Start polling
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    this._poll();

    log.info('slack connected via polling');
  }

  async _discoverChannels() {
    try {
      const result = await this._client.conversations.list({
        types: 'public_channel,private_channel,im',
        limit: 200,
        exclude_archived: true,
      });
      return (result.channels || [])
        .filter(c => c.is_member)
        .map(c => c.id);
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

    const messages = (result.messages || []).reverse();

    for (const msg of messages) {
      this._lastTs[channel] = msg.ts;

      if (this._processed.has(msg.ts)) continue;
      if (msg.bot_id || msg.subtype) continue;

      // Channel messages: must mention the bot
      if (!msg.text?.includes(`<@${this._botUserId}>`)) continue;

      // Must be from my user
      if (this._myUserId && msg.user !== this._myUserId) continue;

      this._processed.add(msg.ts);
      this._cleanProcessed();

      const text = (msg.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text) continue;

      log.info('message received', { user: msg.user, channel });

      const slackMsg = new SlackMessage({
        client: this._client,
        event: { ...msg, channel, text },
        platform: 'slack',
      });

      this._dispatcher.handle(slackMsg, this._config).catch(err => {
        log.error('dispatch error', { err: err.message });
      });
    }
  }

  _cleanProcessed() {
    if (this._processed.size > 1000) {
      const arr = Array.from(this._processed);
      this._processed = new Set(arr.slice(-500));
    }
  }

  async stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    log.info('slack disconnected');
  }
}

module.exports = { SlackPlatform };
