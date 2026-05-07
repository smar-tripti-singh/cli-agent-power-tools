# SmartBridge

Connect Smartsheet Power Tools to Slack. Ask questions in Slack, Power Tools run locally on your machine, results appear in the channel.

## How it works

```
You in Slack: "@SmartBridge what's at risk?"
  → Your local SmartBridge receives the message (Socket Mode)
  → Spawns Claude Code with the right Power Tool agent
  → Agent reads Smartsheet data via MCP
  → Result posted back to the Slack thread
```

Each user runs SmartBridge on their own machine.

## Prerequisites

- [Claude Code](https://docs.claude.ai/en/docs/claude-code/overview) installed
- Smartsheet MCP configured (run `../smartsheet_mcp_setup.sh`)
- Node.js 18+

## Setup

### Step 1: Install dependencies

```bash
cd bridge
npm install
```

### Step 2: Slack App

First, check if **SmartBridge** already exists in your workspace — search for "@SmartBridge" in Slack or ask your workspace admin.

**If the app already exists:** skip to Step 3 — just get the tokens from your admin or from the app settings.

**If the app does NOT exist** (one-time, by workspace admin), create it using either option:

**Option A: Via `npm run setup`** (recommended)
- Run `npm run setup` — it will open your browser with the manifest pre-loaded
- Pick your workspace, click "Create", then install it

**Option B: Manually**
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From a manifest**
3. Select your workspace
4. Paste the manifest from `manifests/slack-app-manifest.json`
5. Click **Create**
6. Go to **Install App** → click **Install to Workspace** → **Allow**

### Step 3: Get your tokens

After the app exists, you need two tokens:

**Bot Token (xoxb-):**
- Go to [api.slack.com/apps](https://api.slack.com/apps) → click **SmartBridge**
- Go to **OAuth & Permissions**
- Copy the **Bot User OAuth Token** (starts with `xoxb-`)

**App-Level Token (xapp-):**
- Go to [api.slack.com/apps](https://api.slack.com/apps) → click **SmartBridge**
- Go to **Basic Information**
- Scroll to **App-Level Tokens**
- If no token exists: click **Generate Token and Scopes**, name it anything (e.g. "socket"), add scope `connections:write`, click **Generate**
- Copy the token (starts with `xapp-`)

### Step 4: Run setup

```bash
npm run setup
```

The setup will walk you through:
1. Checking if the app exists in your workspace
2. Pasting your Bot Token (xoxb-)
3. Pasting your App-Level Token (xapp-)
4. Entering your Slack User ID

**Finding your Slack User ID:**
In Slack, click your profile picture → **Profile** → click **⋮** (more) → **Copy member ID**

### Step 5: Invite the bot to a channel

In Slack, go to the channel you want to use and type:
```
/invite @SmartBridge
```

### Step 6: Start

```bash
npm start
```

You should see:
```
SmartBridge v0.1.0
  Workspace: YourTeam
  User ID:   U0123456789
  Filtering: only responding to your messages

Listening... (Ctrl+C to stop)
```

## For additional users

If the Slack app already exists (created by admin), each new user just needs:

1. Get the Bot Token and App-Level Token from admin, or find them at:
   - **Bot Token:** [api.slack.com/apps](https://api.slack.com/apps) → SmartBridge → OAuth & Permissions
   - **App Token:** [api.slack.com/apps](https://api.slack.com/apps) → SmartBridge → Basic Information → App-Level Tokens
2. Run `npm run setup` and paste the tokens + their own User ID
3. Run `npm start`

## Commands

```
npm run setup        Interactive first-time setup
npm start            Start listening for Slack messages
npm run disconnect   Remove your local Slack configuration
```

CLI commands:
```
node src/index.js stop       Stop the running bot
node src/index.js status     Check if running
node src/index.js help       Show all commands
```

## What you can ask

Once running, @mention the bot in any channel it's invited to:

| Message | What happens |
|---|---|
| `@SmartBridge What's at risk?` | Scans for overdue, blocked, unassigned items |
| `@SmartBridge Who's overloaded?` | Finds capacity bottlenecks across projects |
| `@SmartBridge Reassign Sarah to Jordan` | Previews the move, waits for confirmation |
| `@SmartBridge Prep my standup` | Builds a pre-meeting brief |
| `@SmartBridge Draft a status update` | Drafts a polished Slack/email update |

Claude Code picks the right Power Tool automatically based on what you ask.

## How multi-user works

All users share the same Slack app (one bot identity: @SmartBridge). Each user:
- Runs their own local process
- Configures their own User ID
- Only receives responses to their own messages


## Disconnect

To remove your local configuration:

```bash
npm run disconnect
```

This clears your tokens and User ID from `~/.smartbridge/config.json`. It does NOT:
- Delete the Slack app from the workspace
- Affect other users
- Touch your Power Tools setup

## Architecture

```
bridge/
├── src/
│   ├── index.js              CLI entry point (start/stop/status/disconnect)
│   ├── setup.js              Interactive setup wizard
│   ├── core/
│   │   ├── platform.js       Abstract Platform + Message interface
│   │   ├── dispatcher.js     Routes messages → runner, manages sessions
│   │   └── runner.js         Spawns claude -p, streams results
│   ├── platforms/
│   │   └── slack.js          Slack Socket Mode + user ID filtering
│   └── lib/
│       ├── config.js         Config manager (~/.smartbridge/)
│       └── logger.js         Structured logger
├── manifests/
│   └── slack-app-manifest.json
└── package.json
```

## License

MIT
