import { getDb } from "../client";

export interface BudgetRow {
  categoryId: number;
  /** 'YYYY-MM' */
  month: string;
  amountCents: number;
}

/** All budget rows for a set of months, e.g. every month a period touches. */
export async function budgetsForMonths(months: string[]): Promise<BudgetRow[]> {
  if (months.length === 0) return [];
  const db = await getDb();
  const placeholders = months.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.select<{ category_id: number; month: string; amount_cents: number }[]>(
    `SELECT category_id, month, amount_cents FROM budgets WHERE month IN (${placeholders})`,
    months,
  );
  return rows.map((r) => ({ categoryId: r.category_id, month: r.month, amountCents: r.amount_cents }));
}

export async function setBudget(categoryId: number, month: string, amountCents: number): Promise<void> {
  const db = await getDb();
  if (amountCents <= 0) {
    await db.execute("DELETE FROM budgets WHERE category_id = $1 AND month = $2", [categoryId, month]);
    return;
  }
  await db.execute(
    "INSERT INTO budgets (category_id, month, amount_cents) VALUES ($1, $2, $3) ON CONFLICT (category_id, month) DO UPDATE SET amount_cents = $3",
    [categoryId, month, amountCents],
  );
}

/** Copy all budget rows from one month into another (overwriting existing).
 * Returns the number of categories copied. */
export async function copyBudgets(fromMonth: string, toMonth: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM budgets WHERE month = $1",
    [fromMonth],
  );
  await db.execute(
    `INSERT INTO budgets (category_id, month, amount_cents)
     SELECT category_id, $2, amount_cents FROM budgets WHERE month = $1
     ON CONFLICT (category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
    [fromMonth, toMonth],
  );
  return rows[0].n;
}
