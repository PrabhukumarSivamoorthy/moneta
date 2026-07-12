import Database from "@tauri-apps/plugin-sql";
import { logError } from "../platform/log";

let dbPromise: Promise<Database> | null = null;

type SqlMethod = (query: string, bindValues?: unknown[]) => Promise<unknown>;

/**
 * Every SQL statement in the app flows through this connection, so wrapping
 * select/execute here logs EVERY database failure — with the failing query —
 * to the app log file. That is the first place to look when something like
 * "database is locked" shows up in the UI.
 */
async function connect(): Promise<Database> {
  const db = await Database.load("sqlite:moneta.db");
  for (const method of ["select", "execute"] as const) {
    const original = (db[method] as SqlMethod).bind(db);
    (db as unknown as Record<string, SqlMethod>)[method] = async (
      query: string,
      bindValues?: unknown[],
    ) => {
      try {
        return await original(query, bindValues);
      } catch (e) {
        void logError(
          "sql",
          `${method} failed: ${String(e)} — query: ${query.slice(0, 300)} (${bindValues?.length ?? 0} params)`,
        );
        throw e;
      }
    };
  }
  return db;
}

/**
 * Single shared connection to the app database. Migrations are registered
 * and applied on the Rust side (src-tauri/src/lib.rs) before first use.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = connect();
  }
  return dbPromise;
}
