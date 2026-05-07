const { App } = require('@slack/bolt');
const { Platform, Message } = require('../core/platform');
const { make } = require('../lib/logger');

const log = make('slack');
const SLACK_LIMIT = 3500;

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
    const res = await this._client.chat.postMessage({
      channel: this._channel,
      thread_ts: this._threadTs,
      text,
      mrkdwn: true,
    });
    this._statusMessageId = res.ts;
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
    this._app = null;
  }

  get name() { return 'slack'; }

  isConfigured(config) {
    return !!(config.slack?.botToken && config.slack?.appToken);
  }

  async start(config, dispatcher) {
    const { botToken, appToken } = config.slack;
    const myUserId = config.userId;

    this._app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    this._app.event('app_mention', async ({ event, client }) => {
      if (myUserId && event.user !== myUserId) return;
      const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text) return;
      const msg = new SlackMessage({ client, event: { ...event, text }, platform: 'slack' });
      await dispatcher.handle(msg, config);
    });

    this._app.message(async ({ message, client }) => {
      if (message.channel_type !== 'im') return;
      if (message.bot_id || message.subtype) return;
      if (myUserId && message.user !== myUserId) return;
      const msg = new SlackMessage({ client, event: message, platform: 'slack' });
      await dispatcher.handle(msg, config);
    });

    this._app.error((err) => {
      log.error('slack error', { err: err.message });
    });

    await this._app.start();
    log.info('slack connected via socket mode');
  }

  async stop() {
    if (this._app) {
      await this._app.stop();
      this._app = null;
      log.info('slack disconnected');
    }
  }
}

module.exports = { SlackPlatform };
