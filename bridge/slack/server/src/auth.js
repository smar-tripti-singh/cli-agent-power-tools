const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function issueToken(userId, secret) {
  return jwt.sign(
    { sub: userId, iss: 'smartbridge-relay', scope: 'connect' },
    secret,
    { expiresIn: '30d' }
  );
}

function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}

function hashToken(token) {
  return 'sha256:' + crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { issueToken, verifyToken, hashToken };
