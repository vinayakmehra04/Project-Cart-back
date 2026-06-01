const { nanoid } = require('nanoid');
const { supabase } = require('../config/database');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I confusion

/**
 * Generate a unique discount code and save to DB
 */
async function generateDiscountCode(clientId, cartId, rule) {
  const code = `CARTBACK-${nanoid(6).toUpperCase()}`;

  const discountRecord = {
    client_id: clientId,
    cart_id: cartId,
    code,
    discount_type: rule.discount_type || 'percentage',
    discount_value: rule.discount_value || 10,
    min_order_value: rule.min_cart_value || 0,
    max_uses: 1,
    times_used: 0,
    is_active: true,
    expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // 72h expiry
  };

  const { data, error } = await supabase
    .from('discount_codes')
    .insert(discountRecord)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Validate and redeem a discount code
 */
async function redeemDiscountCode(clientId, code) {
  const { data: discount, error } = await supabase
    .from('discount_codes')
    .select('*')
    .eq('client_id', clientId)
    .eq('code', code)
    .eq('is_active', true)
    .single();

  if (error || !discount) {
    return { valid: false, error: 'Invalid or expired discount code' };
  }

  // Check expiry
  if (discount.expires_at && new Date(discount.expires_at) < new Date()) {
    return { valid: false, error: 'Discount code has expired' };
  }

  // Check usage
  if (discount.times_used >= discount.max_uses) {
    return { valid: false, error: 'Discount code has been used' };
  }

  // Mark as used
  await supabase
    .from('discount_codes')
    .update({ times_used: discount.times_used + 1, is_active: false })
    .eq('id', discount.id);

  return {
    valid: true,
    discount_type: discount.discount_type,
    discount_value: discount.discount_value,
    min_order_value: discount.min_order_value,
  };
}

module.exports = { generateDiscountCode, redeemDiscountCode };
