const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { supabase } = require('../config/database');

/**
 * Middleware: Verify JWT token from Authorization header
 * Used for dashboard / client-facing routes
 */
async function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    // Fetch full client record
    const { data: client, error } = await supabase
      .from('clients')
      .select('*, plans(*)')
      .eq('id', payload.clientId)
      .eq('is_active', true)
      .single();

    if (error || !client) {
      return res.status(401).json({ error: 'Client not found or inactive' });
    }

    req.client = client;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticateJWT };
