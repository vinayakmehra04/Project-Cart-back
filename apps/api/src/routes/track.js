const express = require('express');
const { Queue } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { supabase } = require('../config/database');
const { authenticateAPIKey } = require('../middleware/authAPIKey');
const { rateLimiter } = require('../middleware/rateLimiter');
const { upsertCustomer, upsertCart, markCartRecovered } = require('../services/cartService');
const { canTrackCart } = require('../services/usageService');
const { trackCartSchema, trackPurchaseSchema, trackConsentSchema } = require('../utils/validators');

const router = express.Router();

// BullMQ queue for abandonment checks
const abandonmentQueue = new Queue('check-cart-abandonment', {
  connection: redisConnection,
});

// All tracking routes use API key auth
router.use(authenticateAPIKey);

// Rate limit: 100 requests per minute per client
router.use(rateLimiter(100, 60, (req) => `rl:track:${req.client.id}`));

// ======================== TRACK CART ========================
router.post('/cart', async (req, res, next) => {
  try {
    const body = trackCartSchema.parse(req.body);

    // Check cart tracking limit
    const usageCheck = await canTrackCart(req.client.id);
    if (!usageCheck.allowed) {
      return res.status(429).json({
        error: 'Monthly cart tracking limit reached',
        usage: usageCheck,
      });
    }

    // Upsert customer
    const customer = await upsertCustomer(req.client.id, {
      phone: body.phone,
      email: body.email,
      name: body.name,
      platform: req.client.platform,
      consent: body.consent,
      consentSource: 'api',
      consentIp: req.ip,
    });

    // Upsert cart
    const { cart, isNew } = await upsertCart(req.client.id, customer.id, {
      ...body,
      platform: req.client.platform,
      user_agent: req.headers['user-agent'],
      ip_address: req.ip,
    });

    // Schedule abandonment check (delayed job)
    const delayMinutes = req.client.cart_timeout_minutes || 30;
    const delayMs = delayMinutes * 60 * 1000;

    await abandonmentQueue.add(
      `check-${cart.id}`,
      {
        cartId: cart.id,
        clientId: req.client.id,
        scheduledAt: new Date().toISOString(),
      },
      {
        delay: delayMs,
        jobId: `abandon-${cart.id}-${Date.now()}`, // Unique per schedule
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );

    res.status(isNew ? 201 : 200).json({
      success: true,
      cart_id: cart.id,
      is_new: isNew,
      check_in: `${delayMinutes} minutes`,
    });
  } catch (err) {
    next(err);
  }
});

// ======================== TRACK CHECKOUT ========================
// Called when a customer starts checkout (before payment)
router.post('/checkout', async (req, res, next) => {
  try {
    const { external_cart_id, phone, email, name, cart_total } = req.body;

    if (!external_cart_id && !phone) {
      return res.status(400).json({ error: 'external_cart_id or phone required' });
    }

    // Find the cart
    let cartQuery = supabase
      .from('carts')
      .select('*')
      .eq('client_id', req.client.id);

    if (external_cart_id) {
      cartQuery = cartQuery.eq('external_cart_id', external_cart_id);
    }

    const { data: carts } = await cartQuery
      .in('status', ['active', 'abandoned'])
      .order('created_at', { ascending: false })
      .limit(1);

    const cart = carts?.[0];
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Now we have the phone — upsert customer and link to cart
    if (phone) {
      const customer = await upsertCustomer(req.client.id, {
        phone,
        email,
        name,
        platform: req.client.platform,
      });

      await supabase
        .from('carts')
        .update({
          customer_id: customer.id,
          external_checkout_id: req.body.external_checkout_id || null,
          cart_total: cart_total || cart.cart_total,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', cart.id);
    }

    res.json({ success: true, cart_id: cart.id });
  } catch (err) {
    next(err);
  }
});

// ======================== TRACK PURCHASE ========================
// Called when a purchase is completed — marks cart as recovered
router.post('/purchase', async (req, res, next) => {
  try {
    const body = trackPurchaseSchema.parse(req.body);

    // Find the cart to recover
    let cart = null;

    // Try by external_cart_id first
    if (body.external_cart_id) {
      const { data } = await supabase
        .from('carts')
        .select('*')
        .eq('client_id', req.client.id)
        .eq('external_cart_id', body.external_cart_id)
        .in('status', ['active', 'abandoned'])
        .order('created_at', { ascending: false })
        .limit(1);
      cart = data?.[0];
    }

    // Try by phone number
    if (!cart && body.phone) {
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('client_id', req.client.id)
        .eq('phone', body.phone)
        .single();

      if (customer) {
        const { data } = await supabase
          .from('carts')
          .select('*')
          .eq('client_id', req.client.id)
          .eq('customer_id', customer.id)
          .in('status', ['active', 'abandoned'])
          .order('created_at', { ascending: false })
          .limit(1);
        cart = data?.[0];
      }
    }

    if (!cart) {
      // Not an error — they might have bought without abandoning
      return res.json({ success: true, recovered: false, message: 'No abandoned cart found' });
    }

    // Mark as recovered
    const { data: recoveredCart } = await markCartRecovered(cart.id, {
      order_id: body.order_id,
      order_total: body.order_total,
      currency: body.currency,
      discount_code: body.discount_code,
      discount_amount: body.discount_amount,
    });

    res.json({
      success: true,
      recovered: true,
      cart_id: cart.id,
      was_abandoned: cart.status === 'abandoned',
    });
  } catch (err) {
    next(err);
  }
});

// ======================== TRACK CONSENT ========================
// Record WhatsApp opt-in consent
router.post('/consent', async (req, res, next) => {
  try {
    const body = trackConsentSchema.parse(req.body);

    const customer = await upsertCustomer(req.client.id, {
      phone: body.phone,
      email: body.email,
      consent: true,
      consentSource: body.source,
      consentIp: req.ip,
    });

    res.json({
      success: true,
      customer_id: customer.id,
      wa_consent: customer.wa_consent,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
