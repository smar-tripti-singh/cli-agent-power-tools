function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

module.exports = {
  port: parseInt(process.env.RELAY_PORT || '8443', 10),
  slackAppToken: required('SLACK_APP_TOKEN'),
  slackBotToken: required('SLACK_BOT_TOKEN'),
  jwtSecret: required('RELAY_JWT_SECRET'),
  registrationCode: required('RELAY_REGISTRATION_CODE'),
  maxQueueSize: parseInt(process.env.RELAY_MAX_QUEUE_SIZE || '20', 10),
  queueTtlMs: parseInt(process.env.RELAY_QUEUE_TTL_HOURS || '4', 10) * 60 * 60 * 1000,
  heartbeatIntervalMs: parseInt(process.env.RELAY_HEARTBEAT_INTERVAL_MS || '30000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
};
