const config = require('./lib/config');
const { make } = require('./lib/logger');
const dispatcher = require('./core/dispatcher');

const log = make('bridge');
const VERSION = require('../package.json').version;

const platforms = [];

function loadPlatforms() {
  try { platforms.push(new (require('./platforms/slack').SlackPlatform)()); } catch {}
}

async function startPlatforms(cfg) {
  for (const p of platforms) {
    if (p.isConfigured(cfg)) {
      try {
        await p.start(cfg, dispatcher);
        log.info(`${p.name} connected`);
      } catch (err) {
        log.error(`${p.name} failed to start`, { err: err.message });
      }
    }
  }
}

async function stopPlatforms() {
  for (const p of platforms) {
    try { await p.stop(); } catch {}
  }
}

async function cmdStart() {
  const cfg = config.load();

  if (!cfg.slack?.botToken) {
    console.log('Not configured. Run setup first:\n');
    console.log('  npm run setup');
    console.log('  # or');
    console.log('  node src/setup.js\n');
    process.exit(1);
  }

  if (!cfg.userId) {
    console.log('User ID not set. Run setup first:\n');
    console.log('  npm run setup\n');
    process.exit(1);
  }

  const ptDir = config.resolvePowerToolsDir();
  if (!ptDir) {
    log.error('Could not find Power Tools directory. Run from the cli-agent-power-tools repo.');
    process.exit(1);
  }
  config.update({ powerToolsDir: ptDir });

  loadPlatforms();

  console.log(`SmartBridge v${VERSION}`);
  console.log(`  Workspace: ${cfg.slack.workspaceName || '(unknown)'}`);
  console.log(`  User ID:   ${cfg.userId}`);
  console.log(`  Filtering: only responding to your messages\n`);

  await startPlatforms(cfg);
  config.writePid();

  console.log('Listening... (Ctrl+C to stop)\n');
}

function cmdStatus() {
  if (config.isRunning()) {
    const pid = config.readPid();
    const cfg = config.load();
    console.log(`SmartBridge is running (PID: ${pid})`);
    console.log(`  Workspace: ${cfg.slack?.workspaceName || '(unknown)'}`);
    console.log(`  User ID:   ${cfg.userId || '(not set)'}`);
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
  const cfg = config.load();
  if (!cfg.slack?.botToken && !cfg.userId) {
    console.log('Nothing to disconnect. No configuration found.');
    return;
  }

  // Stop if running
  const pid = config.readPid();
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    config.clearPid();
  }

  config.update({
    slack: { botToken: null, connected: false, workspaceName: null },
    userId: null,
  });

  console.log('Disconnected. Your local configuration has been cleared.');
  console.log('  Tokens removed');
  console.log('  User ID removed\n');
  console.log('Note: This only removes YOUR local config (~/.smartbridge/).');
  console.log('The Slack app still exists in the workspace for other users.');
  console.log('Power Tools setup is not affected.\n');
  console.log('To reconnect: npm run setup');
}

function cmdHelp() {
  console.log(`
SmartBridge v${VERSION}
Connect Smartsheet Power Tools to Slack

Commands:
  smartbridge setup        First-time setup (interactive)
  smartbridge start        Start listening for Slack messages
  smartbridge stop         Stop the bot
  smartbridge status       Check if running
  smartbridge disconnect   Remove your local Slack configuration
  smartbridge help         Show this help
  smartbridge --version    Show version
`);
}

async function shutdown(reason) {
  log.info('shutting down', { reason });
  await stopPlatforms();
  config.clearPid();
  setTimeout(() => process.exit(0), 500).unref();
}

// CLI dispatch
const cmd = process.argv[2] || 'start';

switch (cmd) {
  case 'start':
    cmdStart().catch((err) => { log.error('startup failed', { err: err.message }); process.exit(1); });
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    break;
  case 'setup':
    require('./setup');
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
