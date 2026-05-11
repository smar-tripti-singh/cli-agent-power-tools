const { SocketModeClient, LogLevel } = require('@slack/socket-mode');
const { make } = require('./logger');

const log = make('slack-socket');

function startSlackSocket(appToken, onEvent) {
  const client = new SocketModeClient({
    appToken,
    logLevel: LogLevel.ERROR,
  });

  client.on('app_mention', async ({ event, ack }) => {
    await ack();
    const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!text) return;
    log.debug('app_mention received', { user: event.user, channel: event.channel });
    await onEvent({ ...event, text });
  });

  client.on('message', async ({ event, ack }) => {
    await ack();
    if (event.channel_type !== 'im') return;
    if (event.bot_id || event.subtype) return;
    log.debug('dm received', { user: event.user, channel: event.channel });
    await onEvent(event);
  });

  client.on('error', (err) => {
    log.error('slack socket error', { err: err.message });
  });

  client.start().then(() => {
    log.info('slack socket mode connected');
  }).catch((err) => {
    log.error('slack socket mode failed to connect', { err: err.message });
    process.exit(1);
  });

  return client;
}

module.exports = { startSlackSocket };
