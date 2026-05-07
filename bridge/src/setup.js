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
  console.log(`\n${BOLD}SmartBridge Setup${RESET}\n`);

  // Check existing config
  const existing = config.load();
  if (existing.slack?.botToken && existing.slack?.appToken && existing.userId) {
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
  console.log(`${DIM}Check if SmartBridge bot already exists in your Slack workspace.${RESET}`);
  console.log(`${DIM}Look in Slack sidebar or search for "@SmartBridge"${RESET}\n`);

  const appExists = await ask('Is SmartBridge already in your workspace? (y/n): ');

  if (appExists.toLowerCase() !== 'y') {
    console.log(`\n${BOLD}Creating the app:${RESET}`);
    console.log(`  Opening: ${DIM}${MANIFEST_URL.slice(0, 60)}...${RESET}\n`);
    console.log('  In the browser:');
    console.log('  1. Pick your workspace from the dropdown');
    console.log('  2. Click "Create"');
    console.log('  3. Go to "Install App" → click "Install to Workspace" → "Allow"');
    console.log('  4. Go to "Basic Information" → "App-Level Tokens" → "Generate Token"');
    console.log('     Name it anything, add scope: connections:write → "Generate"\n');
    openBrowser(MANIFEST_URL);
    await ask('Press Enter once the app is created and installed...');
    console.log('');
  } else {
    console.log(`\n${GREEN}Great.${RESET} You can find the tokens here:\n`);
    console.log(`  Bot Token:  ${BLUE}https://api.slack.com/apps${RESET} → SmartBridge → OAuth & Permissions`);
    console.log(`  App Token:  ${BLUE}https://api.slack.com/apps${RESET} → SmartBridge → Basic Information → App-Level Tokens\n`);
    console.log(`${DIM}If you don't have access to the app settings, ask your workspace admin to share the tokens.${RESET}\n`);
  }

  // Step 2: Bot Token
  console.log(`${BOLD}Step 2: Bot Token${RESET}`);
  console.log(`${DIM}Find in: api.slack.com/apps → SmartBridge → OAuth & Permissions → Bot User OAuth Token${RESET}\n`);

  const botToken = await ask('Bot Token (xoxb-...): ');
  if (!botToken.startsWith('xoxb-')) {
    console.log(`\n${RED}Must start with xoxb-. Try again.${RESET}\n`);
    process.exit(1);
  }

  // Step 3: App Token
  console.log(`\n${BOLD}Step 3: App-Level Token${RESET}`);
  console.log(`${DIM}Find in: api.slack.com/apps → SmartBridge → Basic Information → App-Level Tokens${RESET}\n`);

  const appToken = await ask('App Token (xapp-...): ');
  if (!appToken.startsWith('xapp-')) {
    console.log(`\n${RED}Must start with xapp-. Try again.${RESET}\n`);
    process.exit(1);
  }

  // Step 4: Validate
  console.log(`\n${DIM}Validating...${RESET}`);
  try {
    const result = await slackAuthTest(botToken);
    if (!result.ok) {
      console.log(`${RED}Invalid token: ${result.error}${RESET}\n`);
      process.exit(1);
    }
    console.log(`${GREEN}Connected to workspace: ${result.team}${RESET}\n`);
  } catch (err) {
    console.log(`${RED}Could not reach Slack: ${err.message}${RESET}\n`);
    process.exit(1);
  }

  // Step 4: User ID
  console.log(`${BOLD}Step 4: Your Slack User ID${RESET}`);
  console.log(`${DIM}In Slack: click your profile → Profile → ⋮ (more) → Copy member ID${RESET}\n`);

  const userId = await ask('Your User ID (U...): ');
  if (!userId.startsWith('U')) {
    console.log(`${YELLOW}Warning: User IDs usually start with U. Saving anyway.${RESET}`);
  }

  // Save
  const authResult = await slackAuthTest(botToken);
  config.update({
    slack: { botToken, appToken, connected: true, workspaceName: authResult.team },
    userId,
  });

  console.log(`\n${GREEN}${BOLD}Setup complete!${RESET}\n`);
  console.log(`  Config saved to: ${config.CONFIG_FILE}`);
  console.log(`  Workspace:       ${authResult.team}`);
  console.log(`  User ID:         ${userId}`);
  console.log(`\n  Start with: ${BLUE}npm start${RESET}\n`);
}

run().catch((err) => {
  console.error(`\n${RED}Error: ${err.message}${RESET}\n`);
  process.exit(1);
});
