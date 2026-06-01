/**
 * Normalize a Shopify cart/checkout webhook payload
 * into our standard cart format
 */
function parseShopifyCart(payload, eventType) {
  // Shopify cart/create and cart/update
  if (eventType === 'cart') {
    return {
      external_cart_id: payload.token,
      platform: 'shopify',
      cart_total: parseFloat(payload.total_price || '0') / 100, // Shopify uses cents
      currency: payload.currency || 'INR',
      items: (payload.line_items || []).map((item) => ({
        product_name: item.title,
        product_id: String(item.product_id),
        variant_id: String(item.variant_id),
        variant_name: item.variant_title || null,
        quantity: item.quantity,
        unit_price: parseFloat(item.price || '0') / 100,
        image_url: item.image_url || null,
        product_url: null, // Shopify doesn't include this in cart webhooks
      })),
      // Cart webhooks don't have customer info — that comes at checkout
      phone: null,
      email: null,
      name: null,
    };
  }

  // Shopify checkouts/create — this is where we get the phone number
  if (eventType === 'checkout') {
    const phone = payload.billing_address?.phone
      || payload.shipping_address?.phone
      || payload.phone
      || null;

    return {
      external_cart_id: payload.cart_token,
      external_checkout_id: payload.token,
      platform: 'shopify',
      cart_total: parseFloat(payload.total_price || '0'),
      currency: payload.currency || 'INR',
      items: (payload.line_items || []).map((item) => ({
        product_name: item.title,
        product_id: String(item.product_id),
        variant_id: String(item.variant_id),
        variant_name: item.variant_title || null,
        quantity: item.quantity,
        unit_price: parseFloat(item.price || '0'),
        image_url: null,
        product_url: null,
      })),
      phone: normalizePhone(phone),
      email: payload.email || null,
      name: [payload.billing_address?.first_name, payload.billing_address?.last_name]
        .filter(Boolean)
        .join(' ') || null,
      external_customer_id: payload.customer?.id ? String(payload.customer.id) : null,
    };
  }

  // Shopify orders/paid — purchase complete
  if (eventType === 'order') {
    return {
      order_id: String(payload.id),
      order_total: parseFloat(payload.total_price || '0'),
      currency: payload.currency || 'INR',
      discount_code: payload.discount_codes?.[0]?.code || null,
      discount_amount: payload.discount_codes?.[0]?.amount
        ? parseFloat(payload.discount_codes[0].amount)
        : 0,
      external_cart_id: payload.cart_token || null,
      phone: normalizePhone(
        payload.billing_address?.phone || payload.shipping_address?.phone
      ),
      email: payload.email || null,
    };
  }

  return null;
}

/**
 * Normalize a WooCommerce webhook payload
 */
function parseWooCommerceCart(payload, eventType) {
  if (eventType === 'cart' || eventType === 'checkout') {
    const billing = payload.billing || {};

    return {
      external_cart_id: payload.cart_hash || payload.id?.toString(),
      platform: 'woocommerce',
      cart_total: parseFloat(payload.total || '0'),
      currency: payload.currency || 'INR',
      items: (payload.line_items || []).map((item) => ({
        product_name: item.name,
        product_id: String(item.product_id),
        variant_id: item.variation_id ? String(item.variation_id) : null,
        variant_name: item.meta_data
          ?.filter((m) => m.display_key)
          .map((m) => `${m.display_key}: ${m.display_value}`)
          .join(', ') || null,
        quantity: item.quantity,
        unit_price: parseFloat(item.price || '0'),
        image_url: item.image?.src || null,
        product_url: item.permalink || null,
      })),
      phone: normalizePhone(billing.phone),
      email: billing.email || null,
      name: [billing.first_name, billing.last_name].filter(Boolean).join(' ') || null,
      external_customer_id: payload.customer_id
        ? String(payload.customer_id)
        : null,
    };
  }

  if (eventType === 'order') {
    const billing = payload.billing || {};
    const coupon = payload.coupon_lines?.[0];

    return {
      order_id: String(payload.id),
      order_total: parseFloat(payload.total || '0'),
      currency: payload.currency || 'INR',
      discount_code: coupon?.code || null,
      discount_amount: coupon?.discount ? parseFloat(coupon.discount) : 0,
      external_cart_id: payload.cart_hash || null,
      phone: normalizePhone(billing.phone),
      email: billing.email || null,
    };
  }

  return null;
}

/**
 * Normalize a custom website tracking payload
 * (This is basically a passthrough since the JS snippet sends our format)
 */
function parseCustomCart(payload) {
  return {
    ...payload,
    platform: 'custom',
    phone: normalizePhone(payload.phone),
  };
}

/**
 * Normalize phone number to E.164
 * Handles common Indian formats: 9876543210, 09876543210, 919876543210
 */
function normalizePhone(phone) {
  if (!phone) return null;

  // Remove all non-digits except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If starts with +, it's already E.164 (hopefully)
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Indian number handling
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 10) {
    // Assume Indian: add +91
    return `+91${cleaned}`;
  }

  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  // If it looks like an international number, add +
  if (cleaned.length >= 11 && cleaned.length <= 15) {
    return `+${cleaned}`;
  }

  return null; // Can't normalize
}

module.exports = {
  parseShopifyCart,
  parseWooCommerceCart,
  parseCustomCart,
  normalizePhone,
};
