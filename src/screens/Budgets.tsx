import { useEffect, useState } from "react";
import { TIER_LABELS, TIERS, type Tier } from "../lib/tier";
import {
  createCategory,
  listCategories,
  setCategoryArchived,
  updateCategory,
  type Category,
} from "../db/repo/categories";

const selectCls =
  "bg-transparent border-0 border-b border-ink/40 px-0.5 py-[6px] text-[12.5px] text-ink cursor-pointer font-serif focus:border-accent";
const inputCls =
  "bg-transparent border-0 border-b border-ink/40 px-0.5 py-[6px] text-[13px] text-ink font-serif focus:border-accent";

/**
 * Phase 2 delivers the category manager (names, default tiers, archive).
 * Budget amounts, thresholds, and tier targets arrive in Phase 3.
 */
export default function Budgets() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState<Tier>("comfortable");

  const load = async () => {
    try {
      setCategories(await listCategories(true));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const visible = categories?.filter((c) => showArchived || !c.isArchived) ?? null;

  return (
    <div>
      <div className="mb-1 text-[20px] font-semibold">Budgets</div>
      <div className="mb-6 text-[12.5px] italic text-ink-mute">
        Category budgets and tier targets arrive in phase 3 — categories and
        their default tiers are managed below.
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      <div className="mb-3.5 flex items-baseline justify-between border-t border-rule pt-3">
        <div className="font-courier text-[10.5px] tracking-[0.2em] text-ink-mute">CATEGORIES</div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] italic text-ink-mute">
          <input
            type="checkbox"
            className="accent-[#2F5D45]"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          show archived
        </label>
      </div>

      {visible === null ? (
        <div className="text-[13px] italic text-ink-mute">Loading…</div>
      ) : (
        <table className="w-full max-w-2xl border-collapse">
          <thead>
            <tr className="border-b border-rule">
              <th className="py-2 pr-4 text-left font-courier text-[10px] font-normal tracking-[0.2em] text-ink-mute">NAME</th>
              <th className="py-2 pr-4 text-left font-courier text-[10px] font-normal tracking-[0.2em] text-ink-mute">DEFAULT TIER</th>
              <th className="py-2 text-right font-courier text-[10px] font-normal tracking-[0.2em] text-ink-mute"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id} className={`border-b border-rule-soft ${c.isArchived ? "opacity-45" : ""}`}>
                <td className="py-2 pr-4 text-[13.5px]">{c.name}</td>
                <td className="py-2 pr-4">
                  <select
                    className={selectCls}
                    value={c.defaultTier}
                    disabled={c.isArchived}
                    onChange={async (e) => {
                      try {
                        await updateCategory(c.id, c.name, e.target.value as Tier);
                        await load();
                      } catch (err) {
                        setError(String(err));
                      }
                    }}
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {TIER_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right">
                  <span
                    className="cursor-pointer font-courier text-[11px] text-ink-mute underline hover:text-ink"
                    onClick={async () => {
                      try {
                        await setCategoryArchived(c.id, !c.isArchived);
                        await load();
                      } catch (err) {
                        setError(String(err));
                      }
                    }}
                  >
                    {c.isArchived ? "restore" : "archive"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding ? (
        <div className="mt-4 flex max-w-2xl items-end gap-3">
          <input
            className={`${inputCls} flex-1`}
            placeholder="Category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select className={selectCls} value={newTier} onChange={(e) => setNewTier(e.target.value as Tier)}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            className="cursor-pointer border-0 bg-accent px-4 py-2 font-courier text-[11.5px] font-bold text-paper hover:bg-accent/90 disabled:bg-ink/15 disabled:text-ink-mute"
            disabled={!newName.trim()}
            onClick={async () => {
              try {
                await createCategory(newName.trim(), newTier);
                setNewName("");
                setAdding(false);
                await load();
              } catch (err) {
                setError(String(err));
              }
            }}
          >
            Add
          </button>
          <button
            className="cursor-pointer border border-ink/35 bg-transparent px-4 py-2 font-courier text-[11.5px] text-ink hover:bg-ink/[0.07]"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div
          className="mt-4 cursor-pointer font-courier text-[11.5px] text-accent underline"
          onClick={() => setAdding(true)}
        >
          + add category
        </div>
      )}
    </div>
  );
}
