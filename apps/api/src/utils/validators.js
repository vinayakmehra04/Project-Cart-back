const { z } = require('zod');

// Phone must be E.164 format: +919876543210
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164 format (e.g., +919876543210)');

// ===================== AUTH =====================

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  phone: phoneSchema.optional(),
  platform: z.enum(['shopify', 'woocommerce', 'custom']).default('custom'),
  website_url: z.string().url().optional(),
  timezone: z.string().default('Asia/Kolkata'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ===================== TRACKING =====================

const cartItemSchema = z.object({
  product_name: z.string().min(1).max(500),
  product_id: z.string().optional(),
  variant_id: z.string().optional(),
  variant_name: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  unit_price: z.number().nonnegative(),
  image_url: z.string().url().optional(),
  product_url: z.string().url().optional(),
});

const trackCartSchema = z.object({
  phone: phoneSchema,
  email: z.string().email().optional(),
  name: z.string().max(200).optional(),
  cart_total: z.number().nonnegative(),
  currency: z.string().length(3).default('INR'),
  items: z.array(cartItemSchema).min(1).max(50),
  page_url: z.string().url().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  consent: z.boolean().default(false),
  external_cart_id: z.string().optional(),
});

const trackPurchaseSchema = z.object({
  order_id: z.string().min(1),
  order_total: z.number().nonnegative(),
  currency: z.string().length(3).default('INR'),
  discount_code: z.string().optional(),
  discount_amount: z.number().nonnegative().optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
  external_cart_id: z.string().optional(),
});

const trackConsentSchema = z.object({
  phone: phoneSchema,
  email: z.string().email().optional(),
  source: z.enum(['checkout_optin', 'popup', 'import', 'api', 'manual']).default('api'),
});

// ===================== AUTOMATION RULES =====================

const automationRuleSchema = z.object({
  name: z.string().min(1).max(100).default('Default Rule'),
  is_active: z.boolean().default(true),
  delay_minutes: z.number().int().min(5).max(1440).default(30),
  discount_type: z.enum(['percentage', 'fixed']).default('percentage'),
  discount_value: z.number().nonnegative().max(100).default(10),
  min_cart_value: z.number().nonnegative().default(0),
  max_sends_per_cart: z.number().int().min(1).max(5).default(1),
  priority: z.number().int().default(0),
  conditions: z.record(z.any()).default({}),
});

// ===================== MESSAGE TEMPLATES =====================

const messageTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  wa_template_name: z.string().min(1).max(100),
  wa_template_lang: z.string().default('en'),
  header_text: z.string().max(60).optional(),
  body_text: z.string().min(1).max(1024),
  footer_text: z.string().max(60).optional(),
  cta_url: z.string().url().optional(),
  cta_text: z.string().max(25).default('Complete Order'),
  is_active: z.boolean().default(true),
  rule_id: z.string().uuid().optional(),
});

module.exports = {
  phoneSchema,
  registerSchema,
  loginSchema,
  trackCartSchema,
  trackPurchaseSchema,
  trackConsentSchema,
  automationRuleSchema,
  messageTemplateSchema,
};
