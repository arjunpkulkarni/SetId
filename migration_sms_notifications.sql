-- Run against PostgreSQL (WealthSplit SMS + payment links)
-- Safe to re-run: uses IF NOT EXISTS where applicable

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS payment_link_token VARCHAR(64),
    ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payment_request_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_payment_link_token
    ON payments (payment_link_token)
    WHERE payment_link_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_payments_pending_reminders
    ON payments (status)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    payment_id UUID REFERENCES payments (id) ON DELETE SET NULL,
    phone VARCHAR(32) NOT NULL,
    message TEXT NOT NULL,
    kind VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    provider_message_sid VARCHAR(64),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_sms_logs_phone ON sms_logs (phone);
CREATE INDEX IF NOT EXISTS ix_sms_logs_created_at ON sms_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_sms_logs_payment_id ON sms_logs (payment_id);
