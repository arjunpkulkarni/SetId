-- Run against existing DB if users.phone was not unique yet.
-- PostgreSQL allows multiple NULLs under a unique index on phone.

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone_unique ON users (phone);
