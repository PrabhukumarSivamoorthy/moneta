/**
 * Duplicate detection. dedup_hash = sha256(account_id | date | amount_cents |
 * merchant_normalized). On import, a row is flagged if its hash matches an
 * existing ledger row OR an earlier row in the same file — this protects
 * against overlapping statement periods. Flagged rows are skipped by default
 * in review, with a per-row override.
 */

export async function dedupHash(
  accountId: number,
  date: string,
  amountCents: number,
  merchantNormalized: string,
): Promise<string> {
  const input = `${accountId}|${date}|${amountCents}|${merchantNormalized}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface DedupFlags {
  hash: string;
  /** Matches a transaction already in the ledger. */
  duplicateOfDb: boolean;
  /** Matches an earlier row in the same file. */
  duplicateInFile: boolean;
}

/**
 * Compute hashes for the given rows (in order) and flag duplicates against
 * the existing ledger hashes and within the file itself.
 */
export async function flagDuplicates(
  rows: { date: string; amountCents: number; merchantNormalized: string }[],
  accountId: number,
  existingHashes: ReadonlySet<string>,
): Promise<DedupFlags[]> {
  const seenInFile = new Set<string>();
  const out: DedupFlags[] = [];
  for (const row of rows) {
    const hash = await dedupHash(
      accountId,
      row.date,
      row.amountCents,
      row.merchantNormalized,
    );
    out.push({
      hash,
      duplicateOfDb: existingHashes.has(hash),
      duplicateInFile: seenInFile.has(hash),
    });
    seenInFile.add(hash);
  }
  return out;
}
