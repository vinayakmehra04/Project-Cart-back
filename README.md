# 🛒 CartBack — Abandoned Cart WhatsApp Recovery

**Recover lost revenue by sending automated WhatsApp messages to customers who abandon their carts.**

CartBack detects abandoned carts on Shopify, WooCommerce, and custom websites, then sends personalized WhatsApp recovery messages with discount codes — automatically.

## How It Works

```
Customer adds items → Leaves without buying → 30 min passes →
WhatsApp message with discount → Customer completes purchase → Revenue recovered 💰
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + Tailwind CSS |
| Backend | Node.js + Express |
| Database | PostgreSQL via Supabase |
| Job Queue | BullMQ + Redis |
| Messaging | Meta WhatsApp Cloud API |
| Payments | Razorpay Subscriptions |
| Hosting | Vercel (frontend) + Railway (backend) |

## Project Structure

```
cartback/
├── apps/
│   ├── api/              # Express backend (Railway)
│   │   └── src/
│   │       ├── config/       # Database, Redis, environment
│   │       ├── middleware/    # JWT auth, API key auth, rate limiter
│   │       ├── routes/        # All API endpoints
│   │       ├── services/      # Business logic (cart, WhatsApp, discount, usage)
│   │       ├── workers/       # BullMQ workers (abandonment check, message sender)
│   │       ├── parsers/       # Shopify/WooCommerce/custom payload normalization
│   │       ├── cron/          # Scheduled jobs (usage reset, cleanup)
│   │       └── utils/         # API keys, HMAC, validators
│   └── web/              # Next.js dashboard (Vercel) — TODO
├── tracking/
│   └── cartback.js       # Client-side JS tracking snippet
├── scripts/
│   └── schema.sql        # Full database schema
└── package.json
```

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/vinayakmehra04/Project-Cart-back.git
cd Project-Cart-back
npm install
cd apps/api && npm install
```

### 2. Set Up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to SQL Editor
3. Paste the entire contents of `scripts/schema.sql` and run it
4. Go to Project Settings > API and copy the URL + service_role key

### 3. Set Up Redis

**Local development:**
```bash
# macOS
brew install redis && redis-server

# Docker
docker run -d -p 6379:6379 redis
```

**Production:** Create a Redis instance on Railway.

### 4. Configure Environment

```bash
cd apps/api
cp .env.example .env
# Fill in your values (Supabase URL/key, Redis URL, JWT secret, etc.)
```

### 5. Run the API

```bash
# From apps/api/
npm run dev
```

You should see:
```
✅ Redis connected
✅ Abandonment worker started
✅ Messaging worker started
⏰ Monthly usage reset cron scheduled
⏰ Webhook cleanup cron scheduled

╔══════════════════════════════════════════╗
║   🛒 CartBack API v1.0.0                ║
║   Running on port 4000                   ║
╚══════════════════════════════════════════╝
```

### 6. Test the Flow

```bash
# Register a client
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Store",
    "email": "test@example.com",
    "password": "password123",
    "platform": "custom"
  }'

# Save the api_key from the response, then track a cart:
curl -X POST http://localhost:4000/api/track/cart \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cb_sk_YOUR_KEY_HERE" \
  -d '{
    "phone": "+919876543210",
    "email": "customer@example.com",
    "name": "Rahul",
    "cart_total": 2499.00,
    "items": [
      {
        "product_name": "Wireless Earbuds",
        "product_id": "SKU-001",
        "quantity": 1,
        "unit_price": 2499.00
      }
    ],
    "consent": true
  }'
```

## API Endpoints

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | None | Register new client |
| POST | `/api/auth/login` | None | Login, get JWT |
| GET | `/api/auth/me` | JWT | Get current client |
| POST | `/api/auth/keys/generate` | JWT | Create new API key |
| GET | `/api/auth/keys` | JWT | List API keys |
| DELETE | `/api/auth/keys/:id` | JWT | Revoke API key |

