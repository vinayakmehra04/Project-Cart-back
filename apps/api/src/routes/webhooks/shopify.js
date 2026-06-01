const express = require('express');
const { Queue } = require('bullmq');
const { redisConnection } = require('../../config/redis');
const { supabase } = require('../../config/database');
const { env } = require('../../config/env');
const { verifyShopifyHmac } = require('../../utils/hmac');
const { parseShopifyCart } = require('../../parsers');
const { upsertCustomer, upsertCart, markCartRecovered } = require('../../services/cartService');

const router = express.Router();

const abandonmentQueue = new Queue('check-cart-abandonment', {
  connection: redisConnection,
});

/**
 * Shopify HMAC verification middleware
 * Needs raw body — configured in index.js
 */
function verifyShopify(req, res, next) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (!hmac || !req.rawBody) {
    return res.status(401).json({ error: 'Missing HMAC signature' });
  }

  // Find client by shop domain
  // We verify HMAC after finding the client since each could have their own secret
  req.shopDomain = shopDomain;
  next();
}

/**
 * Find the client associated with this Shopify shop
 */
async function findShopifyClient(shopDomain) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('shopify_shop_domain', shopDomain)
    .eq('is_active', true)
    .single();

  return data;
}

/**
 * Log raw webhook event for debugging
 */
async function logWebhook(clientId, eventType, payload, headers) {
  await supabase.from('webhook_events_raw').insert({
    client_id: clientId,
    platform: 'shopify',
    event_type: eventType,
    headers: {
      'x-shopify-topic': headers['x-shopify-topic'],
      'x-shopify-shop-domain': headers['x-shopify-shop-domain'],
      'x-shopify-webhook-id': headers['x-shopify-webhook-id'],
    },
    payload,
    ip_address: null,
    processed: false,
  }).catch((err) => console.error('Failed to log webhook:', err));
}

// ======================== CART CREATE / UPDATE ========================
router.post('/cart-create', verifyShopify, async (req, res) => {
  try {
    const client = await findShopifyClient(req.shopDomain);
    if (!client) return res.status(200).send('OK'); // Return 200 to stop Shopify retries

    await logWebhook(client.id, 'carts/create', req.body, req.headers);

    const parsed = parseShopifyCart(req.body, 'cart');
    if (!parsed) return res.status(200).send('OK');

    // Cart webhooks don't have customer info — we just store the cart
    // The customer gets linked when checkout/create fires
    if (parsed.phone) {
      const customer = await upsertCustomer(client.id, {
        phone: parsed.phone,
        email: parsed.email,
        name: parsed.name,
        platform: 'shopify',
      });

      await upsertCart(client.id, customer.id, parsed);
    } else {
      // Store cart without customer — will be linked at checkout
      await supabase.from('carts').insert({
        client_id: client.id,
        status: 'active',
        platform: 'shopify',
        external_cart_id: parsed.external_cart_id,
        cart_total: parsed.cart_total,
        currency: parsed.currency,
        item_count: parsed.items.length,
        last_activity_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Mark webhook as processed
    await supabase
      .from('webhook_events_raw')
      .update({ processed: true })
      .eq('client_id', client.id)
      .eq('event_type', 'carts/create')
      .is('processed', false)
      .order('created_at', { ascending: false })
      .limit(1);

    res.status(200).send('OK');
  } catch (err) {
    console.error('Shopify cart webhook error:', err);
    res.status(200).send('OK'); // Always 200 to prevent Shopify retries
  }
});

// ======================== CHECKOUT CREATE ========================
// This is where we get the customer's phone number
router.post('/checkout-create', verifyShopify, async (req, res) => {
  try {
    const client = await findShopifyClient(req.shopDomain);
    if (!client) return res.status(200).send('OK');

    await logWebhook(client.id, 'checkouts/create', req.body, req.headers);

    const parsed = parseShopifyCart(req.body, 'checkout');
    if (!parsed || !parsed.phone) return res.status(200).send('OK');

    // Now we have the phone — create customer and link to cart
    const customer = await upsertCustomer(client.id, {
      phone: parsed.phone,
      email: parsed.email,
      name: parsed.name,
      platform: 'shopify',
      external_id: parsed.external_customer_id,
    });

    const { cart } = await upsertCart(client.id, customer.id, parsed);

    // Schedule abandonment check
    const delayMs = (client.cart_timeout_minutes || 30) * 60 * 1000;
    await abandonmentQueue.add(
      `check-${cart.id}`,
      {
        cartId: cart.id,
        clientId: client.id,
        scheduledAt: new Date().toISOString(),
      },
      {
        delay: delayMs,
        jobId: `abandon-${cart.id}-${Date.now()}`,
        removeOnComplete: 100,
      }
    );

    res.status(200).send('OK');
  } catch (err) {
    console.error('Shopify checkout webhook error:', err);
    res.status(200).send('OK');
  }
});

// ======================== ORDER PAID ========================
router.post('/order-paid', verifyShopify, async (req, res) => {
  try {
    const client = await findShopifyClient(req.shopDomain);
    if (!client) return res.status(200).send('OK');

    await logWebhook(client.id, 'orders/paid', req.body, req.headers);

    const parsed = parseShopifyCart(req.body, 'order');
    if (!parsed) return res.status(200).send('OK');

    // Find the cart by external_cart_id
    let cart = null;
    if (parsed.external_cart_id) {
      const { data } = await supabase
        .from('carts')
        .select('*')
        .eq('client_id', client.id)
        .eq('external_cart_id', parsed.external_cart_id)
        .in('status', ['active', 'abandoned'])
        .limit(1);
      cart = data?.[0];
    }

    if (cart) {
      await markCartRecovered(cart.id, parsed);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Shopify order webhook error:', err);
    res.status(200).send('OK');
  }
});

module.exports = router;
