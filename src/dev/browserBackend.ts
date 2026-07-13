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

const STORAGE_KEY = "moneta-dev-db";
const MIGRATIONS = [migration0001, migration0002];

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

/** Rewrite `$1,$2,…` placeholders to sql.js's `?` positional binds. */
function toPositional(query: string): string {
  return query.replace(/\$\d+/g, "?");
}

export async function installBrowserBackend(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  const saved = localStorage.getItem(STORAGE_KEY);
  const db: Database = saved ? new SQL.Database(fromBase64(saved)) : new SQL.Database();

  if (!saved) {
    // Fresh DB: run migrations, then record them so the app's own migration
    // runner (which we bypass here) is never expected.
    db.run("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY, description TEXT)");
    MIGRATIONS.forEach((sql, i) => {
      db.run(sql);
      db.run("INSERT INTO _sqlx_migrations (version, description) VALUES (?, ?)", [i + 1, `migration_${i + 1}`]);
    });
  }

  const persist = () => localStorage.setItem(STORAGE_KEY, toBase64(db.export()));
  persist();

  const select = (query: string, values: unknown[]): Record<string, unknown>[] => {
    const stmt = db.prepare(toPositional(query));
    stmt.bind(values as never[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const execute = (query: string, values: unknown[]): [number, number] => {
    db.run(toPositional(query), values as never[]);
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
