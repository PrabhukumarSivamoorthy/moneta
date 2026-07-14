import { getDb } from "../client";

export interface Upload {
  id: number;
  account_id: number;
  bank_profile_id: number;
  filename: string;
  imported_at: string;
  row_count: number;
}

export async function createUpload(
  accountId: number,
  bankProfileId: number,
  filename: string,
  rowCount: number,
): Promise<number> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO uploads (account_id, bank_profile_id, filename, imported_at, row_count) VALUES ($1, $2, $3, $4, $5)",
    [accountId, bankProfileId, filename, new Date().toISOString(), rowCount],
  );
  return res.lastInsertId as number;
}

/** Every (account, profile) pairing ever imported, oldest first — the caller
 * keeps the last pairing per account to pre-select the matching bank profile
 * when an account is chosen on the Upload screen. */
export async function listUploadProfilePairs(): Promise<
  { accountId: number; bankProfileId: number }[]
> {
  const db = await getDb();
  const rows = await db.select<{ account_id: number; bank_profile_id: number }[]>(
    "SELECT account_id, bank_profile_id FROM uploads ORDER BY id",
  );
  return rows.map((r) => ({ accountId: r.account_id, bankProfileId: r.bank_profile_id }));
}

export interface UploadStats extends Upload {
  account_name: string;
  /** Rows from this upload still in the ledger (some may have been deleted). */
  remaining: number;
}

export async function listUploads(): Promise<UploadStats[]> {
  const db = await getDb();
  return db.select<UploadStats[]>(
    `SELECT u.id, u.account_id, u.bank_profile_id, u.filename, u.imported_at, u.row_count,
            a.name AS account_name, COUNT(t.id) AS remaining
     FROM uploads u
     JOIN accounts a ON a.id = u.account_id
     LEFT JOIN transactions t ON t.upload_id = u.id
     GROUP BY u.id ORDER BY u.imported_at DESC`,
  );
}

/** Undo an import: delete every transaction the upload brought in, then
 * the upload record itself. Children first — no pooled transaction. */
export async function deleteUpload(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM transactions WHERE upload_id = $1", [id]);
  await db.execute("DELETE FROM uploads WHERE id = $1", [id]);
}
