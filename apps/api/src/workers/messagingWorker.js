const { Worker } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { supabase } = require('../config/database');
const { sendTemplateMessage } = require('../services/whatsappService');
const { generateDiscountCode } = require('../services/discountService');
const { incrementMessageCount } = require('../services/usageService');

/**
 * Messaging Worker
 *
 * Takes an abandoned cart, generates a discount code,
 * builds the WhatsApp template message, and sends it.
 */
const messagingWorker = new Worker(
  'send-whatsapp-message',
  async (job) => {
    const { cartId, clientId, customerId, customerPhone, customerName } = job.data;

    console.log(`📨 Sending recovery message for cart ${cartId} to ${customerPhone}`);

    // 1. Fetch client config
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client) throw new Error(`Client ${clientId} not found`);

    // 2. Get the automation rule for this client
    const { data: rules } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .limit(1);

    const rule = rules?.[0] || {
      discount_type: 'percentage',
      discount_value: client.default_discount || 10,
      min_cart_value: 0,
    };

    // 3. Get the message template
    const { data: templates } = await supabase
      .from('message_templates')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .eq('is_approved', true)
      .limit(1);

    const template = templates?.[0];
    if (!template) {
      console.error(`No approved template for client ${clientId}`);
      throw new Error('No approved WhatsApp template found');
    }

    // 4. Get cart items for the message
    const { data: cartItems } = await supabase
      .from('cart_items')
      .select('product_name, quantity')
      .eq('cart_id', cartId)
      .limit(3); // Show max 3 items in message

    const productNames = cartItems
      ?.map((item) => item.product_name)
      .join(', ') || 'your items';

    // 5. Generate unique discount code
    const discount = await generateDiscountCode(clientId, cartId, rule);
    const discountText =
      rule.discount_type === 'percentage'
        ? `${rule.discount_value}% off with code ${discount.code}`
        : `₹${rule.discount_value} off with code ${discount.code}`;

    // 6. Determine WhatsApp credentials
    const waPhoneId = client.use_shared_wa
      ? process.env.WA_PHONE_NUMBER_ID
      : client.wa_phone_number_id;

    const waToken = client.use_shared_wa
      ? process.env.WA_ACCESS_TOKEN
      : client.wa_access_token;

    // 7. Build CTA URL
    const ctaUrl = client.website_url
      ? `${client.website_url}?discount=${discount.code}&ref=cartback`
      : undefined;

    // 8. Create message record FIRST (status: queued)
    const { data: messageRecord } = await supabase
      .from('messages_sent')
      .insert({
        client_id: clientId,
        cart_id: cartId,
        customer_id: customerId,
        template_id: template.id,
        rule_id: rule.id || null,
        status: 'queued',
        phone_sent_to: customerPhone,
        discount_code: discount.code,
        discount_value: rule.discount_value,
      })
      .select()
      .single();

    // 9. SEND THE MESSAGE
    const result = await sendTemplateMessage(
      customerPhone,
      template.wa_template_name,
      template.wa_template_lang || 'en',
      [customerName, productNames, discountText], // body params: {{1}}, {{2}}, {{3}}
      {
        phoneNumberId: waPhoneId,
        accessToken: waToken,
        ctaUrl,
      }
    );

    // 10. Update message record with result
    if (result.success) {
      await supabase
        .from('messages_sent')
        .update({
          status: 'sent',
          wa_message_id: result.messageId,
          sent_at: new Date().toISOString(),
        })
        .eq('id', messageRecord.id);

      // Increment monthly counter
      await incrementMessageCount(clientId);

      console.log(`✅ Message sent to ${customerPhone}: ${result.messageId}`);
      return { status: 'sent', messageId: result.messageId };
    } else {
      await supabase
        .from('messages_sent')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          failure_reason: result.error,
        })
        .eq('id', messageRecord.id);

      console.error(`❌ Failed to send to ${customerPhone}: ${result.error}`);
      throw new Error(result.error); // Will trigger retry
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // Don't overwhelm Meta API
    limiter: {
      max: 50,       // Max 50 messages
      duration: 1000, // Per second (well under Meta's limits)
    },
  }
);

messagingWorker.on('completed', (job, result) => {
  console.log(`Message job ${job.id}: ${result?.status}`);
});

messagingWorker.on('failed', (job, err) => {
  console.error(`Message job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message);
});

module.exports = { messagingWorker };
