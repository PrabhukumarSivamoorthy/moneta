import { getDb } from "../client";

export interface Account {
  id: number;
  name: string;
  type: string;
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.select<Account[]>("SELECT id, name, type FROM accounts ORDER BY name");
}

export interface AccountStats extends Account {
  entryCount: number;
  lastDate: string | null;
}

export async function accountStats(): Promise<AccountStats[]> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; name: string; type: string; entry_count: number; last_date: string | null }[]
  >(
    `SELECT a.id, a.name, a.type, COUNT(t.id) AS entry_count, MAX(t.date) AS last_date
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
     GROUP BY a.id ORDER BY a.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    entryCount: r.entry_count,
    lastDate: r.last_date,
  }));
}

export async function createAccount(name: string, type: string): Promise<Account> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO accounts (name, type) VALUES ($1, $2)",
    [name, type],
  );
  return { id: res.lastInsertId as number, name, type };
}
