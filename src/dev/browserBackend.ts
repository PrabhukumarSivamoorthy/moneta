/**
 * Dev-only in-browser backend. When the app runs in a plain browser
 * (`npm run dev`, no Tauri shell), this installs a `window.__TAURI_INTERNALS__`
 * backed by sql.js (SQLite compiled to WebAssembly) so EVERY real code path
 * works — imports, rules, deletes, backup/restore — with data persisted to
 * localStorage across refreshes.
 *
 * It is imported only behind `import.meta.env.DEV` and a "not already under
 * Tauri" guard in main.tsx, so it never ships in the packaged app.
 */
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import migration0001 from "../../src-tauri/migrations/0001_init.sql?raw";
import migration0002 from "../../src-tauri/migrations/0002_balances_system_categories_goals.sql?raw";
import migration0003 from "../../src-tauri/migrations/0003_personal_care_fees_and_rules.sql?raw";
import migration0004 from "../../src-tauri/migrations/0004_income_sources_plans.sql?raw";

const STORAGE_KEY = "moneta-dev-db";
const MIGRATIONS = [migration0001, migration0002, migration0003, migration0004];

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Bind by parameter NAME, not position. The repos use numbered params
 * (`$1`, `$2`, …) and some reuse a number — e.g. settings upsert does
 * `… ON CONFLICT DO UPDATE SET value = $2`. SQLite/sql.js support `$N`
 * named binding via an object, so a reused `$2` correctly maps to one
 * value. (Converting to positional `?` would wrongly create an extra
 * placeholder and bind NULL → "NOT NULL constraint failed".)
 */
function bindParams(values: unknown[]): Record<string, unknown> {
  return Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v ?? null]));
}

export async function installBrowserBackend(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  const saved = localStorage.getItem(STORAGE_KEY);
  const db: Database = saved ? new SQL.Database(fromBase64(saved)) : new SQL.Database();

  // Run migrations incrementally by version — so a NEW migration also
  // applies to an existing localStorage DB, matching the real plugin.
  db.run("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY, description TEXT)");
  const appliedRes = db.exec("SELECT version FROM _sqlx_migrations");
  const applied = new Set((appliedRes[0]?.values ?? []).map((row) => Number(row[0])));
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    db.run(sql);
    db.run("INSERT INTO _sqlx_migrations (version, description) VALUES (?, ?)", [version, `migration_${version}`]);
  });

  const persist = () => localStorage.setItem(STORAGE_KEY, toBase64(db.export()));
  persist();

  const select = (query: string, values: unknown[]): Record<string, unknown>[] => {
    const stmt = db.prepare(query);
    stmt.bind(bindParams(values) as never);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const execute = (query: string, values: unknown[]): [number, number] => {
    db.run(query, bindParams(values) as never);
    const changes = db.getRowsModified();
    const idRow = select("SELECT last_insert_rowid() AS id", []);
    persist();
    return [changes, Number(idRow[0]?.id ?? 0)];
  };

  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  w.__TAURI_INTERNALS__ = {
    transformCallback: (cb: unknown) => cb,
    invoke: async (cmd: string, args: { query?: string; values?: unknown[]; key?: string }) => {
      switch (cmd) {
        case "plugin:sql|load":
          return "sqlite:moneta.db";
        case "plugin:sql|select":
          return select(args.query ?? "", args.values ?? []);
        case "plugin:sql|execute":
          return execute(args.query ?? "", args.values ?? []);
        case "get_api_key":
          return localStorage.getItem("moneta-dev-key");
        case "set_api_key":
          if (args.key) localStorage.setItem("moneta-dev-key", args.key);
          else localStorage.removeItem("moneta-dev-key");
          return null;
        case "plugin:log|log":
          return null;
        default:
          // Dialogs / file IO aren't wired in the browser sandbox.
          console.info("[browser-backend] unhandled command:", cmd);
          return null;
      }
    },
  };

  // A tiny console helper so you can wipe the dev DB while testing.
  (window as unknown as { monetaResetDev: () => void }).monetaResetDev = () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  };
  console.info("[browser-backend] in-browser SQLite ready. Run monetaResetDev() to reset.");
}
