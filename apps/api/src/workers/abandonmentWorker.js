const { Worker, Queue } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { supabase } = require('../config/database');
const { canSendMessage } = require('../services/usageService');

// Queue for sending messages (the next step after abandonment is confirmed)
const messageQueue = new Queue('send-whatsapp-message', {
  connection: redisConnection,
});

/**
 * Abandonment Checker Worker
 *
 * This job fires X minutes after a cart is created/updated.
 * It checks: is the cart STILL active (no new activity)?
 * If yes → mark abandoned → enqueue WhatsApp message
 */
const abandonmentWorker = new Worker(
  'check-cart-abandonment',
  async (job) => {
    const { cartId, clientId, scheduledAt } = job.data;

    console.log(`🔍 Checking abandonment for cart ${cartId}`);

    // 1. Fetch the cart
    const { data: cart, error } = await supabase
      .from('carts')
      .select('*, customers(*)')
      .eq('id', cartId)
      .single();

    if (error || !cart) {
      console.log(`Cart ${cartId} not found, skipping`);
      return { status: 'skipped', reason: 'cart_not_found' };
    }

    // 2. Is the cart still active?
    if (cart.status !== 'active') {
      console.log(`Cart ${cartId} is already ${cart.status}, skipping`);
      return { status: 'skipped', reason: `already_${cart.status}` };
    }

    // 3. Has there been activity since we scheduled this check?
    const lastActivity = new Date(cart.last_activity_at).getTime();
    const scheduledTime = new Date(scheduledAt).getTime();

    if (lastActivity > scheduledTime) {
      console.log(`Cart ${cartId} had activity after scheduling, skipping`);
      return { status: 'skipped', reason: 'had_recent_activity' };
    }

    // 4. Does the customer have WhatsApp consent?
    if (!cart.customers?.wa_consent) {
      console.log(`Cart ${cartId}: customer has no WhatsApp consent, skipping`);
      // Still mark as abandoned for stats, just don't message
      await supabase
        .from('carts')
        .update({ status: 'abandoned', abandoned_at: new Date().toISOString() })
        .eq('id', cartId);
      return { status: 'abandoned_no_consent' };
    }

    // 5. Check if a message was already sent for this cart
    const { data: existingMessages } = await supabase
      .from('messages_sent')
      .select('id')
      .eq('cart_id', cartId)
      .in('status', ['queued', 'sent', 'delivered', 'read'])
      .limit(1);

    if (existingMessages?.length > 0) {
      console.log(`Cart ${cartId}: message already sent, skipping`);
      return { status: 'skipped', reason: 'message_already_sent' };
    }

    // 6. Check client's monthly message limit
    const usageCheck = await canSendMessage(clientId);
    if (!usageCheck.allowed) {
      console.log(`Client ${clientId}: ${usageCheck.reason}`);
      await supabase
        .from('carts')
        .update({ status: 'abandoned', abandoned_at: new Date().toISOString() })
        .eq('id', cartId);
      return { status: 'abandoned_limit_reached' };
    }

    // 7. ALL CHECKS PASSED — Mark as abandoned and enqueue message
    await supabase
      .from('carts')
      .update({ status: 'abandoned', abandoned_at: new Date().toISOString() })
      .eq('id', cartId);

    // Add to WhatsApp message queue
    await messageQueue.add(
      'send-recovery-message',
      {
        cartId,
        clientId,
        customerId: cart.customer_id,
        customerPhone: cart.customers.phone,
        customerName: cart.customers.name || 'there',
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 }, // 30s, 60s, 120s
      }
    );

    console.log(`✅ Cart ${cartId} marked abandoned, message enqueued`);
    return { status: 'abandoned_and_queued' };
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

abandonmentWorker.on('completed', (job, result) => {
  console.log(`Abandonment check ${job.id}: ${result?.status}`);
});

abandonmentWorker.on('failed', (job, err) => {
  console.error(`Abandonment check ${job.id} failed:`, err.message);
});

module.exports = { abandonmentWorker, messageQueue };
