const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.smartbridge');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PID_FILE = path.join(CONFIG_DIR, 'smartbridge.pid');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');

const DEFAULTS = {
  slack: { botToken: null, connected: false, workspaceName: null },
  userId: null,
  settings: {
    maxConcurrentJobs: 3,
    jobTimeoutMs: 600000,
    pollIntervalMs: 10000,
  },
  powerToolsDir: null,
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir(CONFIG_DIR);
  ensureDir(LOG_DIR);
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const saved = JSON.parse(raw);
    return merge(DEFAULTS, saved);
  } catch {
    return { ...DEFAULTS };
  }
}

function save(config) {
  ensureDir(CONFIG_DIR);
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
  return config;
}

function update(patch) {
  const current = load();
  const updated = merge(current, patch);
  return save(updated);
}

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = merge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function resolvePowerToolsDir() {
  const config = load();
  if (config.powerToolsDir) return config.powerToolsDir;

  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.claude', 'agents'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function writePid() {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function readPid() {
  try {
    return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  } catch {
    return null;
  }
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function isRunning() {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    clearPid();
    return false;
  }
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  PID_FILE,
  LOG_DIR,
  load,
  save,
  update,
  resolvePowerToolsDir,
  writePid,
  readPid,
  clearPid,
  isRunning,
};
