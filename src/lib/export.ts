/**
 * Backup & export builders. Pure functions: callers gather the data and
 * hand it in; these produce the exact bytes that hit disk, so tests can
 * pin the formats.
 *
 * The JSON backup is a complete snapshot (transactions, accounts,
 * categories, rules, budgets, goals, bank profiles, uploads, settings).
 * The API key is NOT part of settings or this file — it lives in a separate
 * secret file and can never leak through an export.
 */
import type { TxRow } from "../db/repo/transactions";

export const BACKUP_VERSION = 1;

export interface BackupInput {
  exportedAt: string;
  accounts: unknown[];
  categories: unknown[];
  transactions: unknown[];
  rules: unknown[];
  budgets: unknown[];
  goals: unknown[];
  bankProfiles: unknown[];
  uploads: unknown[];
  incomeSources: unknown[];
  incomePlans: unknown[];
  settings: Record<string, string>;
}

export function buildBackup(input: BackupInput): string {
  return JSON.stringify(
    {
      app: "moneta",
      backupVersion: BACKUP_VERSION,
      exportedAt: input.exportedAt,
      data: {
        accounts: input.accounts,
        categories: input.categories,
        transactions: input.transactions,
        rules: input.rules,
        budgets: input.budgets,
        goals: input.goals,
        bankProfiles: input.bankProfiles,
        uploads: input.uploads,
        incomeSources: input.incomeSources,
        incomePlans: input.incomePlans,
        settings: input.settings,
      },
    },
    null,
    2,
  );
}

export interface ParsedBackup {
  exportedAt: string;
  data: {
    accounts: Record<string, unknown>[];
    categories: Record<string, unknown>[];
    transactions: Record<string, unknown>[];
    rules: Record<string, unknown>[];
    budgets: Record<string, unknown>[];
    goals: Record<string, unknown>[];
    bankProfiles: Record<string, unknown>[];
    uploads: Record<string, unknown>[];
    incomeSources: Record<string, unknown>[];
    incomePlans: Record<string, unknown>[];
    settings: Record<string, string>;
  };
}

const BACKUP_TABLES = [
  "accounts",
  "categories",
  "transactions",
  "rules",
  "budgets",
  "goals",
  "bankProfiles",
  "uploads",
] as const;

/**
 * Validate a backup file's structure. Throws with a human-readable reason
 * on anything that is not a Moneta backup this version can restore —
 * callers show the message verbatim.
 */
export function parseBackup(json: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Not a JSON file — is this really a Moneta backup?");
  }
  const b = raw as { app?: unknown; backupVersion?: unknown; exportedAt?: unknown; data?: Record<string, unknown> };
  if (b?.app !== "moneta") throw new Error("Not a Moneta backup (missing app marker).");
  if (b.backupVersion !== BACKUP_VERSION) {
    throw new Error(`Backup version ${String(b.backupVersion)} is not supported by this app (expected ${BACKUP_VERSION}).`);
  }
  if (typeof b.data !== "object" || b.data === null) throw new Error("Backup has no data section.");
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(b.data[table])) throw new Error(`Backup is missing the "${table}" table.`);
  }
  if (typeof b.data.settings !== "object" || b.data.settings === null || Array.isArray(b.data.settings)) {
    throw new Error('Backup is missing the "settings" table.');
  }
  // Tables added after v1 shipped are optional: backups exported before the
  // planned-earnings feature simply restore them as empty.
  for (const table of ["incomeSources", "incomePlans"]) {
    if (b.data[table] === undefined) b.data[table] = [];
    else if (!Array.isArray(b.data[table])) throw new Error(`Backup's "${table}" table is malformed.`);
  }
  return raw as ParsedBackup;
}

/** RFC-4180 field escaping: quote when the value contains a comma, quote,
 * or newline; double embedded quotes. */
function csvField(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const TX_CSV_HEADER = [
  "date",
  "amount",
  "merchant",
  "merchant_raw",
  "account",
  "category",
  "tier_override",
  "source",
] as const;

/** Transactions as CSV. Amounts are decimal dollars with two places,
 * negative = money out — the same shape a bank statement uses. */
export function buildTransactionsCsv(rows: readonly TxRow[]): string {
  const lines = [TX_CSV_HEADER.join(",")];
  for (const r of rows) {
    const sign = r.amountCents < 0 ? "-" : "";
    const abs = Math.abs(r.amountCents);
    lines.push(
      [
        csvField(r.date),
        csvField(`${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`),
        csvField(r.merchantNormalized),
        csvField(r.merchantRaw),
        csvField(r.accountName),
        csvField(r.categoryName),
        csvField(r.tierOverride),
        csvField(r.categorizationSource),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
