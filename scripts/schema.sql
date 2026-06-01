-- ============================================================
-- CARTBACK DATABASE SCHEMA v1.0
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- ENUMS
CREATE TYPE platform_type AS ENUM ('shopify', 'woocommerce', 'custom');
CREATE TYPE cart_status AS ENUM ('active', 'abandoned', 'recovered', 'expired');
CREATE TYPE message_status AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');
CREATE TYPE plan_tier AS ENUM ('free', 'starter', 'growth', 'enterprise');
CREATE TYPE consent_source AS ENUM ('checkout_optin', 'popup', 'import', 'api', 'manual');

-- ============================================================
-- 1. PLANS
-- ============================================================
CREATE TABLE plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    tier            plan_tier NOT NULL UNIQUE,
    monthly_price   INTEGER NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'INR',
    max_messages    INTEGER NOT NULL DEFAULT 100,
    max_carts       INTEGER NOT NULL DEFAULT 500,
    max_templates   INTEGER NOT NULL DEFAULT 3,
    features        JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plans (name, tier, monthly_price, max_messages, max_carts, max_templates) VALUES
    ('Free',       'free',       0,       100,   500,   1),
    ('Starter',    'starter',    99900,   1000,  5000,  5),
    ('Growth',     'growth',     249900,  5000,  25000, 20),
    ('Enterprise', 'enterprise', 999900,  50000, 999999, 999);

-- ============================================================
-- 2. CLIENTS
-- ============================================================
CREATE TABLE clients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    email               TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    phone               TEXT,
    platform            platform_type NOT NULL DEFAULT 'custom',
    website_url         TEXT,
    plan_id             UUID REFERENCES plans(id),
    shopify_shop_domain TEXT,
    shopify_access_token TEXT,
    woo_store_url       TEXT,
    woo_consumer_key    TEXT,
    woo_consumer_secret TEXT,
    wa_phone_number_id  TEXT,
    wa_business_id      TEXT,
    wa_access_token     TEXT,
    use_shared_wa       BOOLEAN DEFAULT TRUE,
    razorpay_subscription_id TEXT,
    razorpay_customer_id     TEXT,
    messages_sent_this_month INTEGER DEFAULT 0,
    carts_tracked_this_month INTEGER DEFAULT 0,
    current_period_start     TIMESTAMPTZ DEFAULT NOW(),
    timezone            TEXT DEFAULT 'Asia/Kolkata',
    default_discount    INTEGER DEFAULT 10,
    cart_timeout_minutes INTEGER DEFAULT 30,
    is_active           BOOLEAN DEFAULT TRUE,
    onboarded_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_clients_platform ON clients(platform);

-- ============================================================
-- 3. CLIENT_API_KEYS
-- ============================================================
CREATE TABLE client_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    key_prefix  TEXT NOT NULL,
    key_hash    TEXT NOT NULL,
    label       TEXT DEFAULT 'Default',
    is_active   BOOLEAN DEFAULT TRUE,
    last_used   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON client_api_keys(key_hash);
CREATE INDEX idx_api_keys_client ON client_api_keys(client_id);

-- ============================================================
-- 4. CUSTOMERS
-- ============================================================
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    email           TEXT,
    phone           TEXT NOT NULL,
    name            TEXT,
    external_id     TEXT,
    platform        platform_type,
    wa_consent      BOOLEAN DEFAULT FALSE,
    consent_source  consent_source,
    consented_at    TIMESTAMPTZ,
    consent_ip      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, phone)
);

CREATE INDEX idx_customers_client ON customers(client_id);
CREATE INDEX idx_customers_phone ON customers(client_id, phone);
CREATE INDEX idx_customers_email ON customers(client_id, email);

-- ============================================================
-- 5. CARTS
-- ============================================================
CREATE TABLE carts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    customer_id         UUID REFERENCES customers(id),
    status              cart_status NOT NULL DEFAULT 'active',
    platform            platform_type NOT NULL,
    external_cart_id    TEXT,
    external_checkout_id TEXT,
    cart_total          DECIMAL(12,2) DEFAULT 0,
    currency            TEXT DEFAULT 'INR',
    item_count          INTEGER DEFAULT 0,
    page_url            TEXT,
    user_agent          TEXT,
    ip_address          TEXT,
    utm_source          TEXT,
    utm_medium          TEXT,
    utm_campaign        TEXT,
    last_activity_at    TIMESTAMPTZ DEFAULT NOW(),
    abandoned_at        TIMESTAMPTZ,
    recovered_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_carts_client_status ON carts(client_id, status);
CREATE INDEX idx_carts_abandoned ON carts(status, last_activity_at) WHERE status = 'active';
CREATE INDEX idx_carts_customer ON carts(customer_id);
CREATE INDEX idx_carts_external ON carts(client_id, external_cart_id);

-- ============================================================
-- 6. CART_ITEMS
-- ============================================================
CREATE TABLE cart_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id         UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_name    TEXT NOT NULL,
    product_id      TEXT,
    variant_id      TEXT,
    variant_name    TEXT,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_price      DECIMAL(12,2) NOT NULL,
    image_url       TEXT,
    product_url     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);

