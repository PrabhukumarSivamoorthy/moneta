# Moneta

Desktop-only, local-first personal budgeting app for a single user. All data
stays on this machine — SQLite is the single system of record, there is no
telemetry, and nothing leaves the device except the explicitly opt-in AI
categorization assist (see Privacy below).

## Commands

| Command | What it does |
| --- | --- |
| `npm run tauri dev` | Run the desktop app (Vite dev server + Tauri window) |
| `npm run tauri build` | Build the distributable app bundle |
| `npm test` | Run Vitest once (`src/**/*.test.ts`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright browser E2E suite (`e2e/*.spec.ts`) — starts vite itself |
| `npm run typecheck` | `tsc --noEmit` (strict mode) |

The E2E suite runs the real UI in Chromium against a deterministic Tauri IPC
stub (`e2e/support/tauri-stub.js`) that emulates the SQL plugin, key
commands, save dialog, and Anthropic API. All stub dates are generated
relative to today so the suite never rots. SQL writes, exported files, and
AI request bodies are captured on `window.__executed` / `__written` /
`__aiCalls` for assertions (including the privacy guarantees).

Playwright is the committed E2E engine (deterministic, CI-enforced,
parallel); interactive browser tools (Chrome DevTools MCP) are for
exploratory checks only and never replace a committed spec. On failure,
traces + screenshots land in `test-results/` (`npx playwright show-trace
<trace.zip>`); CI uploads them as the `e2e-failure-artifacts` artifact.
`npm run test:e2e:ui` opens the interactive runner; `test:e2e:debug` steps
through a spec.

First `tauri dev`/`build` compiles the Rust crate and takes several minutes;
subsequent runs are incremental.

## Testing discipline — every change gets tested, no exceptions

No change is done until it has been verified. Before claiming any change
complete or committing it:

1. **Always run** `npm run typecheck` and `npm test`.
2. **New or changed logic** in `src/lib` requires new/updated Vitest specs
   in the same change — pure modules never ship untested.
3. **UI or flow changes** (screens, repos, IPC): run `npm run test:e2e`,
   and extend the Playwright suite (`e2e/*.spec.ts`) to cover the new
   behavior. The stub in `e2e/support/tauri-stub.js` may need new dataset
   rows or invoke handlers.
4. **Rust or migration changes**: `cargo check` in `src-tauri`, then launch
   `npm run tauri dev` and confirm the migration applies / command works
   against the real SQLite database.
5. Report actual results (test counts, failures) — never assert success
   without having run the commands.

## Documentation discipline — update docs with every change

`docs/ARCHITECTURE.md` holds the high-level block diagram, the data model,
and sequence/flow diagrams for every major flow (import, AI assist, reads,
export/wipe), written for engineers new to the codebase. Whenever a feature
is modified or added — new flow, new table/column, new screen, changed
pipeline — update the matching diagram/section there **in the same change**,
and update this file's roadmap/data-model notes if they are affected. Docs
that lag the code are treated as bugs.

`docs/ERROR-CODES.md` is the error code book: every SQLite code, Anthropic
API status, parse error, and command error the app can surface, with causes
and fixes. Any change that introduces a new error path adds its entry there
in the same change.

## Build & release

- Local package: `npm run tauri build` → `src-tauri/target/release/bundle/`.
- CI: `.github/workflows/build.yml` — tests on every push/PR; on version
  tags (`v*`) or manual dispatch it builds macOS arm64 + Intel and Windows
  bundles and attaches them to a draft GitHub release.
- App icon: replace `app-icon.png` (1024×1024) and run
  `npx tauri icon app-icon.png` to regenerate `src-tauri/icons/`.

## Locked stack decisions — do not revisit

- **Shell:** Tauri 2 + React + TypeScript (strict) + Vite. Tailwind CSS v4
  (via `@tailwindcss/vite`; design tokens in `src/styles.css` `@theme`, no
  tailwind.config). Recharts for charts.
- **Storage:** SQLite via `tauri-plugin-sql` (`sqlite:moneta.db` in the app
  data dir). Schema managed exclusively through migrations.
- **Money:** integer cents everywhere. Never float arithmetic on amounts.
- **Dates:** ISO-8601 strings. Currency (default USD) and date format are
  settings.
- **Ingestion:** CSV-first with per-bank mapping profiles. PDF ingestion
  (LLM extraction) is Phase 6 — the upload pipeline must let a second parser
  type plug into the same review/commit flow.
- **Categorization:** hybrid — deterministic rules engine first; remaining
  uncategorized rows may be sent (explicit opt-in only) to the Anthropic API
  (small, cheap model, batched). User corrections persist as new rules.
- **Fonts:** bundled locally via `@fontsource` (IBM Plex Serif, IBM Plex
  Mono, Courier Prime) — no runtime Google Fonts requests.

## Privacy rules

- AI assist is OFF by default. When enabled, send ONLY merchant string +
  amount — never account names, balances, or dates tied to identity.
- The API key lives in a local git-ignored file (`*.secret.json` is ignored)
  or the OS keychain — never in the repo or the DB in plain sight of exports.
- AI results are suggestions that pass through the review flow; the AI never
  writes directly to the ledger.

## Architecture & layering rules

```
screens (src/screens)  →  state (src/state)  →  repos (src/db/repo)  →  SQLite
                             ↘  pure logic (src/lib) ↙
```

- **`src/lib`** — pure TS business logic: parsing, normalization, dedup,
  rules, period math, tier math, money. No Tauri, no DOM, no React imports.
  Everything here has Vitest coverage. No business logic buried in components.
- **`src/db/repo`** — thin repository layer; the ONLY place SQL strings live.
  `src/db/client.ts` owns the single `Database.load` connection and logs
  every failed statement (with the query) to the app log file.
- **Never use manual `BEGIN`/`COMMIT`** through the SQL plugin — it pools
  connections, so the transaction statements can land on different
  connections and deadlock the file ("database is locked"). Use single
  atomic multi-row statements; dedup hashes make retries safe.
- **Logs**: `~/Library/Logs/com.moneta.app/moneta.log` (macOS) /
  `%LOCALAPPDATA%\com.moneta.app\logs` (Windows). See
  `docs/ARCHITECTURE.md` §10.
- **`src/state`** — app-wide React state (global period filter, settings
  cache). Selection only; math belongs in `src/lib`.
- **`src-tauri/migrations`** — numbered `.sql` files, embedded via
  `include_str!` and registered in `src-tauri/src/lib.rs`. Append-only:
  never edit a migration that has shipped; add a new one.

## Data model (migration 0001)

- `accounts(id, name, type)`
- `bank_profiles(id, name, delimiter, date_format, column_map_json, sign_convention)`
- `uploads(id, account_id, bank_profile_id, filename, imported_at, row_count)`
- `transactions(id, upload_id, account_id, date, amount_cents, merchant_raw,
  merchant_normalized, category_id NULL, categorization_source
  rule|ai|manual|none, tier_override need|comfortable|luxury NULL,
  dedup_hash, created_at)` — indexed on `date` and `dedup_hash`
- `categories(id, name, parent_id NULL, default_tier need|comfortable|luxury
  NOT NULL, is_archived)`
- `rules(id, matcher, match_type contains|prefix|regex, category_id,
  priority, created_from manual|correction)`
- `budgets(id, category_id, month 'YYYY-MM', amount_cents, rollover)`
- `settings(key, value)` — includes `tier_target_need`,
  `tier_target_comfortable`, `tier_target_luxury`

Enums are TEXT + CHECK constraints (SQLite). Seed data: the 10 default
categories with tiers, and 50/30/20 tier targets.

Migration 0002 additions:
- `accounts.balance_cents` + `balance_as_of` — statement balances entered by
  hand in Settings (brokerage = net contributions, cards = amount owed as
  positive). For checking/savings the entry is an ANCHOR: Overview's liquid
  cash = anchor + all transactions dated after `balance_as_of` (pure helper
  `derivedCash` in `src/lib/cash.ts`; no anchor → sum of all the account's
  entries). Settings shows the expected balance per liquid account and, on
  saving a new balance, reports the mismatch vs what transactions predict.
- `categories.is_system` — the seeded system categories (Income, Lent &
  borrowed, Investing transfer, Card payment) route non-spending money.
  **Every spend/tier aggregation excludes them** (see `isSpend` in
  `src/lib/budget.ts`); they carry no tier and never enter budgets.
- `goals(id, name, target_cents, target_month, saved_cents, created_at)` —
  savings goals funded by manual set-asides.
- Hand-recorded entries (manual income, repayments) are transactions with
  `upload_id NULL` (shown with a MANUAL tag).

Migration 0003 additions:
- Two spending categories: **Personal care** (comfortable) for grooming,
  and **Fees & interest** (need) for credit-card interest / finance / late /
  annual fees — real money out, so they belong in a spending category.
- Seeded auto-detect rules: card-payment descriptions (`epayment`,
  `payment thank you`, `autopay`, …) → the **Card payment** system category
  (both legs net to zero, never counted as spending); interest/fee
  descriptions → Fees & interest; salon/barber merchants → Personal care.
  All editable in Settings → Rules.

## Core logic rules

- **Effective tier:** `COALESCE(tier_override, categories.default_tier)`.
  Uncategorized transactions have no tier; tier aggregations exclude them but
  must surface their count so the mix is never silently wrong. Computed in a
  pure TS helper (`src/lib/tier.ts`), not scattered SQL.
- **CSV parsing:** apply the bank profile's column map; normalize amounts to
  integer cents respecting the sign convention; rows that fail parsing go to
  an error list with a reason — never silently dropped. Picking an account on
  the Upload screen pre-selects the bank profile it was last imported with
  (from upload history, `listUploadProfilePairs`; PDF imports excluded).
- **Dedup:** `dedup_hash = sha256(account_id | date | amount_cents |
  merchant_normalized)`. On import, flag exact hash matches against existing
  transactions AND within the same file. Flagged rows are skipped by default
  in review, with a per-row override (protects against overlapping statement
  periods).
- **Merchant normalization:** strip payment-processor prefixes/suffixes and
  reference numbers, collapse whitespace, title-case. Store raw AND
  normalized.
- **Rules engine:** evaluate by priority, first match wins. When the user
  manually recategorizes, offer to create a rule (`created_from =
  correction`); offers queue so several corrections become several rules at
  once. Creating any rule immediately sweeps every uncategorized entry in
  the whole ledger and files the matches (same as the "Apply rules" button).
- **AI assist:** batch all uncategorized transactions; strict JSON output
  (transaction id → category); suggestions only.
- **Global period filter:** app-wide `weekly | monthly | yearly |
  custom(start,end)` with prev/next stepping (store: `src/state/period.tsx`).
  Every read query scopes to it. Chart bucketing adapts: weekly/monthly →
  daily; yearly → monthly; custom → auto by range length. Budgets are defined
  monthly: sub-month scopes compare against prorated budget (monthly budget ×
  days-of-period-in-month ÷ days-in-month); yearly scope sums the year's 12
  monthly budgets. Period math (boundaries, buckets, proration) is pure,
  unit-tested TS in `src/lib/period.ts`.
- **Budgets apply-forward:** month scope offers "Apply {month} to rest of
  year / entire year" (one upsert-copy per target month, `applyBudgetsToMonths`
  in `src/db/repo/budgets.ts`) with session-scoped undo that restores the
  pre-apply snapshot (`replaceBudgetsForMonths`). Tier-target cards also show
  the **budgeted** mix — how budget dollars split across tiers by category
  default tier (`budgetTierAllocation` in `src/lib/budget.ts`) — alongside the
  actual-spend mix.
