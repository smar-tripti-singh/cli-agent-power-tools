require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = require('./config');
const { make, setLevel } = require('./logger');
const registry = require('./registry');
const { startWsServer } = require('./ws-server');
const { startSlackSocket } = require('./slack-socket');
const { createSlackPoster } = require('./slack-poster');
const { routeEvent } = require('./router');

setLevel(config.logLevel);
const log = make('server');

async function main() {
  log.info('starting smartbridge relay server');

  // Load persisted state (registered users, queued messages)
  registry.loadSnapshot();

  // Create Slack poster (posts results/status to Slack)
  const slackPoster = createSlackPoster(config.slackBotToken);

  // Start WebSocket server (accepts user machine connections)
  const { server } = startWsServer(config, slackPoster);

  // Connect to Slack via Socket Mode
  startSlackSocket(config.slackAppToken, async (event) => {
    await routeEvent(event, config, slackPoster);
  });

  // Save snapshot on clean shutdown
  process.once('SIGINT', () => shutdown(server));
  process.once('SIGTERM', () => shutdown(server));

  log.info('relay server ready', { port: config.port });
}

function shutdown(server) {
  log.info('shutting down');
  registry.saveSnapshot();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
