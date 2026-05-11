const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel = LEVELS.info;

function setLevel(level) {
  minLevel = LEVELS[level] ?? LEVELS.info;
}

function log(level, tag, msg, data) {
  if (LEVELS[level] < minLevel) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component: tag,
    msg,
    ...data,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

function make(tag) {
  return {
    debug: (msg, data) => log('debug', tag, msg, data),
    info: (msg, data) => log('info', tag, msg, data),
    warn: (msg, data) => log('warn', tag, msg, data),
    error: (msg, data) => log('error', tag, msg, data),
  };
}

module.exports = { make, setLevel };
