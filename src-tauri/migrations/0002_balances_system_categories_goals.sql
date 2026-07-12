-- Account balances are maintained by hand (Settings → Accounts): statement
-- balances as of the last import, brokerage figures as net contributions.
ALTER TABLE accounts ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN balance_as_of TEXT;

-- System categories route money that is not spending: income, transfers to
-- people, investing moves, and card payments. They never enter budgets or
-- the tier mix; aggregations must exclude them.
ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

INSERT INTO categories (name, default_tier, is_system) VALUES
    ('Income', 'comfortable', 1),
    ('Lent & borrowed', 'comfortable', 1),
    ('Investing transfer', 'comfortable', 1),
    ('Card payment', 'comfortable', 1);

-- Savings goals: a target amount by a target month, funded by manual
-- "set aside" recordings.
CREATE TABLE goals (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    target_cents INTEGER NOT NULL,
    target_month TEXT NOT NULL, -- 'YYYY-MM'
    saved_cents  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);
