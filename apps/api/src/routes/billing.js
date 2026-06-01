const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { supabase } = require('../config/database');
const { env } = require('../config/env');
const { authenticateJWT } = require('../middleware/authJWT');
const { verifyRazorpaySignature } = require('../utils/hmac');

const router = express.Router();

const RAZORPAY_API = 'https://api.razorpay.com/v1';

// Helper for Razorpay API calls
function razorpayRequest(method, path, data = null) {
  return axios({
    method,
    url: `${RAZORPAY_API}${path}`,
    data,
    auth: {
      username: env.RAZORPAY_KEY_ID,
      password: env.RAZORPAY_KEY_SECRET,
    },
    headers: { 'Content-Type': 'application/json' },
  });
}

// ======================== CREATE SUBSCRIPTION ========================
router.post('/create-subscription', authenticateJWT, async (req, res, next) => {
  try {
    const { plan_tier } = req.body;

    if (!plan_tier) {
      return res.status(400).json({ error: 'plan_tier is required' });
    }

    // Get the plan from our DB
    const { data: plan } = await supabase
      .from('plans')
      .select('*')
      .eq('tier', plan_tier)
      .eq('is_active', true)
      .single();

    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.tier === 'free') return res.status(400).json({ error: 'Free plan does not require subscription' });

    // Create Razorpay customer if not exists
    let razorpayCustomerId = req.client.razorpay_customer_id;

    if (!razorpayCustomerId) {
      const custResp = await razorpayRequest('POST', '/customers', {
        name: req.client.name,
        email: req.client.email,
        contact: req.client.phone || '',
      });

      razorpayCustomerId = custResp.data.id;

      await supabase
        .from('clients')
        .update({ razorpay_customer_id: razorpayCustomerId })
        .eq('id', req.client.id);
    }

    // Create subscription
    // NOTE: You need to create Razorpay Plans in the dashboard first
    // and store the plan_id. For now, we create it dynamically.
    const planResp = await razorpayRequest('POST', '/plans', {
      period: 'monthly',
      interval: 1,
      item: {
        name: `CartBack ${plan.name}`,
        amount: plan.monthly_price, // in paise
        currency: plan.currency,
        description: `CartBack ${plan.name} Plan — ${plan.max_messages} messages/month`,
      },
    });

    const subscription = await razorpayRequest('POST', '/subscriptions', {
      plan_id: planResp.data.id,
      customer_id: razorpayCustomerId,
      total_count: 120, // 10 years max
      quantity: 1,
    });

    // Store subscription ID
    await supabase
      .from('clients')
      .update({ razorpay_subscription_id: subscription.data.id })
      .eq('id', req.client.id);

    res.json({
      subscription_id: subscription.data.id,
      short_url: subscription.data.short_url, // Razorpay payment link
      status: subscription.data.status,
    });
  } catch (err) {
    console.error('Razorpay error:', err.response?.data || err.message);
    next(err);
  }
});

// ======================== SUBSCRIPTION STATUS ========================
router.get('/status', authenticateJWT, async (req, res, next) => {
  try {
    if (!req.client.razorpay_subscription_id) {
      return res.json({
        status: 'free',
        plan: 'Free',
        subscription: null,
      });
    }

    const resp = await razorpayRequest(
      'GET',
      `/subscriptions/${req.client.razorpay_subscription_id}`
    );

    res.json({
      status: resp.data.status,
      plan: req.client.plans?.name || 'Unknown',
      current_start: resp.data.current_start
        ? new Date(resp.data.current_start * 1000).toISOString()
        : null,
      current_end: resp.data.current_end
        ? new Date(resp.data.current_end * 1000).toISOString()
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// ======================== CANCEL SUBSCRIPTION ========================
router.post('/cancel', authenticateJWT, async (req, res, next) => {
  try {
    if (!req.client.razorpay_subscription_id) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    await razorpayRequest(
      'POST',
      `/subscriptions/${req.client.razorpay_subscription_id}/cancel`,
      { cancel_at_cycle_end: 1 } // Cancel at end of current billing period
    );

    res.json({ message: 'Subscription will be cancelled at end of current period' });
  } catch (err) {
    next(err);
  }
});

// ======================== RAZORPAY WEBHOOK ========================
// This receives payment events from Razorpay
router.post('/webhook', async (req, res) => {
  // Respond 200 immediately
  res.status(200).send('OK');

  try {
    // Verify signature
    const signature = req.headers['x-razorpay-signature'];
    if (signature && env.RAZORPAY_WEBHOOK_SECRET && req.rawBody) {
      const isValid = verifyRazorpaySignature(
        req.rawBody,
        signature,
        env.RAZORPAY_WEBHOOK_SECRET
      );
      if (!isValid) {
        console.warn('Razorpay webhook signature mismatch');
        return;
      }
    }

    const event = req.body;
    const eventType = event.event;
    const payload = event.payload;

    console.log(`💳 Razorpay event: ${eventType}`);

    if (eventType === 'subscription.activated' || eventType === 'subscription.charged') {
      const subscriptionId = payload.subscription?.entity?.id;
      if (!subscriptionId) return;

      // Find client by subscription ID
      const { data: client } = await supabase
        .from('clients')
        .select('id, plan_id')
        .eq('razorpay_subscription_id', subscriptionId)
        .single();

      if (!client) return;

      // Update plan if needed (based on subscription plan mapping)
      // For now, just mark as active
      console.log(`✅ Subscription ${subscriptionId} active for client ${client.id}`);
    }

    if (eventType === 'subscription.cancelled') {
      const subscriptionId = payload.subscription?.entity?.id;
      if (!subscriptionId) return;

      // Downgrade to free plan
      const { data: freePlan } = await supabase
        .from('plans')
        .select('id')
        .eq('tier', 'free')
        .single();

      await supabase
        .from('clients')
        .update({
          plan_id: freePlan?.id,
          razorpay_subscription_id: null,
        })
        .eq('razorpay_subscription_id', subscriptionId);

      console.log(`⬇️ Subscription ${subscriptionId} cancelled, downgraded to free`);
    }

    if (eventType === 'payment.failed') {
      const subscriptionId = payload.payment?.entity?.subscription_id;
      // TODO: Send email notification about failed payment
      console.warn(`⚠️ Payment failed for subscription ${subscriptionId}`);
    }
  } catch (err) {
    console.error('Razorpay webhook error:', err);
  }
});

module.exports = router;