-- ============================================================
-- 7. AUTOMATION_RULES
-- ============================================================
CREATE TABLE automation_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name                TEXT NOT NULL DEFAULT 'Default Rule',
    is_active           BOOLEAN DEFAULT TRUE,
    delay_minutes       INTEGER NOT NULL DEFAULT 30,
    discount_type       TEXT DEFAULT 'percentage',
    discount_value      DECIMAL(8,2) DEFAULT 10,
    min_cart_value      DECIMAL(12,2) DEFAULT 0,
    max_sends_per_cart  INTEGER DEFAULT 1,
    priority            INTEGER DEFAULT 0,
    conditions          JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rules_client ON automation_rules(client_id, is_active);

-- ============================================================
-- 8. MESSAGE_TEMPLATES
-- ============================================================
CREATE TABLE message_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    rule_id             UUID REFERENCES automation_rules(id) ON DELETE SET NULL,
    name                TEXT NOT NULL DEFAULT 'Default Template',
    wa_template_name    TEXT NOT NULL,
    wa_template_lang    TEXT DEFAULT 'en',
    header_text         TEXT,
    body_text           TEXT NOT NULL,
    footer_text         TEXT,
    cta_url             TEXT,
    cta_text            TEXT DEFAULT 'Complete Order',
    sample_variables    JSONB DEFAULT '[]',
    is_approved         BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_client ON message_templates(client_id);

-- ============================================================
-- 9. MESSAGES_SENT
-- ============================================================
CREATE TABLE messages_sent (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    cart_id             UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    customer_id         UUID NOT NULL REFERENCES customers(id),
    template_id         UUID REFERENCES message_templates(id),
    rule_id             UUID REFERENCES automation_rules(id),
    wa_message_id       TEXT,
    status              message_status NOT NULL DEFAULT 'queued',
    phone_sent_to       TEXT NOT NULL,
    discount_code       TEXT,
    discount_value      DECIMAL(8,2),
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    read_at             TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    failure_reason      TEXT,
    wa_cost             DECIMAL(8,4) DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_client ON messages_sent(client_id);
CREATE INDEX idx_messages_cart ON messages_sent(cart_id);
CREATE INDEX idx_messages_status ON messages_sent(status);
CREATE INDEX idx_messages_wa_id ON messages_sent(wa_message_id);

-- ============================================================
-- 10. RECOVERY_EVENTS
-- ============================================================
CREATE TABLE recovery_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    cart_id             UUID NOT NULL REFERENCES carts(id),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    message_id          UUID REFERENCES messages_sent(id),
    order_id            TEXT,
    order_total         DECIMAL(12,2) NOT NULL,
    currency            TEXT DEFAULT 'INR',
    discount_used       TEXT,
    discount_amount     DECIMAL(12,2) DEFAULT 0,
    recovered_via       TEXT DEFAULT 'whatsapp',
    time_to_recover     INTERVAL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recovery_client ON recovery_events(client_id);
CREATE INDEX idx_recovery_cart ON recovery_events(cart_id);

-- ============================================================
-- 11. WEBHOOK_EVENTS_RAW
-- ============================================================
CREATE TABLE webhook_events_raw (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID REFERENCES clients(id),
    platform        platform_type,
    event_type      TEXT,
    headers         JSONB,
    payload         JSONB NOT NULL,
    ip_address      TEXT,
    processed       BOOLEAN DEFAULT FALSE,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhooks_client ON webhook_events_raw(client_id, created_at DESC);
CREATE INDEX idx_webhooks_unprocessed ON webhook_events_raw(processed) WHERE processed = FALSE;

-- ============================================================
-- 12. DISCOUNT_CODES
-- ============================================================
CREATE TABLE discount_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    cart_id         UUID REFERENCES carts(id),
    code            TEXT NOT NULL,
    discount_type   TEXT NOT NULL DEFAULT 'percentage',
    discount_value  DECIMAL(8,2) NOT NULL,
    min_order_value DECIMAL(12,2) DEFAULT 0,
    max_uses        INTEGER DEFAULT 1,
    times_used      INTEGER DEFAULT 0,
    expires_at      TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, code)
);

CREATE INDEX idx_discount_code ON discount_codes(client_id, code);

-- ============================================================
-- 13. USAGE_LOGS
-- ============================================================
CREATE TABLE usage_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    messages_sent   INTEGER DEFAULT 0,
    carts_tracked   INTEGER DEFAULT 0,
    carts_recovered INTEGER DEFAULT 0,
    revenue_recovered DECIMAL(14,2) DEFAULT 0,
    wa_cost_total   DECIMAL(10,4) DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, period_start)
);

-- ============================================================
-- HELPER: Auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_carts_updated BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rules_updated BEFORE UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- HELPER: Atomic counter increment RPC
-- Used by usageService.js to safely increment counters
-- ============================================================
CREATE OR REPLACE FUNCTION increment_field(
    table_name TEXT,
    field_name TEXT,
    row_id UUID
)
RETURNS VOID AS $$
BEGIN
    EXECUTE format(
        'UPDATE %I SET %I = COALESCE(%I, 0) + 1 WHERE id = $1',
        table_name, field_name, field_name
    ) USING row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
