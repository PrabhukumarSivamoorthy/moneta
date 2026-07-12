import { getDb } from "../client";
import type { Tier } from "../../lib/tier";

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  defaultTier: Tier;
  isArchived: boolean;
  /** System categories (Income, Lent & borrowed, Investing transfer, Card
   * payment) route non-spending money; they are excluded from budgets, the
   * tier mix, and category management by default. */
  isSystem: boolean;
}

interface Row {
  id: number;
  name: string;
  parent_id: number | null;
  default_tier: string;
  is_archived: number;
  is_system: number;
}

function fromRow(r: Row): Category {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    defaultTier: r.default_tier as Tier,
    isArchived: r.is_archived !== 0,
    isSystem: r.is_system !== 0,
  };
}

export async function listCategories(
  includeArchived = false,
  includeSystem = false,
): Promise<Category[]> {
  const db = await getDb();
  const where: string[] = [];
  if (!includeArchived) where.push("is_archived = 0");
  if (!includeSystem) where.push("is_system = 0");
  const rows = await db.select<Row[]>(
    `SELECT id, name, parent_id, default_tier, is_archived, is_system FROM categories${
      where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""
    } ORDER BY is_system, name`,
  );
  return rows.map(fromRow);
}

export async function createCategory(name: string, defaultTier: Tier): Promise<Category> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO categories (name, default_tier) VALUES ($1, $2)",
    [name, defaultTier],
  );
  return { id: res.lastInsertId as number, name, parentId: null, defaultTier, isArchived: false, isSystem: false };
}

export async function updateCategory(id: number, name: string, defaultTier: Tier): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE categories SET name = $1, default_tier = $2 WHERE id = $3",
    [name, defaultTier, id],
  );
}

export async function setCategoryArchived(id: number, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE categories SET is_archived = $1 WHERE id = $2", [archived ? 1 : 0, id]);
}