### Cart Tracking (API Key Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/track/cart` | Track/update a cart |
| POST | `/api/track/checkout` | Customer started checkout |
| POST | `/api/track/purchase` | Purchase completed (recovery!) |
| POST | `/api/track/consent` | Record WhatsApp opt-in |

### Dashboard (JWT Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/stats` | Overview metrics |
| GET | `/api/dashboard/stats/chart` | Daily chart data (30 days) |
| GET | `/api/dashboard/carts` | Paginated carts list |
| GET | `/api/dashboard/carts/:id` | Single cart detail |
| GET | `/api/dashboard/messages` | Messages sent |
| GET | `/api/dashboard/recoveries` | Recovery events |

### Automation Rules (JWT Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/automations` | List rules |
| POST | `/api/automations` | Create rule |
| PUT | `/api/automations/:id` | Update rule |
| DELETE | `/api/automations/:id` | Delete rule |

### Message Templates (JWT Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | List templates |
| POST | `/api/templates` | Create template |
| PUT | `/api/templates/:id` | Update template |
| DELETE | `/api/templates/:id` | Delete template |
| GET | `/api/templates/:id/status` | Check Meta approval status |

### Billing (JWT Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/billing/create-subscription` | Start Razorpay subscription |
| GET | `/api/billing/status` | Current subscription status |
| POST | `/api/billing/cancel` | Cancel subscription |
| POST | `/api/billing/webhook` | Razorpay payment webhook |

### Webhooks (Platform-specific auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhooks/shopify/cart-create` | Shopify cart events |
| POST | `/api/webhooks/shopify/checkout-create` | Shopify checkout |
| POST | `/api/webhooks/shopify/order-paid` | Shopify order |
| POST | `/api/webhooks/woocommerce/cart` | WooCommerce events |
| GET/POST | `/api/webhooks/whatsapp` | Meta delivery receipts |

### Integrations (JWT Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/shopify/install` | Start Shopify OAuth |
| GET | `/api/integrations/shopify/callback` | Shopify OAuth callback |
| POST | `/api/integrations/woocommerce/connect` | Connect WooCommerce |
| GET | `/api/integrations/status` | Connection status |

## Client-Side Tracking Snippet

Add this to your website:

```html
<script src="https://cdn.cartback.io/track.js" data-key="cb_sk_YOUR_API_KEY"></script>
```

Then in your JavaScript:

```javascript
// When cart changes
CartBack.trackCart({
  phone: '+919876543210',
  email: 'user@email.com',
  cart_total: 2499.00,
  items: [{ product_name: 'Earbuds', product_id: 'SKU1', quantity: 1, unit_price: 2499 }],
  consent: true
});

// On order confirmation page
CartBack.trackPurchase({
  order_id: 'ORD-12345',
  order_total: 2249.00,
  discount_code: 'CARTBACK-A7X9'
});
```

## Deployment

### Backend (Railway)
1. Connect your GitHub repo to Railway
2. Set root directory to `apps/api`
3. Add a Redis instance
4. Set all environment variables from `.env.example`
5. Deploy

### Frontend (Vercel)
1. Connect repo to Vercel
2. Set root directory to `apps/web`
3. Set `NEXT_PUBLIC_API_URL` to your Railway URL
4. Deploy

## WhatsApp Setup

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a Business app → add WhatsApp product
3. Create a message template named `abandoned_cart_recovery`:
   - Category: Marketing
   - Body: `Hi {{1}}! You left {{2}} in your cart. Complete your order and get {{3}}! Tap below.`
   - Button: Visit Website (dynamic URL)
4. Wait for approval (1-24 hours)
5. Add your WA credentials to `.env`

## Pricing Plans

| Plan | Price | Messages/mo | Carts/mo |
|------|-------|-------------|----------|
| Free | ₹0 | 100 | 500 |
| Starter | ₹999 | 1,000 | 5,000 |
| Growth | ₹2,499 | 5,000 | 25,000 |
| Enterprise | ₹9,999 | 50,000 | Unlimited |

## License

Proprietary — All rights reserved.
