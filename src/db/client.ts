import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

/**
 * Single shared connection to the app database. Migrations are registered
 * and applied on the Rust side (src-tauri/src/lib.rs) before first use.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:moneta.db");
  }
  return dbPromise;
}
