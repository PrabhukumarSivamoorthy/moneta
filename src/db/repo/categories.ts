import { getDb } from "../client";
import type { Tier } from "../../lib/tier";

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  defaultTier: Tier;
  isArchived: boolean;
}

interface Row {
  id: number;
  name: string;
  parent_id: number | null;
  default_tier: string;
  is_archived: number;
}

function fromRow(r: Row): Category {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    defaultTier: r.default_tier as Tier,
    isArchived: r.is_archived !== 0,
  };
}

export async function listCategories(includeArchived = false): Promise<Category[]> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    includeArchived
      ? "SELECT id, name, parent_id, default_tier, is_archived FROM categories ORDER BY name"
      : "SELECT id, name, parent_id, default_tier, is_archived FROM categories WHERE is_archived = 0 ORDER BY name",
  );
  return rows.map(fromRow);
}

export async function createCategory(name: string, defaultTier: Tier): Promise<Category> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO categories (name, default_tier) VALUES ($1, $2)",
    [name, defaultTier],
  );
  return { id: res.lastInsertId as number, name, parentId: null, defaultTier, isArchived: false };
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
