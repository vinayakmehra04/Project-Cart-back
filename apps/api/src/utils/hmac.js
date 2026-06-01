const crypto = require('crypto');

/**
 * Verify Shopify webhook HMAC signature
 * Shopify sends HMAC-SHA256 in X-Shopify-Hmac-Sha256 header
 */
function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmacHeader)
  );
}

/**
 * Verify Razorpay webhook signature
 */
function verifyRazorpaySignature(rawBody, signatureHeader, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signatureHeader)
  );
}

module.exports = { verifyShopifyHmac, verifyRazorpaySignature };
