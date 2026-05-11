const { run } = require('./runner');
const { resolvePowerToolsDir } = require('../lib/config');
const { make } = require('../lib/logger');

const log = make('dispatcher');

// threadKey → { abortController, sessionId }
const activeJobs = new Map();

function threadKey(msg) {
  return `${msg.platform}:${msg.channelId}:${msg.threadId || msg.channelId}`;
}

function formatDuration(ms) {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatProgress(info) {
  const parts = [`⏱️ ${info.elapsed}s`];
  if (info.toolCount > 0) parts.push(`🔧 ${info.toolCount} tool calls`);
  return `⚙️ Running... ${parts.join(' · ')}`;
}

function formatStats(stats) {
  const parts = [`⏱️ ${formatDuration(stats.elapsedMs)}`];
  if (stats.toolCount > 0) parts.push(`🔧 ${stats.toolCount}`);
  const top = Object.entries(stats.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => {
      const short = name.replace('mcp__smartsheet__', '');
      return `${short}×${count}`;
    })
    .join(', ');
  if (top) parts.push(top);
  return `✅ Done · ${parts.join(' · ')}`;
}

/**
 * Handles an incoming message from any platform.
 * Spawns Claude, streams progress, posts result.
 */
async function handle(message, config) {
  const key = threadKey(message);

  if (activeJobs.has(key)) {
    await message.reply('⏳ Still working on the previous request in this thread. Please wait, or ask in a new thread.');
    return;
  }

  const cwd = resolvePowerToolsDir();
  if (!cwd) {
    await message.reply('❌ Could not find Power Tools directory. Make sure the .claude/agents/ folder exists.');
    return;
  }

  const ac = new AbortController();
  const existingSession = getSession(key);
  activeJobs.set(key, { abortController: ac, startedAt: Date.now() });

  log.info('job started', {
    platform: message.platform,
    user: message.userName,
    channel: message.channelId,
    prompt: message.text.slice(0, 80),
  });

  await message.showTyping();
  await message.postStatus('⚙️ Running... ⏱️ 0s');

  try {
    const result = await run({
      prompt: message.text,
      cwd,
      sessionId: existingSession,
      timeoutMs: config?.settings?.jobTimeoutMs || 120000,
      signal: ac.signal,
      onProgress: async (info) => {
        try {
          await message.updateStatus(formatProgress(info));
        } catch {}
      },
    });

    setSession(key, result.sessionId);

    await message.updateStatus(formatStats(result.stats));
    await message.reply(result.text);

    log.info('job completed', {
      platform: message.platform,
      user: message.userName,
      elapsed: formatDuration(result.stats.elapsedMs),
      tools: result.stats.toolCount,
    });

  } catch (err) {
    if (ac.signal.aborted) {
      await message.updateStatus('🛑 Cancelled');
      log.info('job cancelled', { platform: message.platform, user: message.userName });
    } else {
      await message.updateStatus('❌ Failed');
      await message.reply(`❌ Error: ${err.message}`);
      log.error('job failed', { platform: message.platform, user: message.userName, err: err.message });
    }
  } finally {
    activeJobs.delete(key);
  }
}

function cancel(platform, channelId, threadId) {
  const key = `${platform}:${channelId}:${threadId || channelId}`;
  const job = activeJobs.get(key);
  if (job) {
    job.abortController.abort();
    return true;
  }
  return false;
}

// Session storage: threadKey → sessionId
// Allows Claude to resume conversations in the same thread.
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getSession(key) {
  const entry = sessions.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > SESSION_TTL_MS) {
    sessions.delete(key);
    return null;
  }
  return entry.sessionId;
}

function setSession(key, sessionId) {
  if (!sessionId) return;
  sessions.set(key, { sessionId, at: Date.now() });
}

function getStatus() {
  return {
    activeJobs: activeJobs.size,
    jobs: Array.from(activeJobs.entries()).map(([key, job]) => ({
      thread: key,
      elapsed: formatDuration(Date.now() - job.startedAt),
    })),
    activeSessions: sessions.size,
  };
}

module.exports = { handle, cancel, getStatus };
