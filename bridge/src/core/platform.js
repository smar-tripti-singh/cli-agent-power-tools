/**
 * Abstract platform interface.
 *
 * Every messaging platform extends this class.
 * The dispatcher only interacts through this interface.
 *
 * To add a new platform:
 *   1. Create platforms/<name>.js
 *   2. Export a class extending Platform
 *   3. Implement all methods below
 *   4. Register it in index.js
 */
class Platform {
  get name() { throw new Error('name not implemented'); }

  isConfigured(config) { throw new Error('isConfigured not implemented'); }

  async start(config, dispatcher) { throw new Error('start not implemented'); }

  async stop() { throw new Error('stop not implemented'); }
}

class Message {
  constructor({ text, userId, userName, threadId, channelId, platform }) {
    this.text = text;
    this.userId = userId;
    this.userName = userName || 'unknown';
    this.threadId = threadId;
    this.channelId = channelId;
    this.platform = platform;
    this._statusMessageId = null;
  }

  async reply(text) { throw new Error('reply not implemented'); }

  async postStatus(text) { throw new Error('postStatus not implemented'); }

  async updateStatus(text) { throw new Error('updateStatus not implemented'); }

  async showTyping() {}
}

module.exports = { Platform, Message };
