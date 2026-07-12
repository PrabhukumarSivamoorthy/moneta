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

export async function listUploads(): Promise<Upload[]> {
  const db = await getDb();
  return db.select<Upload[]>(
    "SELECT id, account_id, bank_profile_id, filename, imported_at, row_count FROM uploads ORDER BY imported_at DESC",
  );
}
