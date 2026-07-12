import { getDb } from "../client";

export interface Goal {
  id: number;
  name: string;
  targetCents: number;
  /** 'YYYY-MM' */
  targetMonth: string;
  savedCents: number;
}

interface Row {
  id: number;
  name: string;
  target_cents: number;
  target_month: string;
  saved_cents: number;
}

export async function listGoals(): Promise<Goal[]> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    "SELECT id, name, target_cents, target_month, saved_cents FROM goals ORDER BY target_month, id",
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    targetCents: r.target_cents,
    targetMonth: r.target_month,
    savedCents: r.saved_cents,
  }));
}

export async function createGoal(
  name: string,
  targetCents: number,
  targetMonth: string,
): Promise<Goal> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO goals (name, target_cents, target_month, created_at) VALUES ($1, $2, $3, $4)",
    [name, targetCents, targetMonth, new Date().toISOString()],
  );
  return { id: res.lastInsertId as number, name, targetCents, targetMonth, savedCents: 0 };
}

export async function addToGoal(id: number, cents: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE goals SET saved_cents = saved_cents + $1 WHERE id = $2", [cents, id]);
}

export async function deleteGoal(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM goals WHERE id = $1", [id]);
}
