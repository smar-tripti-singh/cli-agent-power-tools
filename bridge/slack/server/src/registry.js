const fs = require('fs');
const path = require('path');
const { make } = require('./logger');

const log = make('registry');
const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

// userId -> { userId, name, registeredAt, tokenHash, connection, queue }
const users = new Map();
let snapshotTimer = null;

function register(userId, name, tokenHash) {
  users.set(userId, {
    userId,
    name,
    registeredAt: new Date().toISOString(),
    tokenHash,
    connection: null,
    queue: [],
  });
  scheduleSnapshot();
}

function get(userId) {
  return users.get(userId) || null;
}

function all() {
  return Array.from(users.values());
}

function isRegistered(userId) {
  return users.has(userId);
}

function setConnection(userId, ws) {
  const user = users.get(userId);
  if (user) {
    user.connection = ws;
    user.lastSeen = new Date().toISOString();
    user.connectionState = ws ? 'connected' : 'disconnected';
    if (!ws) user.disconnectedAt = new Date().toISOString();
  }
}

function getConnection(userId) {
  return users.get(userId)?.connection || null;
}

function isOnline(userId) {
  const user = users.get(userId);
  if (!user || !user.connection) return false;
  return user.connection.readyState === 1; // WebSocket.OPEN
}

function enqueue(userId, event, config) {
  const user = users.get(userId);
  if (!user) return false;
  if (user.queue.length >= config.maxQueueSize) {
    user.queue.shift(); // drop oldest
    log.warn('queue full, dropped oldest message', { userId });
  }
  user.queue.push({ event, queuedAt: Date.now() });
  scheduleSnapshot();
  return true;
}

function drainQueue(userId, config) {
  const user = users.get(userId);
  if (!user) return [];
  const now = Date.now();
  const valid = user.queue.filter(item => now - item.queuedAt < config.queueTtlMs);
  user.queue = [];
  scheduleSnapshot();
  return valid;
}

function revoke(userId) {
  users.delete(userId);
  scheduleSnapshot();
}

function updateTokenHash(userId, tokenHash) {
  const user = users.get(userId);
  if (user) {
    user.tokenHash = tokenHash;
    scheduleSnapshot();
  }
}

function scheduleSnapshot() {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    saveSnapshot();
  }, 60000);
}

function saveSnapshot() {
  try {
    const data = {};
    for (const [id, user] of users.entries()) {
      data[id] = {
        userId: user.userId,
        name: user.name,
        registeredAt: user.registeredAt,
        tokenHash: user.tokenHash,
        queue: user.queue,
      };
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log.error('snapshot save failed', { err: err.message });
  }
}

function loadSnapshot() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [id, entry] of Object.entries(data)) {
      users.set(id, {
        userId: entry.userId,
        name: entry.name,
        registeredAt: entry.registeredAt,
        tokenHash: entry.tokenHash,
        connection: null,
        connectionState: 'disconnected',
        queue: entry.queue || [],
      });
    }
    log.info('registry loaded', { users: users.size });
  } catch (err) {
    log.error('snapshot load failed', { err: err.message });
  }
}

module.exports = {
  register,
  get,
  all,
  isRegistered,
  setConnection,
  getConnection,
  isOnline,
  enqueue,
  drainQueue,
  revoke,
  updateTokenHash,
  loadSnapshot,
  saveSnapshot,
};
