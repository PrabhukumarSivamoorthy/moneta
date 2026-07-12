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
        settings: input.settings,
      },
    },
    null,
    2,
  );
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
