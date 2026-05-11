const { WebClient } = require('@slack/web-api');
const { make } = require('./logger');

const log = make('slack-poster');
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

function formatStats(stats) {
  if (!stats) return null;
  const parts = [];
  if (stats.elapsedMs) {
    const s = Math.round(stats.elapsedMs / 1000);
    parts.push(`⏱️ ${s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'}`);
  }
  if (stats.toolCount > 0) parts.push(`🔧 ${stats.toolCount}`);
  return parts.length ? `✅ Done · ${parts.join(' · ')}` : '✅ Done';
}

function createSlackPoster(botToken) {
  const client = new WebClient(botToken);

  async function postOfflineNotice(channel, threadTs, userId) {
    try {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `⚠️ Your SmartBridge is offline. Message queued — it will process when you reconnect.`,
        mrkdwn: true,
      });
    } catch (err) {
      log.error('failed to post offline notice', { err: err.message, userId });
    }
  }

  async function postStatus(channel, threadTs, text) {
    try {
      const res = await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text,
        mrkdwn: true,
      });
      return res.ts;
    } catch (err) {
      log.error('failed to post status', { err: err.message });
      return null;
    }
  }

  async function updateStatus(channel, threadTs, statusMessageId, text) {
    if (!statusMessageId) return;
    try {
      await client.chat.update({
        channel,
        ts: statusMessageId,
        text,
        mrkdwn: true,
      });
    } catch {}
  }

  async function postResult(channel, threadTs, text, statusMessageId, stats) {
    // Update status to done
    if (statusMessageId) {
      await updateStatus(channel, threadTs, statusMessageId, formatStats(stats) || '✅ Done');
    }
    // Post the actual result
    const parts = chunk(String(text || '(empty)'));
    for (const part of parts) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: part,
        mrkdwn: true,
      });
    }
  }

  return { postOfflineNotice, postStatus, updateStatus, postResult };
}

module.exports = { createSlackPoster };
