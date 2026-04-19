-- Bill readiness gate (matches alembic 001_add_readiness_and_virtual_cards bill columns)
-- Run when dashboard / bill queries fail with: column bills.ready_to_pay does not exist

ALTER TABLE bills
    ADD COLUMN IF NOT EXISTS ready_to_pay BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ready_marked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ready_marked_by UUID REFERENCES users (id),
    ADD COLUMN IF NOT EXISTS ready_reason VARCHAR(50);

CREATE TABLE IF NOT EXISTS virtual_cards (
    id UUID PRIMARY KEY,
    bill_id UUID NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
    stripe_card_id VARCHAR(255) UNIQUE,
    stripe_cardholder_id VARCHAR(255),
    card_number VARCHAR(255),
    exp_month INTEGER,
    exp_year INTEGER,
    cvc VARCHAR(10),
    spending_limit_cents INTEGER,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    is_active BOOLEAN NOT NULL DEFAULT false,
    idempotency_key VARCHAR(128) UNIQUE,
    created_by UUID NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_virtual_cards_bill_id ON virtual_cards (bill_id);
CREATE INDEX IF NOT EXISTS ix_virtual_cards_idempotency_key ON virtual_cards (idempotency_key);
