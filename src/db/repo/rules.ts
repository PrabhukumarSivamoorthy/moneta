import { getDb } from "../client";
import type { MatchType, RuleSpec } from "../../lib/rules";

export interface Rule extends RuleSpec {
  createdFrom: "manual" | "correction";
}

interface Row {
  id: number;
  matcher: string;
  match_type: string;
  category_id: number;
  priority: number;
  created_from: string;
}

function fromRow(r: Row): Rule {
  return {
    id: r.id,
    matcher: r.matcher,
    matchType: r.match_type as MatchType,
    categoryId: r.category_id,
    priority: r.priority,
    createdFrom: r.created_from as Rule["createdFrom"],
  };
}

export async function listRules(): Promise<Rule[]> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    "SELECT id, matcher, match_type, category_id, priority, created_from FROM rules ORDER BY priority, id",
  );
  return rows.map(fromRow);
}

export async function createRule(
  matcher: string,
  matchType: MatchType,
  categoryId: number,
  createdFrom: "manual" | "correction",
): Promise<Rule> {
  const db = await getDb();
  // New rules go to the end of the priority order.
  const [{ next }] = await db.select<{ next: number }[]>(
    "SELECT COALESCE(MAX(priority), 0) + 10 AS next FROM rules",
  );
  const res = await db.execute(
    "INSERT INTO rules (matcher, match_type, category_id, priority, created_from) VALUES ($1, $2, $3, $4, $5)",
    [matcher, matchType, categoryId, next, createdFrom],
  );
  return {
    id: res.lastInsertId as number,
    matcher,
    matchType,
    categoryId,
    priority: next,
    createdFrom,
  };
}

export async function deleteRule(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM rules WHERE id = $1", [id]);
}
