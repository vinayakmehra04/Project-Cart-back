const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { env } = require('./config/env');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ======================== GLOBAL MIDDLEWARE ========================

// Security headers
app.use(helmet());

// CORS — allow dashboard frontend
app.use(cors({
  origin: [
    env.FRONTEND_URL,
    'http://localhost:3000',
    'https://project-cart-back-web.vercel.app',
  ],
  credentials: true,
}));

// Body parsing with raw body capture for HMAC verification
// Shopify and Razorpay need the raw body to verify signatures
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));

app.use(express.urlencoded({ extended: true }));

// Trust proxy (Railway/Vercel sit behind a reverse proxy)
app.set('trust proxy', 1);

// ======================== HEALTH CHECK ========================
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cartback-api',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ======================== ROUTE MOUNTING ========================

// Auth routes (public)
app.use('/api/auth', require('./routes/auth'));

// Cart tracking routes (API key auth)
app.use('/api/track', require('./routes/track'));

// Platform webhooks
app.use('/api/webhooks/shopify', require('./routes/webhooks/shopify'));
app.use('/api/webhooks/woocommerce', require('./routes/webhooks/woocommerce'));
app.use('/api/webhooks/whatsapp', require('./routes/webhooks/whatsapp'));

// Dashboard routes (JWT auth)
app.use('/api/dashboard', require('./routes/dashboard'));

// Automation rules (JWT auth)
app.use('/api/automations', require('./routes/automations'));

// Message templates (JWT auth)
app.use('/api/templates', require('./routes/templates'));

// Billing / Razorpay (mixed auth)
app.use('/api/billing', require('./routes/billing'));

// Integrations — Shopify OAuth, WooCommerce setup
app.use('/api/integrations', require('./routes/integrations'));

// ======================== 404 HANDLER ========================
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ======================== ERROR HANDLER ========================
app.use(errorHandler);

// ======================== START SERVER + WORKERS + CRONS ========================
async function start() {
  const PORT = parseInt(env.PORT) || 4000;

  // Start BullMQ workers
  try {
    require('./workers/abandonmentWorker');
    console.log('✅ Abandonment worker started');
  } catch (err) {
    console.error('⚠️ Abandonment worker failed to start:', err.message);
  }

  try {
    require('./workers/messagingWorker');
    console.log('✅ Messaging worker started');
  } catch (err) {
    console.error('⚠️ Messaging worker failed to start:', err.message);
  }

  // Start cron jobs
  try {
    const { startUsageResetCron } = require('./cron/usageReset');
    startUsageResetCron();
  } catch (err) {
    console.error('⚠️ Usage reset cron failed:', err.message);
  }

  try {
    const { startWebhookCleanupCron } = require('./cron/cleanupWebhooks');
    startWebhookCleanupCron();
  } catch (err) {
    console.error('⚠️ Webhook cleanup cron failed:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║   🛒 CartBack API v1.0.0                ║
║   Running on port ${PORT}                  ║
║   Environment: ${env.NODE_ENV}              ║
║                                          ║
╚══════════════════════════════════════════╝
    `);
  });
}

start().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

module.exports = app; // For testing
