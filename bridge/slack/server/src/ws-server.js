const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, issueToken, hashToken } = require('./auth');
const registry = require('./registry');
const { make } = require('./logger');

const log = make('ws-server');

const AUTH_TIMEOUT_MS = 10000;

function send(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, id: uuidv4(), timestamp: Date.now(), payload }));
}

function startWsServer(config, slackPoster) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptime: Math.floor(process.uptime()) }));
      return;
    }
    if (req.url === '/status') {
      const users = registry.all().map(u => ({
        userId: u.userId,
        name: u.name,
        state: u.connectionState || 'disconnected',
        lastSeen: u.lastSeen,
        queueDepth: u.queue.length,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connectedUsers: users.filter(u => u.state === 'connected').length, totalRegistered: users.length, users }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/register') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try {
          const { userId, regCode, name } = JSON.parse(body);
          if (regCode !== config.registrationCode) {
            res.writeHead(403); res.end(JSON.stringify({ error: 'invalid_code' })); return;
          }
          if (!userId || !userId.startsWith('U')) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_user_id' })); return;
          }
          if (registry.isRegistered(userId)) {
            res.writeHead(409); res.end(JSON.stringify({ error: 'already_registered' })); return;
          }
          const token = issueToken(userId, config.jwtSecret);
          registry.register(userId, name || userId, hashToken(token));
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          log.info('user registered', { userId, name });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ token, expiresAt }));
        } catch (err) {
          res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/refresh') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try {
          const authHeader = req.headers.authorization || '';
          const oldToken = authHeader.replace('Bearer ', '');
          const claims = verifyToken(oldToken, config.jwtSecret);
          const user = registry.get(claims.sub);
          if (!user) { res.writeHead(404); res.end(JSON.stringify({ error: 'not_registered' })); return; }
          const newToken = issueToken(claims.sub, config.jwtSecret);
          registry.updateTokenHash(claims.sub, hashToken(newToken));
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ token: newToken, expiresAt }));
        } catch (err) {
          res.writeHead(401); res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/revoke') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try {
          const { userId } = JSON.parse(body);
          const user = registry.get(userId);
          if (user?.connection) {
            send(user.connection, 'auth_fail', { reason: 'revoked' });
            user.connection.close();
          }
          registry.revoke(userId);
          log.info('user revoked', { userId });
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let authenticated = false;
    let userId = null;

    // Close if no auth within timeout
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        send(ws, 'auth_fail', { reason: 'auth_timeout' });
        ws.close();
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'auth') {
        try {
          const claims = verifyToken(msg.payload.token, config.jwtSecret);
          const user = registry.get(claims.sub);
          if (!user) { send(ws, 'auth_fail', { reason: 'not_registered' }); ws.close(); return; }

          clearTimeout(authTimer);
          authenticated = true;
          userId = claims.sub;
          registry.setConnection(userId, ws);

          const queued = registry.drainQueue(userId, config);
          send(ws, 'auth_ok', { userId, queuedCount: queued.length });
          log.info('user connected', { userId: user.userId, name: user.name });

          // Deliver queued messages one at a time
          if (queued.length > 0) {
            let i = 0;
            function deliverNext() {
              if (i >= queued.length) return;
              send(ws, 'queue_drain', { slackEvent: queued[i].event, queuedAt: queued[i].queuedAt });
              i++;
            }
            deliverNext();
            // Subsequent ones delivered on ack (handled below)
            ws._queueItems = queued;
            ws._queueIndex = 1;
          }

        } catch (err) {
          send(ws, 'auth_fail', { reason: err.message });
          ws.close();
        }
        return;
      }

      if (!authenticated) return;

      if (msg.type === 'ack') {
        // Deliver next queued item if any
        if (ws._queueItems && ws._queueIndex < ws._queueItems.length) {
          const item = ws._queueItems[ws._queueIndex++];
          send(ws, 'queue_drain', { slackEvent: item.event, queuedAt: item.queuedAt });
        }
        return;
      }

      if (msg.type === 'heartbeat') {
        send(ws, 'heartbeat', {});
        registry.get(userId).lastSeen = new Date().toISOString();
        return;
      }

      if (msg.type === 'status') {
        const { channel, threadTs, text, statusMessageId } = msg.payload;
        if (!statusMessageId) {
          // First status — create the thread message and send ts back to client
          slackPoster.postStatus(channel, threadTs, text).then((ts) => {
            if (ts) send(ws, 'status_id', { statusMessageId: ts });
          }).catch(() => {});
        } else {
          slackPoster.updateStatus(channel, threadTs, statusMessageId, text).catch(() => {});
        }
        return;
      }

      if (msg.type === 'result') {
        // User's machine finished — post result to Slack
        const { channel, threadTs, text, statusMessageId, stats } = msg.payload;
        slackPoster.postResult(channel, threadTs, text, statusMessageId, stats)
          .catch((err) => log.error('failed to post result', { err: err.message, userId }));
        return;
      }
    });

    ws.on('close', () => {
      if (userId) {
        registry.setConnection(userId, null);
        log.info('user disconnected', { userId });
      }
    });

    ws.on('error', (err) => {
      log.error('ws error', { userId, err: err.message });
    });
  });

  server.listen(config.port, () => {
    log.info('ws server listening', { port: config.port });
  });

  return { server, wss };
}

module.exports = { startWsServer, send };
