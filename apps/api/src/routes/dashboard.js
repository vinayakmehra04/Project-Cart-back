const express = require('express');
const { supabase } = require('../config/database');
const { authenticateJWT } = require('../middleware/authJWT');
const { getUsageStats } = require('../services/usageService');

const router = express.Router();
router.use(authenticateJWT);

// ======================== OVERVIEW STATS ========================
router.get('/stats', async (req, res, next) => {
  try {
    const clientId = req.client.id;

    // Get counts for this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Total carts this month
    const { count: totalCarts } = await supabase
      .from('carts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('created_at', monthStart);

    // Abandoned carts
    const { count: abandonedCarts } = await supabase
      .from('carts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('status', ['abandoned'])
      .gte('created_at', monthStart);

    // Recovered carts
    const { count: recoveredCarts } = await supabase
      .from('carts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'recovered')
      .gte('created_at', monthStart);

    // Messages sent this month
    const { count: messagesSent } = await supabase
      .from('messages_sent')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('created_at', monthStart);

    // Revenue recovered this month
    const { data: recoveries } = await supabase
      .from('recovery_events')
      .select('order_total')
      .eq('client_id', clientId)
      .gte('created_at', monthStart);

    const revenueRecovered = (recoveries || []).reduce(
      (sum, r) => sum + parseFloat(r.order_total || 0),
      0
    );

    // Usage info
    const usage = await getUsageStats(clientId);

    res.json({
      total_carts: totalCarts || 0,
      abandoned_carts: abandonedCarts || 0,
      recovered_carts: recoveredCarts || 0,
      messages_sent: messagesSent || 0,
      revenue_recovered: revenueRecovered,
      abandonment_rate: totalCarts > 0
        ? ((abandonedCarts / totalCarts) * 100).toFixed(1)
        : '0.0',
      recovery_rate: abandonedCarts > 0
        ? ((recoveredCarts / abandonedCarts) * 100).toFixed(1)
        : '0.0',
      usage,
    });
  } catch (err) {
    next(err);
  }
});

// ======================== DAILY CHART DATA ========================
router.get('/stats/chart', async (req, res, next) => {
  try {
    const clientId = req.client.id;
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all carts in the period
    const { data: carts } = await supabase
      .from('carts')
      .select('status, created_at, abandoned_at, recovered_at')
      .eq('client_id', clientId)
      .gte('created_at', startDate);

    // Fetch all messages
    const { data: messages } = await supabase
      .from('messages_sent')
      .select('status, created_at')
      .eq('client_id', clientId)
      .gte('created_at', startDate);

    // Fetch recoveries
    const { data: recoveries } = await supabase
      .from('recovery_events')
      .select('order_total, created_at')
      .eq('client_id', clientId)
      .gte('created_at', startDate);

    // Group by date
    const dailyData = {};
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split('T')[0];
      dailyData[key] = {
        date: key,
        carts: 0,
        abandoned: 0,
        recovered: 0,
        messages: 0,
        revenue: 0,
      };
    }

    (carts || []).forEach((cart) => {
      const day = cart.created_at.split('T')[0];
      if (dailyData[day]) {
        dailyData[day].carts++;
        if (cart.status === 'abandoned') dailyData[day].abandoned++;
        if (cart.status === 'recovered') dailyData[day].recovered++;
      }
    });

    (messages || []).forEach((msg) => {
      const day = msg.created_at.split('T')[0];
      if (dailyData[day]) dailyData[day].messages++;
    });

    (recoveries || []).forEach((rec) => {
      const day = rec.created_at.split('T')[0];
      if (dailyData[day]) {
        dailyData[day].revenue += parseFloat(rec.order_total || 0);
      }
    });

    // Sort chronologically
    const chartData = Object.values(dailyData).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    res.json({ chart: chartData });
  } catch (err) {
    next(err);
  }
});

// ======================== CARTS LIST ========================
router.get('/carts', async (req, res, next) => {
  try {
    const clientId = req.client.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const status = req.query.status; // filter: active, abandoned, recovered
    const offset = (page - 1) * limit;

    let query = supabase
      .from('carts')
      .select('*, customers(name, phone, email), cart_items(product_name, quantity, unit_price, image_url)', { count: 'exact' })
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: carts, count, error } = await query;
    if (error) throw error;

    res.json({
      carts: carts || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ======================== SINGLE CART DETAIL ========================
router.get('/carts/:id', async (req, res, next) => {
  try {
    const { data: cart, error } = await supabase
      .from('carts')
      .select('*, customers(*), cart_items(*), messages_sent(*), recovery_events(*)')
      .eq('id', req.params.id)
      .eq('client_id', req.client.id)
      .single();

    if (error || !cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    res.json({ cart });
  } catch (err) {
    next(err);
  }
});

// ======================== MESSAGES LIST ========================
router.get('/messages', async (req, res, next) => {
  try {
    const clientId = req.client.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('messages_sent')
      .select('*, customers(name, phone), carts(cart_total, external_cart_id)', { count: 'exact' })
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: messages, count, error } = await query;
    if (error) throw error;

    res.json({
      messages: messages || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ======================== RECOVERIES LIST ========================
router.get('/recoveries', async (req, res, next) => {
  try {
    const clientId = req.client.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { data: recoveries, count, error } = await supabase
      .from('recovery_events')
      .select('*, customers(name, phone, email), carts(cart_total, external_cart_id)', { count: 'exact' })
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      recoveries: recoveries || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
