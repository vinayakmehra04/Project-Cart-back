const { redisConnection } = require('../config/redis');

/**
 * Rate limiter using Redis sliding window
 * @param {number} maxRequests - max requests allowed
 * @param {number} windowSeconds - time window in seconds
 * @param {function} keyFn - function to extract rate limit key from req
 */
function rateLimiter(maxRequests = 60, windowSeconds = 60, keyFn = null) {
  return async (req, res, next) => {
    try {
      // Default key: client ID or IP
      const key = keyFn
        ? keyFn(req)
        : `rl:${req.client?.id || req.ip}`;

      const now = Date.now();
      const windowMs = windowSeconds * 1000;

      // Remove old entries, add current, count
      const multi = redisConnection.multi();
      multi.zremrangebyscore(key, 0, now - windowMs);
      multi.zadd(key, now, `${now}-${Math.random()}`);
      multi.zcard(key);
      multi.pexpire(key, windowMs);

      const results = await multi.exec();
      const requestCount = results[2][1];

      // Set rate limit headers
      res.set('X-RateLimit-Limit', maxRequests);
      res.set('X-RateLimit-Remaining', Math.max(0, maxRequests - requestCount));
      res.set('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (requestCount > maxRequests) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: windowSeconds,
        });
      }

      next();
    } catch (err) {
      // If Redis is down, let the request through (fail open)
      console.error('Rate limiter error:', err.message);
      next();
    }
  };
}

module.exports = { rateLimiter };
