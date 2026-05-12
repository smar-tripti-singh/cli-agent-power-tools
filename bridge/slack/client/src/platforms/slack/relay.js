const WebSocket = require('ws');
const { Platform, Message } = require('../../core/platform');
const { chunk } = require('./message');
const { make } = require('../../lib/logger');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = make('slack:relay');
const RELAY_CONFIG_FILE = path.join(os.homedir(), '.smartbridge', 'relay.json');
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000, 60000];

class RelayMessage extends Message {
  constructor({ ws, platform, event }) {
    super({
      text: (event.text || '').trim(),
      userId: event.user,
      userName: event.user,
      threadId: event.thread_ts || event.ts,
      channelId: event.channel,
      platform: 'slack:relay',
    });
    this._ws = ws;
    this._platform = platform;
    this._channel = event.channel;
    this._threadTs = event.thread_ts || event.ts;
    this._eventId = event.eventId;
    this._statusMessageId = null;
  }

  async reply(text) {
    const parts = chunk(String(text || '(empty)'));
    for (const part of parts) {
      this._send('result', {
        eventId: this._eventId,
        channel: this._channel,
        threadTs: this._threadTs,
        text: part,
        statusMessageId: this._statusMessageId,
      });
    }
  }

  async postStatus(text) {
    // Send status with no statusMessageId — server will create thread and send back the ts
    return new Promise((resolve) => {
      this._platform._pendingStatusCallback = (ts) => {
        this._statusMessageId = ts;
        resolve();
      };
      this._send('status', {
        channel: this._channel,
        threadTs: this._threadTs,
        text,
        statusMessageId: null,
      });
      // Resolve after 3s even if no status_id comes back
      setTimeout(resolve, 3000);
    });
  }

  async updateStatus(text) {
    this._send('status', {
      channel: this._channel,
      threadTs: this._threadTs,
      text,
      statusMessageId: this._statusMessageId,
    });
  }

  _send(type, payload) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({
      type,
      id: `${type}-${Date.now()}`,
      timestamp: Date.now(),
      payload,
    }));
  }
}

class SlackRelayPlatform extends Platform {
  constructor() {
    super();
    this._ws = null;
    this._reconnectAttempt = 0;
    this._stopping = false;
    this._dispatcher = null;
    this._config = null;
    this._relayConfig = null;
    this._pendingStatusCallback = null;
  }

  get name() { return 'slack:relay'; }

  isConfigured() {
    try {
      const data = JSON.parse(fs.readFileSync(RELAY_CONFIG_FILE, 'utf8'));
      return !!(data.serverUrl && data.token);
    } catch {
      return false;
    }
  }

  async start(config, dispatcher) {
    this._dispatcher = dispatcher;
    this._config = config;
    this._relayConfig = JSON.parse(fs.readFileSync(RELAY_CONFIG_FILE, 'utf8'));
    this._connect();
  }

  _connect() {
    if (this._stopping) return;

    const { serverUrl, token } = this._relayConfig;
    log.info('connecting to relay server', { serverUrl });

    this._ws = new WebSocket(serverUrl);

    this._ws.on('open', () => {
      this._reconnectAttempt = 0;
      this._ws.send(JSON.stringify({
        type: 'auth',
        id: `auth-${Date.now()}`,
        timestamp: Date.now(),
        payload: { token, clientVersion: '0.1.0' },
      }));
    });

    this._ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      this._handleMessage(msg);
    });

    this._ws.on('close', () => {
      log.warn('connection closed, will reconnect');
      this._scheduleReconnect();
    });

    this._ws.on('error', (err) => {
      log.error('connection error', { err: err.message });
    });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'auth_ok':
        log.info('authenticated', { queuedCount: msg.payload.queuedCount });
        break;

      case 'auth_fail': {
        const reason = msg.payload.reason;
        log.error('auth failed', { reason });
        this._stopping = true;
        this._ws.close();
        if (reason === 'revoked' || reason === 'not_registered' || reason === 'invalid signature') {
          // Token is permanently invalid — delete local config so user knows to re-register
          try { fs.unlinkSync(RELAY_CONFIG_FILE); } catch {}
          console.error('\n[SmartBridge] Your relay registration has been revoked or is invalid.');
          console.error('  Run: npm run relay:register\n');
          process.exit(1);
        }
        break;
      }

      case 'heartbeat':
        this._ws.send(JSON.stringify({
          type: 'heartbeat', id: `hb-${Date.now()}`, timestamp: Date.now(), payload: {},
        }));
        break;

      case 'status_id':
        // Server created the status message — store its ts for future updates
        if (this._pendingStatusCallback) {
          this._pendingStatusCallback(msg.payload.statusMessageId);
          this._pendingStatusCallback = null;
        }
        break;

      case 'event':
      case 'queue_drain': {
        const { slackEvent, eventId } = msg.payload;
        this._ws.send(JSON.stringify({
          type: 'ack', id: `ack-${Date.now()}`, timestamp: Date.now(), payload: { eventId },
        }));

        const text = (slackEvent.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
        if (!text) break;

        log.info('event received', { user: slackEvent.user, channel: slackEvent.channel });

        const relayMsg = new RelayMessage({
          ws: this._ws,
          platform: this,
          event: { ...slackEvent, text, eventId },
        });

        this._dispatcher.handle(relayMsg, this._config).catch(err => {
          log.error('dispatch error', { err: err.message });
        });
        break;
      }
    }
  }

  _scheduleReconnect() {
    if (this._stopping) return;
    const delay = RECONNECT_DELAYS[Math.min(this._reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this._reconnectAttempt++;
    log.info('reconnecting', { delayMs: delay, attempt: this._reconnectAttempt });
    setTimeout(() => this._connect(), delay);
  }

  async stop() {
    this._stopping = true;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    log.info('relay disconnected');
  }
}

module.exports = { SlackRelayPlatform };
