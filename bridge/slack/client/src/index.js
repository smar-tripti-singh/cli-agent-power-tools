const config = require('./lib/config');
const { make } = require('./lib/logger');
const dispatcher = require('./core/dispatcher');

const log = make('bridge');
const VERSION = require('../package.json').version;

const platforms = [];

function loadPlatforms() {
  try { platforms.push(new (require('./platforms/slack').SlackRelayPlatform)()); } catch {}
}

async function startPlatforms(cfg) {
  for (const p of platforms) {
    if (p.isConfigured(cfg)) {
      try {
        await p.start(cfg, dispatcher);
        log.info(`${p.name} connected`);
      } catch (err) {
        log.error(`${p.name} failed to start`, { err: err.message });
        process.exit(1);
      }
    } else {
      log.error(`${p.name} not configured — run: npm run relay:register`);
      process.exit(1);
    }
  }
}

async function stopPlatforms() {
  for (const p of platforms) {
    try { await p.stop(); } catch {}
  }
}

async function cmdStart() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const relayFile = path.join(os.homedir(), '.smartbridge', 'relay.json');
  if (!fs.existsSync(relayFile)) {
    console.log('Not configured. Register first:\n\n  npm run relay:register\n');
    process.exit(1);
  }

  const ptDir = config.resolvePowerToolsDir();
  if (!ptDir) {
    log.error('Could not find Power Tools directory. Run from the cli-agent-power-tools repo.');
    process.exit(1);
  }
  config.update({ powerToolsDir: ptDir });

  loadPlatforms();

  const relayData = JSON.parse(fs.readFileSync(relayFile, 'utf8'));
  console.log(`SmartBridge v${VERSION}`);
  console.log(`  Server: ${relayData.serverUrl}`);
  console.log(`\nListening... (Ctrl+C to stop)\n`);

  await startPlatforms(config.load());
  config.writePid();
}

function cmdStatus() {
  if (config.isRunning()) {
    const pid = config.readPid();
    console.log(`SmartBridge is running (PID: ${pid})`);
  } else {
    console.log('SmartBridge is not running.');
  }
}

function cmdStop() {
  const pid = config.readPid();
  if (!pid) { console.log('SmartBridge is not running.'); return; }
  try {
    process.kill(pid, 'SIGTERM');
    config.clearPid();
    console.log('SmartBridge stopped.');
  } catch {
    config.clearPid();
    console.log('SmartBridge was not running (stale PID cleared).');
  }
}

function cmdDisconnect() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const relayFile = path.join(os.homedir(), '.smartbridge', 'relay.json');

  if (!fs.existsSync(relayFile)) {
    console.log('Nothing to disconnect. No configuration found.');
    return;
  }

  const pid = config.readPid();
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    config.clearPid();
  }

  fs.unlinkSync(relayFile);

  console.log('Disconnected. Your relay configuration has been cleared.');
  console.log('Note: This only removes YOUR local config (~/.smartbridge/relay.json).');
  console.log('The Slack app and relay server are not affected.\n');
  console.log('To reconnect: npm run relay:register');
}

function cmdHelp() {
  console.log(`
SmartBridge v${VERSION}
Connect Smartsheet Power Tools to Slack via relay server

Commands:
  npm run relay:register   Register with relay server (one-time)
  npm start                Start the bot
  npm run stop             Stop the bot
  npm run status           Check if running
  npm run disconnect       Remove your local configuration
  npm run --version        Show version
`);
}

async function shutdown(reason) {
  log.info('shutting down', { reason });
  await stopPlatforms();
  config.clearPid();
  setTimeout(() => process.exit(0), 500).unref();
}

const cmd = process.argv[2] || 'start';

switch (cmd) {
  case 'start':
    cmdStart().catch((err) => { log.error('startup failed', { err: err.message }); process.exit(1); });
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    break;
  case 'relay:register':
    require('./relay-register');
    break;
  case 'stop':
    cmdStop();
    break;
  case 'disconnect':
    cmdDisconnect();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'help':
  case '--help':
  case '-h':
    cmdHelp();
    break;
  case '--version':
  case '-v':
    console.log(VERSION);
    break;
  default:
    console.log(`Unknown command: ${cmd}`);
    cmdHelp();
    process.exit(1);
}
