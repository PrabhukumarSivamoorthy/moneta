import { getDb } from "../client";

export interface Account {
  id: number;
  name: string;
  type: string;
  /** Maintained by hand in Settings — statement balance as of last update. */
  balanceCents: number;
  balanceAsOf: string | null;
}

interface AccountRow {
  id: number;
  name: string;
  type: string;
  balance_cents: number;
  balance_as_of: string | null;
}

function fromRow(r: AccountRow): Account {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    balanceCents: r.balance_cents,
    balanceAsOf: r.balance_as_of,
  };
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  const rows = await db.select<AccountRow[]>(
    "SELECT id, name, type, balance_cents, balance_as_of FROM accounts ORDER BY name",
  );
  return rows.map(fromRow);
}

export async function setAccountBalance(
  id: number,
  balanceCents: number,
  asOf: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE accounts SET balance_cents = $1, balance_as_of = $2 WHERE id = $3",
    [balanceCents, asOf, id],
  );
}

export interface AccountStats extends Account {
  entryCount: number;
  lastDate: string | null;
}

export async function accountStats(): Promise<AccountStats[]> {
  const db = await getDb();
  const rows = await db.select<
    (AccountRow & { entry_count: number; last_date: string | null })[]
  >(
    `SELECT a.id, a.name, a.type, a.balance_cents, a.balance_as_of,
            COUNT(t.id) AS entry_count, MAX(t.date) AS last_date
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
     GROUP BY a.id ORDER BY a.name`,
  );
  return rows.map((r) => ({
    ...fromRow(r),
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
  return { id: res.lastInsertId as number, name, type, balanceCents: 0, balanceAsOf: null };
}
