const { supabase } = require('../config/database');

/**
 * Check if a client can send more messages this month
 */
async function canSendMessage(clientId) {
  const { data: client, error } = await supabase
    .from('clients')
    .select('messages_sent_this_month, plans(max_messages)')
    .eq('id', clientId)
    .single();

  if (error || !client) return { allowed: false, reason: 'Client not found' };

  const limit = client.plans?.max_messages || 100;
  const used = client.messages_sent_this_month || 0;

  if (used >= limit) {
    return {
      allowed: false,
      reason: 'Monthly message limit reached',
      used,
      limit,
    };
  }

  return { allowed: true, used, limit, remaining: limit - used };
}

/**
 * Check if a client can track more carts this month
 */
async function canTrackCart(clientId) {
  const { data: client, error } = await supabase
    .from('clients')
    .select('carts_tracked_this_month, plans(max_carts)')
    .eq('id', clientId)
    .single();

  if (error || !client) return { allowed: false, reason: 'Client not found' };

  const limit = client.plans?.max_carts || 500;
  const used = client.carts_tracked_this_month || 0;

  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Increment message counter for a client
 */
async function incrementMessageCount(clientId) {
  // Use raw SQL for atomic increment
  const { error } = await supabase.rpc('increment_field', {
    table_name: 'clients',
    field_name: 'messages_sent_this_month',
    row_id: clientId,
  });

  // Fallback if RPC doesn't exist yet
  if (error) {
    const { data: client } = await supabase
      .from('clients')
      .select('messages_sent_this_month')
      .eq('id', clientId)
      .single();

    await supabase
      .from('clients')
      .update({ messages_sent_this_month: (client?.messages_sent_this_month || 0) + 1 })
      .eq('id', clientId);
  }
}

/**
 * Get usage stats for a client
 */
async function getUsageStats(clientId) {
  const { data: client } = await supabase
    .from('clients')
    .select('messages_sent_this_month, carts_tracked_this_month, current_period_start, plans(*)')
    .eq('id', clientId)
    .single();

  if (!client) return null;

  return {
    messages: {
      used: client.messages_sent_this_month || 0,
      limit: client.plans?.max_messages || 100,
    },
    carts: {
      used: client.carts_tracked_this_month || 0,
      limit: client.plans?.max_carts || 500,
    },
    plan: client.plans?.name || 'Free',
    period_start: client.current_period_start,
  };
}

module.exports = {
  canSendMessage,
  canTrackCart,
  incrementMessageCount,
  getUsageStats,
};
