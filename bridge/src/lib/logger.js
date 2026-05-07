const fs = require('fs');
const path = require('path');
const { LOG_DIR } = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel = LEVELS.info;
let logStream = null;

function setLevel(level) {
  minLevel = LEVELS[level] ?? LEVELS.info;
}

function ensureLogStream() {
  if (logStream) return;
  try {
    const file = path.join(LOG_DIR, 'smartbridge.log');
    logStream = fs.createWriteStream(file, { flags: 'a' });
  } catch {}
}

function format(level, tag, msg, data) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${tag}] ${msg}`;
  if (data && Object.keys(data).length) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

function log(level, tag, msg, data) {
  if (LEVELS[level] < minLevel) return;
  const line = format(level, tag, msg, data);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
  ensureLogStream();
  if (logStream) logStream.write(line + '\n');
}

function make(tag) {
  return {
    debug: (msg, data) => log('debug', tag, msg, data),
    info: (msg, data) => log('info', tag, msg, data),
    warn: (msg, data) => log('warn', tag, msg, data),
    error: (msg, data) => log('error', tag, msg, data),
  };
}

module.exports = { make };
