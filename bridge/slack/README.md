# SmartBridge — Slack

Connect Smartsheet Power Tools to Slack.

## Two modes

| | Polling | Relay |
|---|---|---|
| Server required | No | Yes (org-hosted) |
| User setup | Bot Token + User ID | Registration code only |
| Latency | ~10 seconds | ~1 second |
| Offline handling | Misses messages while offline | Queued up to 4 hours |
| Best for | Small teams, quick start | Teams that can host a server |

---

## Prerequisites

- [Claude Code](https://docs.claude.ai/en/docs/claude-code/overview) installed
- Smartsheet MCP configured (run `../../smartsheet_mcp_setup.sh`)
- Node.js 18+

---

## Mode 1: Polling

Each user's machine polls Slack for new @mentions every 10 seconds. No server required.

### Step 1: Install dependencies

```bash
cd bridge/slack/client
npm install
```

### Step 2: Create the Slack App (one-time, by workspace admin)

Check if SmartBridge already exists — search for "@SmartBridge" in Slack.

**If it doesn't exist**, create it:

Option A — via setup script (recommended):
```bash
npm run setup
# Opens your browser with the manifest pre-loaded
# Pick workspace → Create → Install to Workspace → Allow
```

Option B — manually:
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From a manifest**
3. Paste contents of `client/manifests/slack-app-manifest.json`
4. Click **Create** → **Install to Workspace** → **Allow**

**If it already exists**, just get the Bot Token from your admin.

### Step 3: Run setup

```bash
npm run setup
```

Asks for:
- **Bot Token** (`xoxb-...`) — api.slack.com/apps → SmartBridge → OAuth & Permissions
- **Your Slack User ID** — in Slack: click your profile → ⋮ → Copy member ID

### Step 4: Invite the bot to a channel

```
/invite @SmartBridge
```

### Step 5: Start

```bash
npm start
```

You should see:
```
SmartBridge v0.1.0
  Mode:      polling (every 10s)
  Workspace: YourTeam
  User ID:   U0123456789

Listening... (Ctrl+C to stop)
```

---

## Mode 2: Relay

A central server receives Slack events and routes them to each user's local machine. Users register once with a code — no Slack tokens needed.

### Admin setup

Deploy the relay server once for your org. See [server/README.md](server/README.md).

Once deployed, share with your team:
```
Server URL:        wss://your-server-ip:8443
Registration code: your-code
```

### User setup

**Step 1: Install dependencies**
```bash
cd bridge/slack/client
npm install
```

**Step 2: Register with relay server**
```bash
npm run relay:register
```

Asks for:
- Server URL (from admin)
- Registration code (from admin)
- Your Slack User ID — in Slack: click your profile → ⋮ → Copy member ID

**Step 3: Invite the bot to a channel (first user only)**
```
/invite @SmartBridge
```

**Step 4: Start**
```bash
npm run start:relay
```

You should see:
```
SmartBridge v0.1.0
  Mode:   relay
  Server: wss://your-server-ip:8443

Listening... (Ctrl+C to stop)
```

---

## What you can ask

@mention the bot in any channel it's invited to:

| Message | What happens |
|---|---|
| `@SmartBridge What's at risk?` | Scans for overdue, blocked, unassigned items |
| `@SmartBridge Who's overloaded?` | Finds capacity bottlenecks across projects |
| `@SmartBridge Reassign Sarah to Jordan` | Previews the move, waits for confirmation |
| `@SmartBridge Prep my standup` | Builds a pre-meeting brief |
| `@SmartBridge Draft a status update` | Drafts a polished Slack/email update |

---

## Commands

```bash
# Polling mode
npm run setup        First-time setup
npm start            Start polling

# Relay mode
npm run relay:register   Register with relay server
npm run start:relay      Start relay client

# Both modes
npm run stop         Stop the bot
npm run status       Check if running
npm run disconnect   Remove your local configuration
```

---

## Disconnect

```bash
npm run disconnect
```

Clears your tokens and User ID from `~/.smartbridge/config.json`. Does NOT affect other users or the Slack app.

---

## Directory structure

```
slack/
├── client/              ← every user runs this
│   ├── src/
│   │   ├── platforms/
│   │   │   └── slack/
│   │   │       ├── polling.js   ← polling transport
│   │   │       └── relay.js     ← relay transport
│   │   ├── core/
│   │   ├── lib/
│   │   ├── index.js
│   │   ├── setup.js
│   │   └── relay-register.js
│   ├── manifests/
│   └── package.json
└── server/              ← admin deploys this (relay mode only)
    ├── src/
    ├── setup.sh
    └── README.md
```