- **Subscription detection (Phase 5):** same normalized merchant, amount
  within ±10%, roughly monthly cadence, ≥3 occurrences.

## Design reference

`design-reference/Moneta Ledger.dc.html` is the source of truth for layout,
typography, and palette — match its visual language when building UI. Key
tokens (also in `src/styles.css`):

- Paper `#F5EFE0` (main) / `#F7F2E7` (sidebar), ink `#1F261E`, muted inks
  `#4A5147` / `#65705F` / `#8B9384`, ledger green `#2F5D45`, red `#B3362C`,
  hairlines `rgba(31,38,30,0.22)`.
- Body: IBM Plex Serif. Numbers/data: IBM Plex Mono. Labels/small caps:
  Courier Prime with letter-spacing.
- 12 screens: Overview, Dashboard, Earnings, Transactions, Upload, Budgets,
  Trends, Lent & Borrowed, Goals & Loans, Recurring, Transfers & Investing,
  Settings.

## Phase roadmap

Working rule: **present a short plan and get user approval before starting
each phase.**

- [x] **Phase 0 — Scaffold:** Tauri 2 app boots; Tailwind wired; SQL plugin +
  migration runner working; Vitest configured; CLAUDE.md.
- [x] **Phase 1 — CSV import:** bank profile CRUD + column-mapping UI →
  parse → review screen with dedup flags and error list → commit.
  (Dev smoke: `VITE_E2E=1 npm run tauri dev` runs the whole pipeline
  against the real DB — see `src/dev/e2eImport.ts`.)
