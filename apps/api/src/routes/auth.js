const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');
const { env } = require('../config/env');
const { authenticateJWT } = require('../middleware/authJWT');
const { generateAPIKey } = require('../utils/apiKey');
const { registerSchema, loginSchema } = require('../utils/validators');

const router = express.Router();

// ======================== REGISTER ========================
router.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    // Check if email already exists
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', body.email)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(body.password, 12);

    // Get free plan ID
    const { data: freePlan } = await supabase
      .from('plans')
      .select('id')
      .eq('tier', 'free')
      .single();

    // Create client
    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        name: body.name,
        email: body.email,
        password_hash: passwordHash,
        phone: body.phone || null,
        platform: body.platform,
        website_url: body.website_url || null,
        timezone: body.timezone,
        plan_id: freePlan?.id,
        onboarded_at: new Date().toISOString(),
      })
      .select('id, name, email, platform, created_at')
      .single();

    if (error) throw error;

    // Generate default API key
    const { fullKey, keyPrefix, keyHash } = generateAPIKey();

    await supabase.from('client_api_keys').insert({
      client_id: client.id,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      label: 'Default',
    });

    // Create default automation rule
    await supabase.from('automation_rules').insert({
      client_id: client.id,
      name: 'Default Rule',
      is_active: true,
      delay_minutes: 30,
      discount_type: 'percentage',
      discount_value: 10,
    });

    // Generate JWT
    const token = jwt.sign({ clientId: client.id }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    });

    res.status(201).json({
      message: 'Registration successful',
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        platform: client.platform,
      },
      token,
      api_key: fullKey, // Show ONCE — tell the user to save it
    });
  } catch (err) {
    next(err);
  }
});

// ======================== LOGIN ========================
router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('email', body.email)
      .eq('is_active', true)
      .single();

    if (error || !client) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(body.password, client.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ clientId: client.id }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    });

    res.json({
      token,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        platform: client.platform,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ======================== GET CURRENT CLIENT ========================
router.get('/me', authenticateJWT, (req, res) => {
  const { password_hash, wa_access_token, shopify_access_token, woo_consumer_secret, ...safe } = req.client;
  res.json({ client: safe });
});

// ======================== API KEY MANAGEMENT ========================
router.post('/keys/generate', authenticateJWT, async (req, res, next) => {
  try {
    const label = req.body.label || 'API Key';

    // Max 5 keys per client
    const { count } = await supabase
      .from('client_api_keys')
      .select('id', { count: 'exact' })
      .eq('client_id', req.client.id)
      .eq('is_active', true);

    if (count >= 5) {
      return res.status(400).json({ error: 'Maximum 5 active API keys allowed' });
    }

    const { fullKey, keyPrefix, keyHash } = generateAPIKey();

    await supabase.from('client_api_keys').insert({
      client_id: req.client.id,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      label,
    });

    res.status(201).json({
      message: 'API key created. Save it now — it will not be shown again.',
      api_key: fullKey,
      prefix: keyPrefix,
      label,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/keys', authenticateJWT, async (req, res, next) => {
  try {
    const { data: keys, error } = await supabase
      .from('client_api_keys')
      .select('id, key_prefix, label, is_active, last_used, created_at')
      .eq('client_id', req.client.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ keys });
  } catch (err) {
    next(err);
  }
});

router.delete('/keys/:id', authenticateJWT, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('client_api_keys')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('client_id', req.client.id);

    if (error) throw error;
    res.json({ message: 'API key revoked' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
