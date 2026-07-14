/**
 * Income sources (named, pattern-matched — see lib/earnings.ts) and their
 * per-month planned amounts. Plans mirror the budgets repo patterns exactly:
 * upsert per (source, month), copy/apply-forward via one upsert-copy per
 * target month, and never BEGIN/COMMIT through the pooled plugin.
 */
import { getDb } from "../client";
import type { MatchType } from "../../lib/rules";
import type { IncomeSourceSpec } from "../../lib/earnings";

interface SourceRow {
  id: number;
  name: string;
  matcher: string;
  match_type: string;
  priority: number;
}

function fromSourceRow(r: SourceRow): IncomeSourceSpec {
  return {
    id: r.id,
    name: r.name,
    matcher: r.matcher,
    matchType: r.match_type as MatchType,
    priority: r.priority,
  };
}

export async function listIncomeSources(): Promise<IncomeSourceSpec[]> {
  const db = await getDb();
  const rows = await db.select<SourceRow[]>(
    "SELECT id, name, matcher, match_type, priority FROM income_sources ORDER BY priority, id",
  );
  return rows.map(fromSourceRow);
}

export async function createIncomeSource(
  name: string,
  matcher: string,
  matchType: MatchType,
): Promise<IncomeSourceSpec> {
  const db = await getDb();
  const [{ next }] = await db.select<{ next: number }[]>(
    "SELECT COALESCE(MAX(priority), 0) + 10 AS next FROM income_sources",
  );
  const res = await db.execute(
    "INSERT INTO income_sources (name, matcher, match_type, priority) VALUES ($1, $2, $3, $4)",
    [name, matcher, matchType, next],
  );
  return { id: res.lastInsertId as number, name, matcher, matchType, priority: next };
}

export async function updateIncomeSource(
  id: number,
  name: string,
  matcher: string,
  matchType: MatchType,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE income_sources SET name = $1, matcher = $2, match_type = $3 WHERE id = $4",
    [name, matcher, matchType, id],
  );
}

/** Children-first: the source's plans go with it. */
export async function deleteIncomeSource(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM income_plans WHERE source_id = $1", [id]);
  await db.execute("DELETE FROM income_sources WHERE id = $1", [id]);
}

export interface IncomePlanRow {
  sourceId: number;
  /** 'YYYY-MM' */
  month: string;
  amountCents: number;
}

export async function plansForMonths(months: string[]): Promise<IncomePlanRow[]> {
  if (months.length === 0) return [];
  const db = await getDb();
  const placeholders = months.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.select<{ source_id: number; month: string; amount_cents: number }[]>(
    `SELECT source_id, month, amount_cents FROM income_plans WHERE month IN (${placeholders})`,
    months,
  );
  return rows.map((r) => ({ sourceId: r.source_id, month: r.month, amountCents: r.amount_cents }));
}

export async function setPlan(sourceId: number, month: string, amountCents: number): Promise<void> {
  const db = await getDb();
  if (amountCents <= 0) {
    await db.execute("DELETE FROM income_plans WHERE source_id = $1 AND month = $2", [sourceId, month]);
    return;
  }
  await db.execute(
    "INSERT INTO income_plans (source_id, month, amount_cents) VALUES ($1, $2, $3) ON CONFLICT (source_id, month) DO UPDATE SET amount_cents = $3",
    [sourceId, month, amountCents],
  );
}

/** Copy all plan rows from one month into another (overwriting existing).
 * Returns the number of sources copied. */
export async function copyPlans(fromMonth: string, toMonth: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM income_plans WHERE month = $1",
    [fromMonth],
  );
  await db.execute(
    `INSERT INTO income_plans (source_id, month, amount_cents)
     SELECT source_id, $2, amount_cents FROM income_plans WHERE month = $1
     ON CONFLICT (source_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
    [fromMonth, toMonth],
  );
  return rows[0].n;
}

/** Copy one month's plans into each target month (one upsert per month). */
export async function applyPlansToMonths(fromMonth: string, toMonths: string[]): Promise<void> {
  const db = await getDb();
  for (const toMonth of toMonths) {
    await db.execute(
      `INSERT INTO income_plans (source_id, month, amount_cents)
       SELECT source_id, $2, amount_cents FROM income_plans WHERE month = $1
       ON CONFLICT (source_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
      [fromMonth, toMonth],
    );
  }
}

/** Replace the given months' plan rows with the provided set — undo of
 * applyPlansToMonths (rows = the pre-apply snapshot). */
export async function replacePlansForMonths(months: string[], rows: IncomePlanRow[]): Promise<void> {
  if (months.length === 0) return;
  const db = await getDb();
  const placeholders = months.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(`DELETE FROM income_plans WHERE month IN (${placeholders})`, months);
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.sourceId, r.month, r.amountCents);
    return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
  });
  await db.execute(
    `INSERT INTO income_plans (source_id, month, amount_cents) VALUES ${tuples.join(", ")}`,
    values,
  );
}
