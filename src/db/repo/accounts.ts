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

export async function createAccount(name: string, type: string): Promise<Account> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO accounts (name, type) VALUES ($1, $2)",
    [name, type],
  );
  return { id: res.lastInsertId as number, name, type };
}
