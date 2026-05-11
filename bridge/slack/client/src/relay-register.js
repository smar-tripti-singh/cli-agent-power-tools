const readline = require('readline');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./lib/config');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const RELAY_CONFIG_FILE = path.join(os.homedir(), '.smartbridge', 'relay.json');

function ask(question) {
  const r = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    r.question(question, (answer) => { r.close(); resolve(answer.trim()); });
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url.replace('wss://', 'https://').replace('ws://', 'http://'));
    const lib = parsed.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: '/api/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { reject(new Error('Invalid response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log(`\n${BOLD}SmartBridge Relay Registration${RESET}\n`);

  // Check if already registered
  if (fs.existsSync(RELAY_CONFIG_FILE)) {
    const existing = JSON.parse(fs.readFileSync(RELAY_CONFIG_FILE, 'utf8'));
    console.log(`${GREEN}Already registered:${RESET}`);
    console.log(`  Server: ${existing.serverUrl}`);
    console.log(`  Expires: ${existing.expiresAt}\n`);
    const reuse = await ask('Re-register? (y/n): ');
    if (reuse.toLowerCase() !== 'y') {
      console.log(`\nRun ${BLUE}npm run start:relay${RESET} to connect.\n`);
      return;
    }
    console.log('');
  }

  const cfg = config.load();

  // Get User ID — needed for registration
  let userId = cfg.userId;
  if (!userId) {
    console.log(`${DIM}You need your Slack User ID to register.${DIM}`);
    console.log(`${DIM}In Slack: click your profile → ⋮ → Copy member ID${RESET}\n`);
    userId = await ask('Your Slack User ID (U...): ');
    if (!userId.startsWith('U')) {
      console.log(`\n${RED}User IDs start with U.${RESET}\n`);
      process.exit(1);
    }
  }

  const serverUrl = await ask('Relay server URL (e.g. wss://relay.yourcompany.com): ');
  if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
    console.log(`\n${RED}URL must start with ws:// or wss://${RESET}\n`);
    process.exit(1);
  }

  const regCode = await ask('Registration code (from admin): ');
  if (!regCode) {
    console.log(`\n${RED}Registration code is required.${RESET}\n`);
    process.exit(1);
  }

  const name = await ask(`Your name (optional, press Enter to skip): `);

  console.log(`\n${DIM}Registering...${RESET}`);

  let res;
  try {
    res = await post(serverUrl, { userId, regCode, name: name || userId });
  } catch (err) {
    console.log(`\n${RED}Could not reach server: ${err.message}${RESET}\n`);
    process.exit(1);
  }

  if (res.status === 409) {
    console.log(`\n${RED}Already registered on this server. Ask admin to revoke first.${RESET}\n`);
    process.exit(1);
  }
  if (res.status === 403) {
    console.log(`\n${RED}Invalid registration code. Check with your admin.${RESET}\n`);
    process.exit(1);
  }
  if (res.status !== 200) {
    console.log(`\n${RED}Registration failed: ${res.body.error || res.status}${RESET}\n`);
    process.exit(1);
  }

  const { token, expiresAt } = res.body;

  // Save relay config
  const relayConfig = { serverUrl, token, registeredAt: new Date().toISOString(), expiresAt };
  fs.writeFileSync(RELAY_CONFIG_FILE, JSON.stringify(relayConfig, null, 2));

  // Save userId to main config if not already set
  if (!cfg.userId) config.update({ userId });

  console.log(`\n${GREEN}${BOLD}Registered!${RESET}\n`);
  console.log(`  Config saved to: ${RELAY_CONFIG_FILE}`);
  console.log(`  Server:          ${serverUrl}`);
  console.log(`  Expires:         ${expiresAt}`);
  console.log(`\n  Start with: ${BLUE}npm run start:relay${RESET}\n`);
}

run().catch((err) => {
  console.error(`\n${RED}Error: ${err.message}${RESET}\n`);
  process.exit(1);
});
