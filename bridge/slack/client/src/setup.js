const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const https = require('https');
const config = require('./lib/config');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const manifestPath = path.join(__dirname, '..', 'manifests', 'slack-app-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const MANIFEST_URL = 'https://api.slack.com/apps?new_app=1&manifest_json=' + encodeURIComponent(JSON.stringify(manifest));

function ask(question) {
  const r = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    r.question(question, (answer) => { r.close(); resolve(answer.trim()); });
  });
}

function openBrowser(url) {
  const cmd = os.platform() === 'darwin' ? 'open'
    : os.platform() === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} "${url}"`, () => {});
}

function slackAuthTest(token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'slack.com',
      path: '/api/auth.test',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid response')); } });
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

async function run() {
  console.log(`\n${BOLD}SmartBridge Setup (Polling mode)${RESET}\n`);
  console.log(`${DIM}This sets up polling mode — your machine polls Slack every 10s.`);
  console.log(`For relay mode (org server), use: npm run relay:register${RESET}\n`);

  // Check existing config
  const existing = config.load();
  if (existing.slack?.botToken && existing.userId) {
    console.log(`${GREEN}Existing configuration found:${RESET}`);
    console.log(`  Workspace: ${existing.slack.workspaceName || '(unknown)'}`);
    console.log(`  User ID:   ${existing.userId}\n`);

    const reuse = await ask('Already configured. Reconfigure? (y/n): ');
    if (reuse.toLowerCase() !== 'y') {
      console.log(`\nRun ${BLUE}npm start${RESET} to connect.\n`);
      return;
    }
    console.log('');
  }

  // Step 1: Does the app exist?
  console.log(`${BOLD}Step 1: Slack App${RESET}`);
  console.log(`${DIM}Check if SmartBridge already exists in your workspace.${RESET}`);
  console.log(`${DIM}Search for "@SmartBridge" in Slack or ask your workspace admin.${RESET}\n`);

  const appExists = await ask('Is SmartBridge already in your workspace? (y/n): ');

  if (appExists.toLowerCase() !== 'y') {
    console.log(`\n${BOLD}Creating the app:${RESET}`);
    console.log(`  Opening browser with manifest pre-loaded...\n`);
    console.log('  In the browser:');
    console.log('  1. Pick your workspace from the dropdown');
    console.log('  2. Click "Create"');
    console.log('  3. Go to "Install App" → click "Install to Workspace" → "Allow"\n');
    openBrowser(MANIFEST_URL);
    await ask('Press Enter once the app is created and installed...');
    console.log('');
  } else {
    console.log(`\n${GREEN}Great.${RESET} Find the Bot Token here:\n`);
    console.log(`  ${BLUE}https://api.slack.com/apps${RESET} → SmartBridge → OAuth & Permissions\n`);
    console.log(`${DIM}If you don't have access, ask your workspace admin to share the token.${RESET}\n`);
  }

  // Step 2: Bot Token
  console.log(`${BOLD}Step 2: Bot Token${RESET}`);
  console.log(`${DIM}api.slack.com/apps → SmartBridge → OAuth & Permissions → Bot User OAuth Token${RESET}\n`);

  const botToken = await ask('Bot Token (xoxb-...): ');
  if (!botToken.startsWith('xoxb-')) {
    console.log(`\n${RED}Must start with xoxb-. Try again.${RESET}\n`);
    process.exit(1);
  }

  // Step 3: Validate
  console.log(`\n${DIM}Validating...${RESET}`);
  let workspace;
  try {
    const result = await slackAuthTest(botToken);
    if (!result.ok) {
      console.log(`${RED}Invalid token: ${result.error}${RESET}\n`);
      process.exit(1);
    }
    workspace = result.team;
    console.log(`${GREEN}Connected to workspace: ${workspace}${RESET}\n`);
  } catch (err) {
    console.log(`${RED}Could not reach Slack: ${err.message}${RESET}\n`);
    process.exit(1);
  }

  // Step 3: User ID
  console.log(`${BOLD}Step 3: Your Slack User ID${RESET}`);
  console.log(`${DIM}In Slack: click your profile → ⋮ (more) → Copy member ID${RESET}\n`);

  const userId = await ask('Your User ID (U...): ');
  if (!userId.startsWith('U')) {
    console.log(`${YELLOW}Warning: User IDs usually start with U. Saving anyway.${RESET}`);
  }

  config.update({
    slack: { botToken, connected: true, workspaceName: workspace },
    userId,
    mode: 'polling',
  });

  console.log(`\n${GREEN}${BOLD}Setup complete!${RESET}\n`);
  console.log(`  Config saved to: ${config.CONFIG_FILE}`);
  console.log(`  Workspace:       ${workspace}`);
  console.log(`  User ID:         ${userId}`);
  console.log(`\n  Start with: ${BLUE}npm start${RESET}\n`);
}

run().catch((err) => {
  console.error(`\n${RED}Error: ${err.message}${RESET}\n`);
  process.exit(1);
});
