-- Planned earnings: user-defined income sources with per-month plans.
--
-- income_sources mirrors the rules table: a named source (Salary, Freelance)
-- with a merchant pattern; income transactions are attributed to the first
-- matching source in priority order (case-insensitive, same semantics as the
-- categorization rules engine). Unmatched income shows as "Unplanned".
--
-- income_plans mirrors the budgets table: one planned amount per source per
-- month, so plans can vary month to month (bonuses, seasonal work).
CREATE TABLE income_sources (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    matcher    TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'prefix', 'regex')),
    priority   INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE income_plans (
    id           INTEGER PRIMARY KEY,
    source_id    INTEGER NOT NULL REFERENCES income_sources(id),
    month        TEXT NOT NULL, -- 'YYYY-MM'
    amount_cents INTEGER NOT NULL,
    UNIQUE (source_id, month)
);
