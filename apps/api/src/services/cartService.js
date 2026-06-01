const { supabase } = require('../config/database');

/**
 * Upsert a customer record (by phone + client_id)
 */
async function upsertCustomer(clientId, customerData) {
  const { phone, email, name, platform, consent, consentSource, consentIp } = customerData;

  // Check if customer exists
  const { data: existing } = await supabase
    .from('customers')
    .select('*')
    .eq('client_id', clientId)
    .eq('phone', phone)
    .single();

  if (existing) {
    // Update existing customer
    const updates = { updated_at: new Date().toISOString() };
    if (email) updates.email = email;
    if (name) updates.name = name;

    // Only upgrade consent, never downgrade
    if (consent && !existing.wa_consent) {
      updates.wa_consent = true;
      updates.consent_source = consentSource || 'api';
      updates.consented_at = new Date().toISOString();
      if (consentIp) updates.consent_ip = consentIp;
    }

    const { data, error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Create new customer
  const newCustomer = {
    client_id: clientId,
    phone,
    email: email || null,
    name: name || null,
    platform: platform || 'custom',
    wa_consent: !!consent,
    consent_source: consent ? (consentSource || 'api') : null,
    consented_at: consent ? new Date().toISOString() : null,
    consent_ip: consent ? consentIp : null,
  };

  const { data, error } = await supabase
    .from('customers')
    .insert(newCustomer)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create or update a cart
 * If an active cart exists for this customer (within 2 hours), update it.
 * Otherwise create a new one.
 */
async function upsertCart(clientId, customerId, cartData) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // Look for an existing active cart
  let query = supabase
    .from('carts')
    .select('*')
    .eq('client_id', clientId)
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .gte('last_activity_at', twoHoursAgo)
    .order('created_at', { ascending: false })
    .limit(1);

  // If external_cart_id provided, use it for matching
  if (cartData.external_cart_id) {
    query = supabase
      .from('carts')
      .select('*')
      .eq('client_id', clientId)
      .eq('external_cart_id', cartData.external_cart_id)
      .in('status', ['active', 'abandoned'])
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data: existingCarts } = await query;
  const existing = existingCarts?.[0];

  if (existing) {
    // Update existing cart
    const { data: updatedCart, error } = await supabase
      .from('carts')
      .update({
        cart_total: cartData.cart_total,
        currency: cartData.currency || 'INR',
        item_count: cartData.items?.length || existing.item_count,
        last_activity_at: new Date().toISOString(),
        page_url: cartData.page_url || existing.page_url,
        status: 'active', // Re-activate if they came back
        abandoned_at: null,
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;

    // Replace cart items
    if (cartData.items?.length) {
      await supabase.from('cart_items').delete().eq('cart_id', existing.id);
      await insertCartItems(existing.id, cartData.items);
    }

    return { cart: updatedCart, isNew: false };
  }

  // Create new cart
  const newCart = {
    client_id: clientId,
    customer_id: customerId,
    status: 'active',
    platform: cartData.platform || 'custom',
    external_cart_id: cartData.external_cart_id || null,
    cart_total: cartData.cart_total,
    currency: cartData.currency || 'INR',
    item_count: cartData.items?.length || 0,
    page_url: cartData.page_url || null,
    user_agent: cartData.user_agent || null,
    ip_address: cartData.ip_address || null,
    utm_source: cartData.utm_source || null,
    utm_medium: cartData.utm_medium || null,
    utm_campaign: cartData.utm_campaign || null,
    last_activity_at: new Date().toISOString(),
    // Expire carts after 7 days
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const { data: cart, error } = await supabase
    .from('carts')
    .insert(newCart)
    .select()
    .single();

  if (error) throw error;

  // Insert cart items
  if (cartData.items?.length) {
    await insertCartItems(cart.id, cartData.items);
  }

  // Increment client's monthly cart counter
  await supabase.rpc('increment_counter', {
    row_id: clientId,
    column_name: 'carts_tracked_this_month',
  }).catch(() => {
    // Fallback: manual increment
    supabase
      .from('clients')
      .update({ carts_tracked_this_month: (cartData._currentCount || 0) + 1 })
      .eq('id', clientId)
      .then(() => {});
  });

  return { cart, isNew: true };
}

/**
 * Insert cart items for a given cart
 */
async function insertCartItems(cartId, items) {
  const rows = items.map((item) => ({
    cart_id: cartId,
    product_name: item.product_name,
    product_id: item.product_id || null,
    variant_id: item.variant_id || null,
    variant_name: item.variant_name || null,
    quantity: item.quantity || 1,
    unit_price: item.unit_price,
    image_url: item.image_url || null,
    product_url: item.product_url || null,
  }));

  const { error } = await supabase.from('cart_items').insert(rows);
  if (error) throw error;
}

/**
 * Mark a cart as abandoned
 */
async function markCartAbandoned(cartId) {
  const { data, error } = await supabase
    .from('carts')
    .update({
      status: 'abandoned',
      abandoned_at: new Date().toISOString(),
    })
    .eq('id', cartId)
    .eq('status', 'active') // Only if still active
    .select()
    .single();

  return { data, error };
}

/**
 * Mark a cart as recovered
 */
async function markCartRecovered(cartId, orderData) {
  const { data: cart, error } = await supabase
    .from('carts')
    .update({
      status: 'recovered',
      recovered_at: new Date().toISOString(),
    })
    .eq('id', cartId)
    .select()
    .single();

  if (error) return { data: null, error };

  // Create recovery event
  if (cart) {
    const { error: recError } = await supabase.from('recovery_events').insert({
      client_id: cart.client_id,
      cart_id: cartId,
      customer_id: cart.customer_id,
      order_id: orderData.order_id,
      order_total: orderData.order_total,
      currency: orderData.currency || 'INR',
      discount_used: orderData.discount_code || null,
      discount_amount: orderData.discount_amount || 0,
      recovered_via: 'whatsapp',
      time_to_recover: cart.abandoned_at
        ? `${Math.round((Date.now() - new Date(cart.abandoned_at).getTime()) / 1000)} seconds`
        : null,
    });

    if (recError) console.error('Failed to create recovery event:', recError);
  }

  return { data: cart, error: null };
}

/**
 * Get a cart with all its items
 */
async function getCartWithItems(cartId) {
  const { data: cart, error } = await supabase
    .from('carts')
    .select('*, cart_items(*), customers(*)')
    .eq('id', cartId)
    .single();

  return { data: cart, error };
}

module.exports = {
  upsertCustomer,
  upsertCart,
  insertCartItems,
  markCartAbandoned,
  markCartRecovered,
  getCartWithItems,
};
