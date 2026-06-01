const { supabase } = require('../config/database');
const { hashAPIKey } = require('../utils/apiKey');

/**
 * Middleware: Verify API key from X-API-Key header
 * Used for tracking endpoints and incoming webhooks
 */
async function authenticateAPIKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || !apiKey.startsWith('cb_sk_')) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }

  try {
    const keyHash = hashAPIKey(apiKey);

    // Look up the key
    const { data: keyRecord, error } = await supabase
      .from('client_api_keys')
      .select('*, clients(*, plans(*))')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single();

    if (error || !keyRecord) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    if (!keyRecord.clients || !keyRecord.clients.is_active) {
      return res.status(403).json({ error: 'Client account is inactive' });
    }

    // Update last_used timestamp (fire and forget — don't await)
    supabase
      .from('client_api_keys')
      .update({ last_used: new Date().toISOString() })
      .eq('id', keyRecord.id)
      .then(() => {});

    // Attach client to request
    req.client = keyRecord.clients;
    req.apiKeyId = keyRecord.id;
    next();
  } catch (err) {
    console.error('API Key auth error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = { authenticateAPIKey };