- [x] **Phase 2 — Transactions UI + global period selector:** period state +
  scoped queries; ledger table with filters/search (incl. tier filter),
  inline recategorize, per-transaction tier override, bulk actions; rules
  engine + corrections-to-rules; category manager with default-tier selector
  (on the Budgets screen).
- [x] **Phase 3 — Budgets:** per-category monthly budgets, 80%/100%
  thresholds, month switcher (via the global period bar), copy-last-month;
  tier targets editor (sum-to-100 validation); prorated weekly pace.
- [x] **Phase 4 — Dashboard + Trends:** period overview with alerts and
  tier-mix module; per-category trend chart with adaptive bucketing and
  drill-down; tier composition stacked-area with Luxury-share change.
  Chart primitives live in `src/components/charts.tsx` (tier ramp, dash-
  pattern series identity, paper tooltips); bucketed aggregation in
  `src/lib/chart.ts`.
- [x] **Phase 5 — AI assist (opt-in) + subscription detection.** Key lives
  in a secret file via Rust commands (`src/platform/apiKey.ts`); request
  builder/parser in `src/lib/ai.ts` (only merchant+amount ever sent);
  detection in `src/lib/recurring.ts`.
- [x] **Phase 6a — remaining design screens:** Overview (net position from
  hand-entered balances), Earnings (income + manual entry + plan + DTI),
  Lent & Borrowed (per-person balances from the system category), Goals &
  Loans (savings goals + amortization calculator in `src/lib/loan.ts`),
  Transfers & Investing.
- [x] **Backup & export:** JSON backup (versioned, full dump, never the API
  key) + transactions CSV via native save dialog (`src/lib/export.ts`,
  `src/db/backup.ts`, `src/platform/exportFile.ts`); danger-zone wipe with
  typed confirmation.
- [x] **PDF ingestion:** LLM extraction (`buildExtractRequest`/
  `parseExtractResponse` in `src/lib/ai.ts`) into the exact same
  review/commit pipeline as CSV. Per-file consent dialog on the Upload
  screen — the statement document itself goes to the API, so nothing is
  sent until the user confirms each file. PDF uploads use the auto-created
  "PDF import" bank profile row.
- [x] **Cash-flow forecast:** straight-line 3-month projection on Overview
  (`src/lib/forecast.ts`): income plan (or observed average) minus
  recurring charges and trailing-3-month average other spend.
- [x] **Sankey money-flow view:** on Trends (`src/lib/flow.ts` +
  Recharts Sankey): income (and savings when overspent) → period hub →
  tiers, uncategorized, investing, lent out, kept. Card payments excluded.

The full spec is delivered. Nothing is deferred.
