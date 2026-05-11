const { v4: uuidv4 } = require('uuid');
const registry = require('./registry');
const { send } = require('./ws-server');
const { make } = require('./logger');

const log = make('router');

async function routeEvent(slackEvent, config, slackPoster) {
  const userId = slackEvent.user;
  if (!userId) return;

  if (!registry.isRegistered(userId)) {
    log.debug('event for unregistered user, ignoring', { userId });
    return;
  }

  const envelope = {
    slackEvent,
    eventId: uuidv4(),
  };

  if (registry.isOnline(userId)) {
    const ws = registry.getConnection(userId);
    send(ws, 'event', envelope);
    log.info('event routed', { userId, channel: slackEvent.channel, eventId: envelope.eventId });
  } else {
    // User offline — queue and notify
    registry.enqueue(userId, slackEvent, config);
    log.info('event queued (user offline)', { userId, channel: slackEvent.channel });
    await slackPoster.postOfflineNotice(slackEvent.channel, slackEvent.thread_ts || slackEvent.ts, userId);
  }
}

module.exports = { routeEvent };
