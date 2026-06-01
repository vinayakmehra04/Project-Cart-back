const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { supabase } = require('../config/database');
const { env } = require('../config/env');
const { authenticateJWT } = require('../middleware/authJWT');

const router = express.Router();

// ======================== SHOPIFY INSTALL (START OAuth) ========================
router.get('/shopify/install', authenticateJWT, (req, res) => {
  const shop = req.query.shop;
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Valid shop domain required (e.g., store.myshopify.com)' });
  }

  // Generate a random nonce for CSRF protection
  const nonce = crypto.randomBytes(16).toString('hex');

  // Store nonce temporarily (in production, use Redis with a TTL)
  // For now, store in client record
  supabase
    .from('clients')
    .update({ shopify_shop_domain: shop })
    .eq('id', req.client.id)
    .then(() => {});

  const redirectUri = `${env.API_URL}/api/integrations/shopify/callback`;
  const scopes = env.SHOPIFY_SCOPES;

  const installUrl = `https://${shop}/admin/oauth/authorize`
    + `?client_id=${env.SHOPIFY_API_KEY}`
    + `&scope=${scopes}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&state=${nonce}`;

  res.json({ install_url: installUrl });
});

// ======================== SHOPIFY CALLBACK (Finish OAuth) ========================
router.get('/shopify/callback', async (req, res) => {
  try {
    const { code, shop, state, hmac } = req.query;

    if (!code || !shop || !hmac) {
      return res.status(400).send('Missing required parameters');
    }

    // Verify HMAC
    const params = { ...req.query };
    delete params.hmac;
    delete params.signature;

    const sortedParams = Object.keys(params).sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');

    const computedHmac = crypto
      .createHmac('sha256', env.SHOPIFY_API_SECRET)
      .update(sortedParams)
      .digest('hex');

    if (computedHmac !== hmac) {
      return res.status(401).send('HMAC verification failed');
    }

    // Exchange code for permanent access token
    const tokenResp = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      code,
    });

    const accessToken = tokenResp.data.access_token;

    // Find the client by shop domain
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('shopify_shop_domain', shop)
      .single();

    if (!client) {
      return res.status(404).send('Client not found for this shop');
    }

    // Save access token
    await supabase
      .from('clients')
      .update({
        shopify_access_token: accessToken,
        platform: 'shopify',
      })
      .eq('id', client.id);

    // Register webhooks
    const webhookTopics = [
      'carts/create',
      'carts/update',
      'checkouts/create',
      'orders/paid',
    ];

    const topicToEndpoint = {
      'carts/create': 'cart-create',
      'carts/update': 'cart-create', // Same handler
      'checkouts/create': 'checkout-create',
      'orders/paid': 'order-paid',
    };

    for (const topic of webhookTopics) {
      try {
        await axios.post(
          `https://${shop}/admin/api/2024-01/webhooks.json`,
          {
            webhook: {
              topic,
              address: `${env.API_URL}/api/webhooks/shopify/${topicToEndpoint[topic]}`,
              format: 'json',
            },
          },
          {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log(`✅ Registered Shopify webhook: ${topic}`);
      } catch (err) {
        console.error(`Failed to register webhook ${topic}:`, err.response?.data || err.message);
      }
    }

    // Redirect to frontend dashboard
    res.redirect(`${env.FRONTEND_URL}/dashboard/settings?shopify=connected`);
  } catch (err) {
    console.error('Shopify OAuth error:', err.response?.data || err.message);
    res.status(500).send('Shopify connection failed');
  }
});

// ======================== CONNECTION STATUS ========================
router.get('/status', authenticateJWT, async (req, res) => {
  res.json({
    shopify: {
      connected: !!req.client.shopify_access_token,
      shop: req.client.shopify_shop_domain || null,
    },
    woocommerce: {
      connected: !!req.client.woo_consumer_key,
      store_url: req.client.woo_store_url || null,
    },
    whatsapp: {
      connected: !!req.client.wa_phone_number_id || req.client.use_shared_wa,
      using_shared: req.client.use_shared_wa,
    },
  });
});

// ======================== WooCommerce SETUP ========================
router.post('/woocommerce/connect', authenticateJWT, async (req, res, next) => {
  try {
    const { store_url, consumer_key, consumer_secret } = req.body;

    if (!store_url || !consumer_key || !consumer_secret) {
      return res.status(400).json({ error: 'store_url, consumer_key, and consumer_secret required' });
    }

    // Test the connection
    try {
      await axios.get(`${store_url}/wp-json/wc/v3/system_status`, {
        auth: { username: consumer_key, password: consumer_secret },
        timeout: 10000,
      });
    } catch {
      return res.status(400).json({ error: 'Could not connect to WooCommerce store. Check credentials.' });
    }

    await supabase
      .from('clients')
      .update({
        woo_store_url: store_url,
        woo_consumer_key: consumer_key,
        woo_consumer_secret: consumer_secret,
        platform: 'woocommerce',
      })
      .eq('id', req.client.id);

    res.json({ message: 'WooCommerce connected successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
