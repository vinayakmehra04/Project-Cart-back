const { z } = require('zod');
require('dotenv').config();

const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),

  WA_ACCESS_TOKEN: z.string().default(''),
  WA_PHONE_NUMBER_ID: z.string().default(''),
  WA_BUSINESS_ACCOUNT_ID: z.string().default(''),
  WA_VERIFY_TOKEN: z.string().default('cartback-verify-token'),
  WA_APP_SECRET: z.string().default(''),

  SHOPIFY_API_KEY: z.string().default(''),
  SHOPIFY_API_SECRET: z.string().default(''),
  SHOPIFY_SCOPES: z.string().default('read_orders,read_checkouts,read_customers'),

  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = { env: parsed.data };
