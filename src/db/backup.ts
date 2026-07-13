/**
 * Full-database gather for the JSON backup, and the danger-zone wipe.
 * Raw row dumps on purpose: a backup should mirror the tables, not the
 * app's view of them.
 */
import { getDb } from "./client";
import type { ParsedBackup } from "../lib/export";

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
 *
 * No BEGIN/COMMIT: the SQL plugin pools connections, so a manual
 * transaction can leave a stray lock (see insertImported). Tables are
 * deleted children-first so a failure mid-way never violates a foreign key,
 * and re-running the wipe simply finishes the job.
 */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  for (const table of ["transactions", "uploads", "budgets", "rules", "goals", "bank_profiles", "accounts"]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("DELETE FROM settings WHERE key = 'recurring_stopped'");
}

/** Column lists mirror the migrations exactly — a backup is a raw table
 * dump, so restore writes the same columns back, preserving ids (foreign
 * keys in the backup point at them). */
const RESTORE_COLUMNS: { table: string; backupKey: keyof ParsedBackup["data"]; columns: string[] }[] = [
  { table: "accounts", backupKey: "accounts", columns: ["id", "name", "type", "balance_cents", "balance_as_of"] },
  { table: "categories", backupKey: "categories", columns: ["id", "name", "parent_id", "default_tier", "is_archived", "is_system"] },
  { table: "bank_profiles", backupKey: "bankProfiles", columns: ["id", "name", "delimiter", "date_format", "column_map_json", "sign_convention"] },
  { table: "uploads", backupKey: "uploads", columns: ["id", "account_id", "bank_profile_id", "filename", "imported_at", "row_count"] },
  {
    table: "transactions",
    backupKey: "transactions",
    columns: ["id", "upload_id", "account_id", "date", "amount_cents", "merchant_raw", "merchant_normalized", "category_id", "categorization_source", "tier_override", "dedup_hash", "created_at"],
  },
  { table: "rules", backupKey: "rules", columns: ["id", "matcher", "match_type", "category_id", "priority", "created_from"] },
  { table: "budgets", backupKey: "budgets", columns: ["id", "category_id", "month", "amount_cents", "rollover"] },
  { table: "goals", backupKey: "goals", columns: ["id", "name", "target_cents", "target_month", "saved_cents", "created_at"] },
];

const RESTORE_CHUNK = 500;

/**
 * Replace the entire ledger with a validated backup (parseBackup ran
 * first). Deletes everything — including categories and settings — then
 * inserts the backup's rows parents-first with their original ids.
 * No pooled BEGIN/COMMIT (see wipeAllData); a failure mid-restore can be
 * fixed by restoring again from the same file.
 */
export async function restoreBackup(backup: ParsedBackup): Promise<void> {
  const db = await getDb();

  // Children-first teardown, including the seed tables restore will refill.
  for (const table of ["transactions", "uploads", "budgets", "rules", "goals", "bank_profiles", "accounts", "categories", "settings"]) {
    await db.execute(`DELETE FROM ${table}`);
  }

  for (const { table, backupKey, columns } of RESTORE_COLUMNS) {
    const rows = backup.data[backupKey] as Record<string, unknown>[];
    for (let start = 0; start < rows.length; start += RESTORE_CHUNK) {
      const chunk = rows.slice(start, start + RESTORE_CHUNK);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((row, i) => {
        const base = i * columns.length;
        placeholders.push(`(${columns.map((_, c) => `$${base + c + 1}`).join(", ")})`);
        for (const col of columns) params.push(row[col] ?? null);
      });
      await db.execute(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
        params,
      );
    }
  }

  const settings = Object.entries(backup.data.settings);
  for (const [key, value] of settings) {
    await db.execute("INSERT INTO settings (key, value) VALUES ($1, $2)", [key, String(value)]);
  }
}
