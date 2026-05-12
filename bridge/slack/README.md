# SmartBridge — Slack

Connect Smartsheet Power Tools to Slack via the relay server.

## How it works

```
You in Slack: "@SmartBridge what's at risk?"
  → Relay server receives event via Socket Mode
  → Forwards to your local machine over WebSocket
  → Claude Code runs the right Power Tool with your local credentials
  → Result posted back to the Slack thread
```

## Prerequisites

- [Claude Code](https://docs.claude.ai/en/docs/claude-code/overview) installed
- Smartsheet MCP configured (run `../../smartsheet_mcp_setup.sh`)
- Node.js 18+
- Relay server deployed by your org admin (see [server/README.md](server/README.md))

## User setup (one-time)

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
- Server URL — from your admin (e.g. `wss://relay.yourcompany.com:8443`)
- Registration code — from your admin
- Your Slack User ID — in Slack: click your profile → ⋮ → Copy member ID

**Step 3: Invite the bot to a channel (first user only)**
```
/invite @SmartBridge
```

**Step 4: Start**
```bash
npm start
```

You should see:
```
SmartBridge v0.1.0
  Server: wss://relay.yourcompany.com:8443

Listening... (Ctrl+C to stop)
```

## What you can ask

@mention the bot in any channel it's invited to:

| Message | What happens |
|---|---|
| `@SmartBridge What's at risk?` | Scans for overdue, blocked, unassigned items |
| `@SmartBridge Who's overloaded?` | Finds capacity bottlenecks across projects |
| `@SmartBridge Reassign Sarah to Jordan` | Previews the move, waits for confirmation |
| `@SmartBridge Prep my standup` | Builds a pre-meeting brief |
| `@SmartBridge Draft a status update` | Drafts a polished Slack/email update |

## Commands

```bash
npm run relay:register   Register with relay server (one-time)
npm start                Start the bot
npm run stop             Stop the bot
npm run status           Check if running
npm run disconnect       Remove your local configuration
```

## Disconnect

```bash
npm run disconnect
```

Removes your relay config from `~/.smartbridge/relay.json`. Does not affect other users, the Slack app, or the relay server.

## Directory structure

```
slack/
├── client/              ← every user runs this
│   ├── src/
│   │   ├── platforms/
│   │   │   └── slack/
│   │   │       ├── message.js   ← shared Slack message class
│   │   │       └── relay.js     ← relay transport
│   │   ├── core/
│   │   ├── lib/
│   │   ├── index.js
│   │   └── relay-register.js
│   └── package.json
└── server/              ← admin deploys this
    ├── src/
    ├── setup.sh
    └── README.md
```
