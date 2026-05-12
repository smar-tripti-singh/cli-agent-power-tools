# SmartBridge Relay Server

## Why a server is needed

When someone types `@SmartBridge what's at risk?` in Slack, Slack needs somewhere to deliver that message. That somewhere is this relay server — it stays running 24/7, receives messages from Slack, and forwards them to the right user's machine where the actual work happens.

Without a server, each user's machine would need to be directly reachable from the internet, which is not practical (laptops sleep, change networks, sit behind firewalls). The relay server solves this — it is the single always-on point that Slack talks to, and it handles routing to whoever is online.

**This is a self-hosted server.** We do not host this for you. Your team or organization is responsible for running it on your own infrastructure — a cloud VM, an internal server, or any machine that stays on. You own the data and the setup.

**Who sets this up:** A team admin sets up the server once. After that, each user just registers their machine with the server and starts using the bot — no server knowledge needed.

---

## How it works

```
Slack ──Socket Mode──▶ Relay Server ──WebSocket──▶ User's machine
                            │                           │
                            │◀──── result ─────────────│
                            │
                            ▼
                        Slack (posts result to thread)
```

---

## Step 1: Create the Slack App (one-time, by workspace admin)

> **Admin only:** Creating and installing a Slack app requires workspace admin permissions. Regular users cannot install apps into a Slack workspace without admin approval. If you are not the workspace admin, share this step with someone who is.

The relay server needs a Slack app with Socket Mode enabled. This is created once per workspace — all users share the same app.

**Check if SmartBridge already exists** — search for `@SmartBridge` in your Slack workspace.

**If it does not exist**, create it using the manifest:

1. Open [api.slack.com/apps](https://api.slack.com/apps) **in a browser on your local machine** (not the server)
2. Click **Create New App** → **From a manifest**
3. Paste the contents of `manifests/slack-app-manifest.json`
4. Select your workspace from the dropdown
5. Click **Create**
6. Go to **Install App** → click **Install to Workspace** → click **Allow**
7. Go to **Basic Information** → scroll to **App-Level Tokens**
8. Click **Generate Token and Scopes**
   - Name it anything (e.g. `socket`)
   - Add scope: `connections:write`
   - Click **Generate**
   - Copy the token (starts with `xapp-`)

**If it already exists**, retrieve the tokens from the existing app (Step 2 below).

---

## Step 2: Get your tokens

You need two tokens from your Slack app:

**App-Level Token (`xapp-...`)**
- [api.slack.com/apps](https://api.slack.com/apps) → SmartBridge → **Basic Information** → **App-Level Tokens**
- If no token exists, generate one with scope `connections:write`

**Bot Token (`xoxb-...`)**
- [api.slack.com/apps](https://api.slack.com/apps) → SmartBridge → **OAuth & Permissions** → **Bot User OAuth Token**

---

## Step 3: Configure the server

The server reads configuration from environment variables. Create a `.env` file in `bridge/slack/server/`:

```bash
cp .env.example .env
```

Fill in the values:

```bash
# Required
SLACK_APP_TOKEN=xapp-...           # App-Level Token from Step 2
SLACK_BOT_TOKEN=xoxb-...           # Bot Token from Step 2
RELAY_JWT_SECRET=<random-string>   # Any random 32+ character string
RELAY_REGISTRATION_CODE=<code>     # Make this up — share with your team

# Optional
RELAY_PORT=8443                    # Default: 8443
LOG_LEVEL=info                     # Default: info
```

**Generating a random JWT secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 4: Install dependencies

```bash
cd bridge/slack/server
npm install
```

---

## Step 5: Start the server

**Local testing (stops when terminal closes):**
```bash
npm start
```

**Production with pm2 (auto-restarts, survives reboots):**
```bash
npm install -g pm2
pm2 start src/index.js --name smartbridge-relay
pm2 save

# Enable auto-start on system boot:
pm2 startup  # then run the command it prints
```

**Verify the server is running:**
```bash
curl http://localhost:8443/health
# → {"ok":true,"uptime":...}
```

---

## Step 6: Invite the bot to a Slack channel

In Slack, go to the channel you want to use:
```
/invite @SmartBridge
```

---

## Step 7: Share with your team

Once the server is running, share these two things with each user:

```
Server URL:        ws://your-server-ip:8443    (local/internal)
                   wss://your-domain:8443       (production with TLS)
Registration code: the-code-you-set
```

Each user then runs in `bridge/slack/client/`:
```bash
npm run relay:register   # enter server URL + registration code once
npm start                # start the bot
```

---

## Admin commands

```bash
# pm2
pm2 logs smartbridge-relay          View live logs
pm2 status                          Check if running
pm2 restart smartbridge-relay       Restart server
pm2 stop smartbridge-relay          Stop server
pm2 startup                         Enable auto-start on system boot

# Health and status
curl http://localhost:8443/health
curl http://localhost:8443/status   # shows connected users

# Revoke a user's access
curl -X POST http://localhost:8443/api/revoke \
  -H "Content-Type: application/json" \
  -d '{"userId": "U0123456789"}'
```

---

## Deployment

The server is a plain Node.js process. Run it however fits your infrastructure:

- **pm2** on a VPS or EC2 instance — use `setup.sh` for a guided setup
- **CI/CD pipeline** — see `.gitlab-ci.yml` in the repo root for a reference GitLab CI setup
- **Any container or cloud platform** — set the environment variables and run `node src/index.js`

For a guided local or pm2 setup:
```bash
./setup.sh
```

---

## Persistence

User registrations and offline message queues are saved to `data/state.json` every 60 seconds. On server restart, all registered users remain valid — no re-registration needed.

---

## Security

- No Smartsheet credentials or Claude API keys are stored on the server
- Users authenticate via JWT (30-day expiry, auto-refresh)
- Registration requires a shared code — prevents open registration
- Use `wss://` (TLS) in production for encrypted WebSocket connections

---

## Directory structure

```
server/
├── src/
│   ├── index.js           Entry point
│   ├── config.js          Environment variable configuration
│   ├── logger.js          Structured JSON logger
│   ├── auth.js            JWT issue/verify/hash
│   ├── registry.js        User registry + offline queue + persistence
│   ├── ws-server.js       WebSocket server + HTTP admin API
│   ├── slack-socket.js    Socket Mode connection to Slack
│   ├── slack-poster.js    Posts results/status to Slack
│   └── router.js          Routes events to correct user
├── manifests/
│   └── slack-app-manifest.json   Slack app manifest for one-click creation
├── data/
│   └── state.json         Persisted registry (auto-created)
├── setup.sh               Guided setup script (pm2 or local)
├── .env.example           Environment variable reference
└── README.md              This file
```
