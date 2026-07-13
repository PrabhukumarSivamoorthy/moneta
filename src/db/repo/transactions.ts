import { getDb } from "../client";
import type { Tier } from "../../lib/tier";

export interface NewTransaction {
  date: string;
  amountCents: number;
  merchantRaw: string;
  merchantNormalized: string;
  dedupHash: string;
  /** Set when the rules engine categorized the row at import time. */
  categoryId?: number | null;
}

export interface TxRow {
  id: number;
  date: string;
  amountCents: number;
  merchantRaw: string;
  merchantNormalized: string;
  accountId: number;
  accountName: string;
  categoryId: number | null;
  categoryName: string | null;
  categoryDefaultTier: Tier | null;
  categoryIsSystem: boolean;
  categorizationSource: "rule" | "ai" | "manual" | "none";
  tierOverride: Tier | null;
  /** Null for hand-recorded entries (income, repayments, set-asides). */
  uploadId: number | null;
}

export interface TxQuery {
  /** Inclusive ISO date range from the global period filter. */
  start: string;
  end: string;
  accountId?: number | null;
  categoryId?: number | null;
  /** Case-insensitive substring over merchant (raw and normalized). */
  search?: string;
  sortKey?: "date" | "amount" | "merchant";
  sortDir?: "asc" | "desc";
}

interface QueryRow {
  id: number;
  date: string;
  amount_cents: number;
  merchant_raw: string;
  merchant_normalized: string;
  account_id: number;
  account_name: string;
  category_id: number | null;
  category_name: string | null;
  category_default_tier: string | null;
  category_is_system: number | null;
  categorization_source: string;
  tier_override: string | null;
  upload_id: number | null;
}

const SORT_COLUMNS = {
  date: "t.date",
  amount: "t.amount_cents",
  merchant: "t.merchant_normalized",
} as const;

/**
 * Period-scoped ledger query. Tier filtering is intentionally NOT done here:
 * effective tier is computed by src/lib/tier.ts on the returned rows.
 */
export async function queryTransactions(q: TxQuery): Promise<TxRow[]> {
  const db = await getDb();
  const where: string[] = ["t.date >= $1", "t.date <= $2"];
  const params: unknown[] = [q.start, q.end];
  if (q.accountId != null) {
    params.push(q.accountId);
    where.push(`t.account_id = $${params.length}`);
  }
  if (q.categoryId != null) {
    params.push(q.categoryId);
    where.push(`t.category_id = $${params.length}`);
  }
  if (q.search?.trim()) {
    params.push(`%${q.search.trim()}%`);
    const p = `$${params.length}`;
    where.push(`(t.merchant_normalized LIKE ${p} OR t.merchant_raw LIKE ${p})`);
  }
  const sort = SORT_COLUMNS[q.sortKey ?? "date"];
  const dir = q.sortDir === "asc" ? "ASC" : "DESC";
  const rows = await db.select<QueryRow[]>(
    `SELECT t.id, t.date, t.amount_cents, t.merchant_raw, t.merchant_normalized,
            t.account_id, a.name AS account_name,
            t.category_id, c.name AS category_name, c.default_tier AS category_default_tier,
            c.is_system AS category_is_system,
            t.categorization_source, t.tier_override, t.upload_id
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${sort} ${dir}, t.id ${dir}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: r.amount_cents,
    merchantRaw: r.merchant_raw,
    merchantNormalized: r.merchant_normalized,
    accountId: r.account_id,
    accountName: r.account_name,
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryDefaultTier: r.category_default_tier as Tier | null,
    categoryIsSystem: (r.category_is_system ?? 0) !== 0,
    categorizationSource: r.categorization_source as TxRow["categorizationSource"],
    tierOverride: r.tier_override as Tier | null,
    uploadId: r.upload_id,
  }));
}

export async function setTransactionCategory(
  id: number,
  categoryId: number | null,
  source: "rule" | "ai" | "manual",
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE transactions SET category_id = $1, categorization_source = $2 WHERE id = $3",
    [categoryId, categoryId === null ? "none" : source, id],
  );
}

export async function setTransactionsCategory(
  ids: number[],
  categoryId: number | null,
  source: "rule" | "ai" | "manual",
): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 3}`).join(", ");
  await db.execute(
    `UPDATE transactions SET category_id = $1, categorization_source = $2 WHERE id IN (${placeholders})`,
    [categoryId, categoryId === null ? "none" : source, ...ids],
  );
}

export async function deleteTransactions(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(`DELETE FROM transactions WHERE id IN (${placeholders})`, ids);
}

export async function setTierOverride(id: number, tier: Tier | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE transactions SET tier_override = $1 WHERE id = $2", [tier, id]);
}

/** Hand-recorded entry (manual income, repayment, goal set-aside): no
 * upload, categorization_source 'manual'. */
export async function insertManual(entry: {
  accountId: number;
  date: string;
  amountCents: number;
  merchantRaw: string;
  merchantNormalized: string;
  categoryId: number | null;
  dedupHash: string;
}): Promise<number> {
  const db = await getDb();
  const res = await db.execute(
    `INSERT INTO transactions (upload_id, account_id, date, amount_cents, merchant_raw, merchant_normalized, category_id, categorization_source, dedup_hash, created_at)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, 'manual', $7, $8)`,
    [
      entry.accountId,
      entry.date,
      entry.amountCents,
      entry.merchantRaw,
      entry.merchantNormalized,
      entry.categoryId,
      entry.dedupHash,
      new Date().toISOString(),
    ],
  );
  return res.lastInsertId as number;
}

/** All dedup hashes already in the ledger for one account. */
export async function existingHashes(accountId: number): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select<{ dedup_hash: string }[]>(
    "SELECT dedup_hash FROM transactions WHERE account_id = $1",
    [accountId],
  );
  return new Set(rows.map((r) => r.dedup_hash));
}

// SQLite allows 32766 bound parameters; 10 per row keeps any realistic
// statement import in ONE atomic INSERT.
const CHUNK = 3000;

/**
 * Insert a batch of imported transactions. Each multi-row INSERT statement
 * is atomic on its own. Deliberately NO BEGIN/COMMIT here: the SQL plugin
 * runs statements on a connection POOL, so BEGIN and COMMIT can land on
 * different connections and leave a stray open write-transaction holding
 * the file lock ("database is locked", code 5). A failure between chunks
 * is safe to retry — dedup hashes make the re-import skip everything that
 * already landed.
 */
export async function insertImported(
  uploadId: number,
  accountId: number,
  rows: NewTransaction[],
): Promise<number> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  {
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((row, i) => {
        const base = i * 10;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`,
        );
        params.push(
          uploadId,
          accountId,
          row.date,
          row.amountCents,
          row.merchantRaw,
          row.merchantNormalized,
          row.categoryId ?? null,
          row.categoryId != null ? "rule" : "none",
          row.dedupHash,
          createdAt,
        );
      });
      await db.execute(
        `INSERT INTO transactions (upload_id, account_id, date, amount_cents, merchant_raw, merchant_normalized, category_id, categorization_source, dedup_hash, created_at) VALUES ${placeholders.join(", ")}`,
        params,
      );
    }
  }
  return rows.length;
}

export async function countTransactions(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM transactions",
  );
  return rows[0].n;
}
