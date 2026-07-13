-- Two spending categories the defaults didn't cover:
--   Personal care  — grooming, haircuts, salon, spa (discretionary).
--   Fees & interest — credit-card interest, finance/late/annual fees. Money
--     genuinely leaving the account (cost of carrying debt), so it must be a
--     spending category, at the Need tier since it's non-discretionary.
INSERT INTO categories (name, default_tier) VALUES
    ('Personal care', 'comfortable'),
    ('Fees & interest', 'need');

-- Auto-detect rules for common statement descriptions. Matching is
-- case-insensitive against the normalized merchant; first match wins by
-- priority. All are editable/deletable in Settings → Rules.
--
-- Card payments (both legs — the debit leaving checking and the credit
-- received on the card) route to the "Card payment" system category so they
-- net to zero and never count as spending; the real spending is already on
-- the card's individual purchase rows.
INSERT INTO rules (matcher, match_type, category_id, priority, created_from) VALUES
    ('epayment', 'contains', (SELECT id FROM categories WHERE name = 'Card payment'), 100, 'manual'),
    ('online payment thank you', 'contains', (SELECT id FROM categories WHERE name = 'Card payment'), 101, 'manual'),
    ('payment thank you', 'contains', (SELECT id FROM categories WHERE name = 'Card payment'), 102, 'manual'),
    ('autopay', 'contains', (SELECT id FROM categories WHERE name = 'Card payment'), 103, 'manual'),
    ('interest charge', 'contains', (SELECT id FROM categories WHERE name = 'Fees & interest'), 110, 'manual'),
    ('finance charge', 'contains', (SELECT id FROM categories WHERE name = 'Fees & interest'), 111, 'manual'),
    ('annual fee', 'contains', (SELECT id FROM categories WHERE name = 'Fees & interest'), 112, 'manual'),
    ('late fee', 'contains', (SELECT id FROM categories WHERE name = 'Fees & interest'), 113, 'manual'),
    ('salon', 'contains', (SELECT id FROM categories WHERE name = 'Personal care'), 120, 'manual'),
    ('barber', 'contains', (SELECT id FROM categories WHERE name = 'Personal care'), 121, 'manual'),
    ('supercuts', 'contains', (SELECT id FROM categories WHERE name = 'Personal care'), 122, 'manual'),
    ('great clips', 'contains', (SELECT id FROM categories WHERE name = 'Personal care'), 123, 'manual');
