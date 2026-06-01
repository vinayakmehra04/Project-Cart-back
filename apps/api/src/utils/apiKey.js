const crypto = require('crypto');
const { nanoid } = require('nanoid');

const API_KEY_PREFIX = 'cb_sk_';

/**
 * Generate a new API key
 * Returns { fullKey, keyPrefix, keyHash }
 * fullKey is shown to the user ONCE — never stored
 */
function generateAPIKey() {
  const randomPart = nanoid(32);
  const fullKey = `${API_KEY_PREFIX}${randomPart}`;
  const keyPrefix = fullKey.substring(0, 12); // "cb_sk_a1b2c3" for display
  const keyHash = hashAPIKey(fullKey);

  return { fullKey, keyPrefix, keyHash };
}

/**
 * SHA-256 hash of a key — this is what we store in the DB
 */
function hashAPIKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Verify a provided key against a stored hash
 */
function verifyAPIKey(providedKey, storedHash) {
  const providedHash = hashAPIKey(providedKey);
  return crypto.timingSafeEqual(
    Buffer.from(providedHash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}

module.exports = { generateAPIKey, hashAPIKey, verifyAPIKey };
