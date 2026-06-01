const express = require('express');
const { Queue } = require('bullmq');
const { redisConnection } = require('../../config/redis');
const { supabase } = require('../../config/database');
const { authenticateAPIKey } = require('../../middleware/authAPIKey');
const { parseWooCommerceCart } = require('../../parsers');
const { upsertCustomer, upsertCart, markCartRecovered } = require('../../services/cartService');

const router = express.Router();

const abandonmentQueue = new Queue('check-cart-abandonment', {
  connection: redisConnection,
});

/**
 * WooCommerce webhook handler
 * Auth: API key in X-API-Key header (set by client in WooCommerce webhook config)
 */
router.post('/cart', authenticateAPIKey, async (req, res) => {
  try {
    const wcTopic = req.headers['x-wc-webhook-topic'] || 'cart';

    // Log raw webhook
    await supabase.from('webhook_events_raw').insert({
      client_id: req.client.id,
      platform: 'woocommerce',
      event_type: wcTopic,
      headers: {
        'x-wc-webhook-topic': wcTopic,
        'x-wc-webhook-source': req.headers['x-wc-webhook-source'],
        'x-wc-webhook-id': req.headers['x-wc-webhook-id'],
      },
      payload: req.body,
      processed: false,
    }).catch(() => {});

    // Determine event type
    let eventType = 'cart';
    if (wcTopic.includes('order')) eventType = 'order';
    if (wcTopic.includes('checkout')) eventType = 'checkout';

    const parsed = parseWooCommerceCart(req.body, eventType);
    if (!parsed) return res.status(200).send('OK');

    // ORDER COMPLETED
    if (eventType === 'order') {
      if (parsed.external_cart_id) {
        const { data: carts } = await supabase
          .from('carts')
          .select('*')
          .eq('client_id', req.client.id)
          .eq('external_cart_id', parsed.external_cart_id)
          .in('status', ['active', 'abandoned'])
          .limit(1);

        if (carts?.[0]) {
          await markCartRecovered(carts[0].id, parsed);
        }
      }
      return res.status(200).send('OK');
    }

    // CART / CHECKOUT
    if (!parsed.phone) {
      // Can't do much without a phone number
      return res.status(200).send('OK');
    }

    const customer = await upsertCustomer(req.client.id, {
      phone: parsed.phone,
      email: parsed.email,
      name: parsed.name,
      platform: 'woocommerce',
      external_id: parsed.external_customer_id,
    });

    const { cart } = await upsertCart(req.client.id, customer.id, parsed);

    // Schedule abandonment check
    const delayMs = (req.client.cart_timeout_minutes || 30) * 60 * 1000;
    await abandonmentQueue.add(
      `check-${cart.id}`,
      {
        cartId: cart.id,
        clientId: req.client.id,
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
    console.error('WooCommerce webhook error:', err);
    res.status(200).send('OK');
  }
});

module.exports = router;
