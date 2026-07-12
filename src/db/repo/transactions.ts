import { getDb } from "../client";

export interface NewTransaction {
  date: string;
  amountCents: number;
  merchantRaw: string;
  merchantNormalized: string;
  dedupHash: string;
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

const CHUNK = 100;

/**
 * Insert a batch of imported transactions atomically. Rows land
 * uncategorized (`categorization_source = 'none'`); the rules engine and
 * AI assist categorize in later phases.
 */
export async function insertImported(
  uploadId: number,
  accountId: number,
  rows: NewTransaction[],
): Promise<number> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  await db.execute("BEGIN");
  try {
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((row, i) => {
        const base = i * 8;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'none', $${base + 7}, $${base + 8})`,
        );
        params.push(
          uploadId,
          accountId,
          row.date,
          row.amountCents,
          row.merchantRaw,
          row.merchantNormalized,
          row.dedupHash,
          createdAt,
        );
      });
      await db.execute(
        `INSERT INTO transactions (upload_id, account_id, date, amount_cents, merchant_raw, merchant_normalized, categorization_source, dedup_hash, created_at) VALUES ${placeholders.join(", ")}`,
        params,
      );
    }
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
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
