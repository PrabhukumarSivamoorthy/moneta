# Moneta — Error Code Book

The reference for every error a user or developer can meet, what it means,
what usually caused it *in this app specifically*, and what to do first.

> **Keep this book current.** When a change introduces a new error path,
> add its entry here in the same change (see Documentation discipline in
> `CLAUDE.md`).

**First response for any error, always:**

1. Open the log — every failed SQL statement is recorded *with its query*,
   plus uncaught errors:
   - macOS: `~/Library/Logs/com.moneta.app/moneta.log`
   - Windows: `%LOCALAPPDATA%\com.moneta.app\logs\moneta.log`
   - Dev: same file + the `npm run tauri dev` terminal + devtools console
2. Find the newest `[sql]`, `[window]`, or `[promise]` line and match it
   against the tables below.

---

## 1. SQLite errors — `error returned from database: (code: N) …`

Raised by `tauri-plugin-sql`/sqlx and surfaced in the UI as
`Database error: …`. The number in `(code: N)` is the [SQLite result
code](https://sqlite.org/rescode.html).

| Code | Name | Meaning | Likely cause in Moneta | What to do |
| --- | --- | --- | --- | --- |
| 1 | `SQLITE_ERROR` | Generic SQL error (bad SQL, missing table/column) | A migration didn't apply (check `_sqlx_migrations`), or a repo query references a column added in a newer migration | Check the logged query; compare schema (`sqlite3 <db> .schema`) with `src-tauri/migrations/` |
| 5 | `SQLITE_BUSY` | **database is locked** — another connection holds the write lock | Historically: manual `BEGIN`/`COMMIT` through the pooled plugin (fixed — now forbidden, regression-tested in `e2e/db-lock.spec.ts`), or two app processes on one DB (prevented by single-instance plugin). Can still happen if an external tool (e.g. `sqlite3` CLI, a DB browser) holds the file open in a write transaction | Close external tools holding the DB; retry the action (imports are dedup-safe to retry); check the log for which query was blocked |
| 6 | `SQLITE_LOCKED` | A table is locked within the same connection | Same family as code 5; would indicate a re-entrant statement bug | Log the query; file a bug — this should never happen in normal use |
| 8 | `SQLITE_READONLY` | Database file is not writable | Wrong permissions on `~/Library/Application Support/com.moneta.app/`, disk restored from backup as read-only | `chmod`/ownership fix on the app-data folder |
| 11 | `SQLITE_CORRUPT` | The database file is malformed | Disk failure, or the `.db` was copied while the app was writing (without its `-wal` file) | Restore from a JSON backup (Settings → Export); always copy `moneta.db` together with `moneta.db-wal`/`-shm`, or export instead of copying |
| 13 | `SQLITE_FULL` | Disk is full | Disk is full | Free disk space |
| 14 | `SQLITE_CANTOPEN` | Cannot open the database file | App-data directory missing/no permissions (first-run sandboxing issues) | Check the app-data dir exists and is writable |
| 19 | `SQLITE_CONSTRAINT` | A constraint was violated | UNIQUE: duplicate account name, duplicate bank-profile name, duplicate `(category, month)` budget row. CHECK: an invalid enum value (tier, match_type, sign_convention) reached SQL — that's a code bug, the TS types should prevent it. FK: deleting a category still referenced by transactions | The logged query names the table; for UNIQUE, rename the duplicate; for CHECK/FK, file a bug with the log line |
| 21 | `SQLITE_MISUSE` | Library used wrong (e.g. statement on a closed connection) | Would indicate a lifecycle bug in `src/db/client.ts` | File a bug with the log line |

## 2. Anthropic API errors — `Anthropic API error <status>: …`

Thrown by `src/lib/ai.ts` (AI categorization assist and PDF extraction).
Only ever seen when the user has explicitly opted in.

| Status | Meaning | Likely cause in Moneta | What to do |
| --- | --- | --- | --- |
| 400 | Bad request | PDF too large/corrupt for extraction; malformed request (code bug) | Try a smaller/cleaner PDF; check the log |
| 401 | Invalid API key | Key missing, mistyped, or revoked | Settings → AI categorization assist → re-enter and Save key |
| 403 | Permission denied | Key lacks access to the model | Check the key's workspace/model access in the Anthropic console |
| 404 | Model not found | `AI_MODEL` in `src/lib/ai.ts` names a retired model | Update `AI_MODEL` to a current model id |
| 413 | Request too large | Statement PDF exceeds the API's document size limit | Split the PDF or import that statement as CSV |
| 429 | Rate limited | Too many requests/tokens for the key's tier | Wait and retry; suggestions/extraction are safe to re-run |
| 500 / 529 | Server error / overloaded | Transient Anthropic-side issue | Retry later — nothing is wrong locally |

Related app-level messages (not HTTP):

| Message | Meaning | Fix |
| --- | --- | --- |
| `AI assist is on but no API key is saved — add one in Settings.` | Toggle on, key never saved | Settings → save a key |
| `PDF extraction needs an Anthropic API key — add one in Settings…` | PDF consent confirmed but no key stored | Same |
| `Malformed extraction response` | The model reply had no valid tool call | Retry; if persistent, file a bug |

## 3. Import parse errors (per-row, in the Upload review error list)

These never block the import — bad rows are listed, good rows proceed.

| Message | Meaning | Fix |
| --- | --- | --- |
| `Missing column(s) in header: X` | The bank profile's column map doesn't match this file's header | Edit the profile (Upload → Bank profile → edit) so Date/Description/Amount name the real columns |
| `Unparseable date "…" (expected FMT)` | Row date doesn't match the profile's date format | Switch the profile's date format (`YYYY-MM-DD` / `MM/DD/YYYY` / `DD.MM.YYYY`) |
| `Unparseable amount "…"` | Amount isn't a plain decimal (max 2 places) | Usually a summary/footer row — safe to ignore; otherwise fix the profile's amount column |
| `Empty description` | Row has no merchant text | Usually a filler row — safe to ignore |
| `Both debit and credit have values` / `Neither debit nor credit has a value` | Two-column profiles expect exactly one of debit/credit per row | Check the profile's debit/credit column names |
| `File is empty` | Zero rows parsed | Wrong file, or wrong delimiter in the profile |

## 3b. Backup restore errors (Settings → Restore from backup…)

Validation happens BEFORE anything is written — a rejected file changes
nothing.

| Message | Meaning | Fix |
| --- | --- | --- |
| `Not a JSON file — is this really a Moneta backup?` | The picked file isn't JSON | Pick the `moneta-backup-….json` file exported by the app |
| `Not a Moneta backup (missing app marker).` | JSON, but from something else | Same |
| `Backup version N is not supported by this app (expected 1).` | Backup written by a newer app version | Update the app, then restore |
| `Backup is missing the "…" table.` | Truncated or hand-edited file | Use an unmodified export |
| `file too large to be a Moneta backup` | >64 MB file picked | Wrong file |

## 4. Rust command errors (surfaced as plain strings)

| Source | Typical message | Cause / fix |
| --- | --- | --- |
| `get_api_key` / `set_api_key` | An `std::io` message (permission denied, read-only) | The app-config dir isn't writable — fix permissions on `~/Library/Application Support/com.moneta.app` (macOS stores config there too) |
| `write_text_file` | `Permission denied` / `No such file or directory` | The export path chosen in the save dialog isn't writable — pick another location |

## 5. Diagnosing something not in this book

1. Reproduce with the log open (`tail -f` the log file).
2. The `[sql]` entry gives the exact query and parameter count; `[window]` /
   `[promise]` entries give uncaught frontend errors with file:line.
3. Check whether a Vitest or Playwright test covers the area
   (`src/lib/__tests__/`, `e2e/`); reproduce it there — `e2e/support/tauri-stub.js`
   can inject failures (`window.__failOnce`).
4. When fixed, add the error to this book and a regression test, in the
   same change.
