const IORedis = require('ioredis');
const { env } = require('./env');

// Shared Redis connection for BullMQ
const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
});

redisConnection.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

redisConnection.on('connect', () => {
  console.log('✅ Redis connected');
});

module.exports = { redisConnection };
