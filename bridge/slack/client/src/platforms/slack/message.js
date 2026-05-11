const { Message } = require('../../core/platform');
const { make } = require('../../lib/logger');

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
      platform: platform || 'slack',
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

module.exports = { SlackMessage, chunk };
