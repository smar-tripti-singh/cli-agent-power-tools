const spawn = require('cross-spawn');
const { make } = require('../lib/logger');

const log = make('runner');
const MAX_LINE_BYTES = 2 * 1024 * 1024;

function streamLines(stream, onLine) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    if (buf.length > MAX_LINE_BYTES) {
      const cut = buf.lastIndexOf('\n');
      if (cut === -1) { buf = buf.slice(-64 * 1024); return; }
    }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  return () => { if (buf) onLine(buf); };
}

function preview(s, n = 100) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

function parseEvent(line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return null; }
  if (!ev || typeof ev !== 'object') return null;

  switch (ev.type) {
    case 'system':
      return { kind: 'system', model: ev.model, tools: (ev.tools || []).length };

    case 'assistant': {
      const blocks = ev.message?.content || [];
      const events = [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) {
          events.push({ kind: 'text', text: preview(b.text, 140) });
        } else if (b.type === 'tool_use') {
          const inp = b.input || {};
          const target = inp.file_path || inp.command || inp.description || '';
          events.push({ kind: 'tool', name: b.name, target: preview(target, 80) });
        }
      }
      return events.length ? { kind: 'assistant', events } : null;
    }

    case 'result':
      return {
        kind: 'result',
        text: ev.result || '',
        sessionId: ev.session_id || null,
        durationMs: ev.duration_ms,
        costUsd: ev.total_cost_usd,
      };

    default:
      return null;
  }
}

/**
 * Spawns `claude -p` and streams progress back via callbacks.
 *
 * @param {object} opts
 * @param {string} opts.prompt       The user's message
 * @param {string} opts.cwd          Working directory (Power Tools repo root)
 * @param {string} [opts.sessionId]  Resume a previous session
 * @param {number} [opts.timeoutMs]  Kill after this many ms (default 120000)
 * @param {AbortSignal} [opts.signal]  External cancellation
 * @param {function} [opts.onProgress]  Called with progress updates
 * @returns {Promise<{text: string, sessionId: string|null, stats: object}>}
 */
async function run(opts) {
  const { prompt, cwd, sessionId, timeoutMs = 120000, signal, onProgress } = opts;

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ];
  if (sessionId) args.push('--resume', sessionId);

  const startedAt = Date.now();
  let toolCount = 0;
  const toolCounts = new Map();
  let resultText = '';
  let resultSessionId = null;
  let resultCost = null;

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd,
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s. Try narrowing the scope.`));
      }, timeoutMs);
    }

    const flushOut = streamLines(child.stdout, (line) => {
      const ev = parseEvent(line);
      if (!ev) return;

      if (ev.kind === 'assistant') {
        for (const sub of ev.events) {
          if (sub.kind === 'tool') {
            toolCount++;
            toolCounts.set(sub.name, (toolCounts.get(sub.name) || 0) + 1);
          }
        }
        if (onProgress) {
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          try {
            onProgress({ elapsed, toolCount, toolCounts, events: ev.events });
          } catch (err) {
            log.warn('progress callback error', { err: err.message });
          }
        }
      }

      if (ev.kind === 'result') {
        resultText = ev.text;
        resultSessionId = ev.sessionId;
        resultCost = ev.costUsd;
      }
    });

    streamLines(child.stderr, (line) => {
      log.warn('claude stderr', { line: preview(line, 240) });
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          'Claude Code CLI not found. Install it first: https://docs.claude.ai/en/docs/claude-code/overview'
        ));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      flushOut();
      if (signal?.aborted) { reject(new Error('Cancelled')); return; }
      if (code !== 0 && !resultText) {
        reject(new Error(`Claude exited with code ${code}`));
        return;
      }
      resolve({
        text: resultText || '(empty response)',
        sessionId: resultSessionId,
        stats: {
          elapsedMs: Date.now() - startedAt,
          toolCount,
          toolCounts: Object.fromEntries(toolCounts),
          costUsd: resultCost,
        },
      });
    });
  });
}

module.exports = { run };
