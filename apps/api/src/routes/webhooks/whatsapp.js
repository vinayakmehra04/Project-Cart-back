const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../../config/database');
const { env } = require('../../config/env');

const router = express.Router();

/**
 * GET /api/webhooks/whatsapp — Meta webhook verification (challenge handshake)
 * Meta sends this when you register the webhook URL
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WA_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Forbidden');
});

/**
 * POST /api/webhooks/whatsapp — Delivery status updates from Meta
 * Updates message status: sent → delivered → read
 */
router.post('/', async (req, res) => {
  // Always return 200 quickly to Meta
  res.status(200).send('OK');

  try {
    // Optional: verify request signature
    if (env.WA_APP_SECRET && req.rawBody) {
      const signature = req.headers['x-hub-signature-256'];
      if (signature) {
        const expectedSig = 'sha256=' + crypto
          .createHmac('sha256', env.WA_APP_SECRET)
          .update(req.rawBody)
          .digest('hex');

        if (signature !== expectedSig) {
          console.warn('WhatsApp webhook signature mismatch');
          return;
        }
      }
    }

    const body = req.body;

    // Meta sends a nested structure
    const entries = body?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];

      for (const change of changes) {
        const value = change?.value;
        if (!value) continue;

        // Handle message status updates
        const statuses = value?.statuses || [];
        for (const status of statuses) {
          await handleStatusUpdate(status);
        }

        // Handle incoming messages (customer replies)
        const messages = value?.messages || [];
        for (const message of messages) {
          await handleIncomingMessage(message, value?.metadata);
        }
      }
    }
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err);
  }
});

/**
 * Handle delivery status update
 * status.status can be: 'sent', 'delivered', 'read', 'failed'
 */
async function handleStatusUpdate(status) {
  const waMessageId = status.id;
  const newStatus = status.status; // sent | delivered | read | failed
  const timestamp = status.timestamp
    ? new Date(parseInt(status.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  if (!waMessageId || !newStatus) return;

  // Map Meta status to our status enum
  const statusMap = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  };

  const mappedStatus = statusMap[newStatus];
  if (!mappedStatus) return;

  // Build update object
  const updates = { status: mappedStatus };

  if (newStatus === 'delivered') updates.delivered_at = timestamp;
  if (newStatus === 'read') updates.read_at = timestamp;
  if (newStatus === 'failed') {
    updates.failed_at = timestamp;
    updates.failure_reason = status.errors?.[0]?.message || 'Unknown error';
  }

  // Update our message record
  const { error } = await supabase
    .from('messages_sent')
    .update(updates)
    .eq('wa_message_id', waMessageId);

  if (error) {
    console.error(`Failed to update message ${waMessageId}:`, error);
  } else {
    console.log(`📬 Message ${waMessageId}: ${newStatus}`);
  }
}

/**
 * Handle incoming message from a customer
 * This fires when someone replies to your WhatsApp message
 * Could be used for: "STOP" to unsubscribe, or customer support routing
 */
async function handleIncomingMessage(message, metadata) {
  const from = message.from; // Phone number without +
  const text = message.text?.body || '';
  const messageType = message.type;

  console.log(`📩 Incoming message from +${from}: ${text}`);

  // Handle STOP / unsubscribe requests
  const stopWords = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];
  if (stopWords.some((w) => text.toLowerCase().includes(w))) {
    // Revoke consent for this phone number
    const phone = `+${from}`;
    const { error } = await supabase
      .from('customers')
      .update({ wa_consent: false })
      .eq('phone', phone);

    if (!error) {
      console.log(`🚫 Consent revoked for ${phone}`);
    }
  }

  // Log incoming message for future use (support routing, etc.)
  await supabase.from('webhook_events_raw').insert({
    platform: 'shopify', // reusing the enum; could add 'whatsapp' to enum later
    event_type: 'whatsapp_incoming',
    payload: { from, text, type: messageType, metadata },
    processed: false,
  }).catch(() => {});
}

module.exports = router;
