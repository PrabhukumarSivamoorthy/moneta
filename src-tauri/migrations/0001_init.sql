-- Moneta initial schema. Money is always integer cents; dates are ISO-8601 TEXT.

CREATE TABLE accounts (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL
);

CREATE TABLE bank_profiles (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    delimiter       TEXT NOT NULL DEFAULT ',',
    date_format     TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
    column_map_json TEXT NOT NULL,
    sign_convention TEXT NOT NULL DEFAULT 'debits_negative'
        CHECK (sign_convention IN ('debits_negative', 'debits_positive'))
);

CREATE TABLE uploads (
    id              INTEGER PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    bank_profile_id INTEGER NOT NULL REFERENCES bank_profiles(id),
    filename        TEXT NOT NULL,
    imported_at     TEXT NOT NULL,
    row_count       INTEGER NOT NULL
);

CREATE TABLE categories (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    parent_id    INTEGER REFERENCES categories(id),
    default_tier TEXT NOT NULL CHECK (default_tier IN ('need', 'comfortable', 'luxury')),
    is_archived  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transactions (
    id                    INTEGER PRIMARY KEY,
    upload_id             INTEGER REFERENCES uploads(id),
    account_id            INTEGER NOT NULL REFERENCES accounts(id),
    date                  TEXT NOT NULL,
    amount_cents          INTEGER NOT NULL,
    merchant_raw          TEXT NOT NULL,
    merchant_normalized   TEXT NOT NULL,
    category_id           INTEGER REFERENCES categories(id),
    categorization_source TEXT NOT NULL DEFAULT 'none'
        CHECK (categorization_source IN ('rule', 'ai', 'manual', 'none')),
    tier_override         TEXT CHECK (tier_override IN ('need', 'comfortable', 'luxury')),
    dedup_hash            TEXT NOT NULL,
    created_at            TEXT NOT NULL
);

CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_dedup_hash ON transactions(dedup_hash);

CREATE TABLE rules (
    id           INTEGER PRIMARY KEY,
    matcher      TEXT NOT NULL,
    match_type   TEXT NOT NULL CHECK (match_type IN ('contains', 'prefix', 'regex')),
    category_id  INTEGER NOT NULL REFERENCES categories(id),
    priority     INTEGER NOT NULL,
    created_from TEXT NOT NULL CHECK (created_from IN ('manual', 'correction'))
);

CREATE TABLE budgets (
    id           INTEGER PRIMARY KEY,
    category_id  INTEGER NOT NULL REFERENCES categories(id),
    month        TEXT NOT NULL, -- 'YYYY-MM'
    amount_cents INTEGER NOT NULL,
    rollover     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (category_id, month)
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Seed: default categories with their default tiers (from the design reference).
INSERT INTO categories (name, default_tier) VALUES
    ('Housing', 'need'),
    ('Groceries', 'need'),
    ('Utilities', 'need'),
    ('Health', 'need'),
    ('Dining', 'comfortable'),
    ('Transport', 'comfortable'),
    ('Entertainment', 'comfortable'),
    ('Subscriptions', 'comfortable'),
    ('Shopping', 'luxury'),
    ('Travel', 'luxury');

-- Seed: default settings.
INSERT INTO settings (key, value) VALUES
    ('tier_target_need', '50'),
    ('tier_target_comfortable', '30'),
    ('tier_target_luxury', '20'),
    ('currency', 'USD'),
    ('date_format', 'YYYY-MM-DD'),
    ('ai_assist_enabled', '0');
