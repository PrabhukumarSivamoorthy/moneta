/**
 * Full-database gather for the JSON backup, and the danger-zone wipe.
 * Raw row dumps on purpose: a backup should mirror the tables, not the
 * app's view of them.
 */
import { getDb } from "./client";

export interface BackupData {
  accounts: unknown[];
  categories: unknown[];
  transactions: unknown[];
  rules: unknown[];
  budgets: unknown[];
  goals: unknown[];
  bankProfiles: unknown[];
  uploads: unknown[];
  settings: Record<string, string>;
}

export async function gatherBackupData(): Promise<BackupData> {
  const db = await getDb();
  const all = (table: string) => db.select<unknown[]>(`SELECT * FROM ${table}`);
  const [accounts, categories, transactions, rules, budgets, goals, bankProfiles, uploads, settingRows] =
    await Promise.all([
      all("accounts"),
      all("categories"),
      all("transactions"),
      all("rules"),
      all("budgets"),
      all("goals"),
      all("bank_profiles"),
      all("uploads"),
      db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings"),
    ]);
  return {
    accounts,
    categories,
    transactions,
    rules,
    budgets,
    goals,
    bankProfiles,
    uploads,
    settings: Object.fromEntries(settingRows.map((r) => [r.key, r.value])),
  };
}

/**
 * Deletes every transaction, upload, budget, rule, goal, bank profile, and
 * account. Categories and settings survive so a fresh start keeps the
 * defaults. There is no cloud copy to restore from — callers must confirm.
 */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await db.execute("BEGIN");
  try {
    for (const table of ["transactions", "uploads", "budgets", "rules", "goals", "bank_profiles", "accounts"]) {
      await db.execute(`DELETE FROM ${table}`);
    }
    await db.execute("DELETE FROM settings WHERE key = 'recurring_stopped'");
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}
