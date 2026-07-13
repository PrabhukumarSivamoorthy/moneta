import { useCallback, useEffect, useMemo, useState } from "react";
import { useResolvedPeriod } from "../state/period";
import { centsToDecimalString, formatCents, parseAmountToCents } from "../lib/money";
import { monthsInRange, prorateBudget } from "../lib/period";
import {
  budgetStatus,
  budgetTierAllocation,
  spendByCategory,
  tierMixActual,
  type BudgetStatus,
} from "../lib/budget";
import { TIER_LABELS, TIERS, type Tier } from "../lib/tier";
import {
  createCategory,
  listCategories,
  setCategoryArchived,
  updateCategory,
  type Category,
} from "../db/repo/categories";
import {
  applyBudgetsToMonths,
  budgetsForMonths,
  copyBudgets,
  replaceBudgetsForMonths,
  setBudget,
  type BudgetRow,
} from "../db/repo/budgets";
import { getAllSettings, setSetting } from "../db/repo/settings";
import { queryTransactions, type TxRow } from "../db/repo/transactions";

const STATUS_COLOR: Record<BudgetStatus, string> = {
  ok: "#2F5D45",
  warn: "#9C6F1F",
  over: "#B3362C",
};

const TIER_DOT: Record<Tier, string> = {
  need: "#2F5D45",
  comfortable: "rgba(47,93,69,0.45)",
  luxury: "transparent",
};

const GRID = "grid grid-cols-[44px_150px_120px_1fr_116px_96px] items-center gap-3.5";
const label = "font-courier text-[10.5px] tracking-[0.2em] text-ink-mute";
const monoInput =
  "bg-transparent border-0 border-b border-ink/35 px-0.5 py-[3px] font-mono text-[12px] text-ink text-right focus:border-accent";

function TierDot({ tier }: { tier: Tier }) {
  return (
    <span
      title={TIER_LABELS[tier]}
      className="inline-flex h-[11px] w-[11px] cursor-help items-center justify-center rounded-full border-[1.5px] border-accent"
      style={{ background: TIER_DOT[tier] }}
    />
  );
}

/** Month key 'YYYY-MM' the editable (month-scope) budgets belong to. */
function monthKey(startIso: string): string {
  return startIso.slice(0, 7);
}

function prevMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** All 12 month keys of the given month's year. */
function yearMonths(month: string): string[] {
  const year = month.slice(0, 4);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

function shortMonthName(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleString("en-US", { month: "short" });
}

export default function Budgets() {
  const period = useResolvedPeriod();
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [targets, setTargets] = useState<Record<Tier, string>>({ need: "50", comfortable: "30", luxury: "20" });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  /** After "apply forward": target months + their pre-apply rows, for undo. */
  const [applied, setApplied] = useState<{ months: string[]; snapshot: BudgetRow[] } | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState<Tier>("comfortable");
  const [newBudget, setNewBudget] = useState("100");
  const [manageOpen, setManageOpen] = useState(false);

  /** Local edit buffer for budget inputs, keyed by categoryId. */
  const [edits, setEdits] = useState<Record<number, string>>({});

  const isMonth = period.scope === "month";
  const month = monthKey(period.start);
  const months = useMemo(
    () => monthsInRange(period.start, period.end).map((m) => m.month),
    [period.start, period.end],
  );

  const load = useCallback(async () => {
    try {
      const [cats, buds, txs, settings] = await Promise.all([
        listCategories(true),
        budgetsForMonths(months),
        queryTransactions({ start: period.start, end: period.end }),
        getAllSettings(),
      ]);
      setCategories(cats);
      setBudgets(buds);
      setTxRows(txs);
      setTargets({
        need: settings.tier_target_need ?? "50",
        comfortable: settings.tier_target_comfortable ?? "30",
        luxury: settings.tier_target_luxury ?? "20",
      });
      setEdits({});
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    }
  }, [months, period.start, period.end]);

  useEffect(() => {
    void load();
  }, [load]);

  // The undo snapshot belongs to the month it was taken for.
  useEffect(() => {
    setApplied(null);
    setCopied(null);
  }, [month]);

  const budgetMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of budgets) m.set(`${b.categoryId}:${b.month}`, b.amountCents);
    return m;
  }, [budgets]);

  /** Budget for the whole selected period (prorated across its months). */
  const periodBudget = useCallback(
    (categoryId: number) =>
      prorateBudget(period.start, period.end, (m) => budgetMap.get(`${categoryId}:${m}`) ?? 0),
    [period.start, period.end, budgetMap],
  );

  const spend = useMemo(() => spendByCategory(txRows), [txRows]);
  const mix = useMemo(() => tierMixActual(txRows), [txRows]);

  const active = categories.filter((c) => !c.isArchived);
  const rows = active.map((c) => {
    const budget = periodBudget(c.id);
    const spent = spend.get(c.id) ?? 0;
    const status = budgetStatus(spent, budget);
    return { cat: c, budget, spent, left: budget - spent, status };
  });
  const totals = rows.reduce(
    (acc, r) => ({ budget: acc.budget + r.budget, spent: acc.spent + r.spent }),
    { budget: 0, spent: 0 },
  );
  const uncatSpent = spend.get(null) ?? 0;

  /** How the budgeted dollars split across tiers (by category default tier). */
  const alloc = budgetTierAllocation(
    rows.map((r) => ({ defaultTier: r.cat.defaultTier, budgetCents: r.budget })),
  );

  const targetSum = TIERS.reduce((s, t) => s + (Number(targets[t]) || 0), 0);

  const restMonths = yearMonths(month).filter((m) => m > month);
  const otherMonths = yearMonths(month).filter((m) => m !== month);

  const applyForward = async (targets: string[]) => {
    if (targets.length === 0) return;
    try {
      const snapshot = await budgetsForMonths(targets);
      await applyBudgetsToMonths(month, targets);
      setApplied({ months: targets, snapshot });
      setCopied(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const undoApply = async () => {
    if (!applied) return;
    try {
      await replaceBudgetsForMonths(applied.months, applied.snapshot);
      setApplied(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const commitBudgetEdit = async (categoryId: number, value: string) => {
    const cents = parseAmountToCents(value || "0");
    if (cents === null || cents < 0) return;
    try {
      await setBudget(categoryId, month, cents);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const scopeNote = isMonth
    ? `${period.label} budgets — edit amounts below`
    : period.scope === "year"
      ? `${period.label} — sum of the year's monthly budgets`
      : `${period.label} — prorated from monthly budgets`;

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3.5">
        <div className="text-[20px] font-semibold">Budgets</div>
        <div className="text-[12px] italic text-ink-mute">{scopeNote}</div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setAdding(true)}
            className="cursor-pointer border-0 bg-ink px-3 py-[7px] font-courier text-[11px] font-bold text-paper hover:bg-accent"
          >
            Add category
          </button>
          <button
            onClick={async () => {
              try {
                const n = await copyBudgets(prevMonthKey(month), month);
                setCopied(n);
                await load();
              } catch (e) {
                setError(String(e));
              }
            }}
            disabled={!isMonth}
            title={isMonth ? `Copy ${prevMonthKey(month)} budgets into ${month}` : "Switch to month scope to edit budgets"}
            className="cursor-pointer border border-accent/50 bg-transparent px-3 py-[7px] font-courier text-[11px] text-accent hover:bg-accent/[0.08] disabled:cursor-default disabled:border-ink/20 disabled:text-ink-faint"
          >
            Copy last month's budgets
          </button>
          <div className="flex items-center gap-1.5 border border-accent/50 px-3 py-[7px]">
            <span className="font-courier text-[11px] text-ink-mute">
              Apply {isMonth ? shortMonthName(month) : "month"} to
            </span>
            <button
              data-testid="apply-rest-of-year"
              onClick={() => void applyForward(restMonths)}
              disabled={!isMonth || restMonths.length === 0}
              title={
                !isMonth
                  ? "Switch to month scope to apply budgets forward"
                  : restMonths.length === 0
                    ? "No months left this year"
                    : `Copy ${month} budgets into ${restMonths.join(", ")}`
              }
              className="cursor-pointer border-0 bg-transparent p-0 font-courier text-[11px] text-accent underline hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:no-underline"
            >
              rest of year
            </button>
            <span className="font-courier text-[11px] text-ink-faint">·</span>
            <button
              data-testid="apply-entire-year"
              onClick={() => void applyForward(otherMonths)}
              disabled={!isMonth}
              title={
                isMonth
                  ? `Copy ${month} budgets into every other month of ${month.slice(0, 4)} (overwrites earlier months too)`
                  : "Switch to month scope to apply budgets forward"
              }
              className="cursor-pointer border-0 bg-transparent p-0 font-courier text-[11px] text-accent underline hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:no-underline"
            >
              entire year
            </button>
          </div>
        </div>
      </div>
      <div className="mb-4 text-[11.5px] italic text-ink-faint">
        {isMonth
          ? "Budgets are set per month. Other scopes compare spend against the prorated amount."
          : "Switch the period bar to MONTH to edit budget amounts."}
        {copied !== null && (
          <span className="ml-3 font-courier not-italic text-[11px] text-accent">
            ✓ copied {copied} budget{copied === 1 ? "" : "s"} from {prevMonthKey(month)}
          </span>
        )}
        {applied && (
          <span data-testid="apply-note" className="ml-3 font-courier not-italic text-[11px] text-accent">
            ✓ applied to {shortMonthName(applied.months[0])}–{shortMonthName(applied.months[applied.months.length - 1])} ({applied.months.length} month{applied.months.length === 1 ? "" : "s"}){" "}
            <button
              data-testid="apply-undo"
              onClick={() => void undoApply()}
              className="cursor-pointer border-0 bg-transparent p-0 font-courier text-[11px] text-accent underline hover:text-ink"
            >
              undo
            </button>
          </span>
        )}
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {adding && (
        <div className="mb-4 flex flex-wrap items-center gap-4 border-[1.5px] border-dashed border-accent/50 bg-accent/[0.04] px-4 py-3">
          <input
            className="w-[170px] border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-serif text-[13px] text-ink focus:border-accent"
            placeholder="Category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select
            className="cursor-pointer border-0 border-b border-ink/35 bg-transparent px-0.5 py-[5px] font-serif text-[12.5px] text-ink focus:border-accent"
            value={newTier}
            onChange={(e) => setNewTier(e.target.value as Tier)}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-[11px] text-ink-faint">$</span>
            <input className={`${monoInput} w-[70px]`} value={newBudget} onChange={(e) => setNewBudget(e.target.value)} />
            <span className="font-courier text-[10.5px] text-ink-mute">/mo</span>
          </div>
          <button
            className="cursor-pointer border-0 bg-ink px-3.5 py-2 font-courier text-[11px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
            disabled={!newName.trim()}
            onClick={async () => {
              try {
                const cat = await createCategory(newName.trim(), newTier);
                const cents = parseAmountToCents(newBudget || "0");
                if (cents && cents > 0) await setBudget(cat.id, month, cents);
                setNewName("");
                setAdding(false);
                await load();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Add category
          </button>
          <span className="cursor-pointer font-courier text-[11px] text-ink-mute underline" onClick={() => setAdding(false)}>
            cancel
          </span>
        </div>
      )}

      {/* Budget table */}
      <div className="mb-9 border-t-2 border-ink">
        <div className={`${GRID} border-b border-ink px-1 py-2 font-courier text-[10px] tracking-[0.14em] text-ink-mute`}>
          <span>TIER</span>
          <span>CATEGORY</span>
          <span>{isMonth ? "BUDGET /MO" : period.scope === "year" ? `BUDGET ${period.label}` : "PRORATED"}</span>
          <span>PROGRESS</span>
          <span className="text-right">SPENT</span>
          <span className="text-right">LEFT</span>
        </div>
        {!loaded ? (
          <div className="px-1 py-4 text-[13px] italic text-ink-mute">Loading…</div>
        ) : (
          rows.map(({ cat, budget, spent, left, status }) => {
            const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : spent > 0 ? 100 : 0;
            return (
              <div key={cat.id} className={`${GRID} border-b border-[rgba(74,108,88,0.28)] px-1 py-2 hover:bg-ink/[0.035]`}>
                <TierDot tier={cat.defaultTier} />
                <span className="text-[13px] font-medium">{cat.name}</span>
                {isMonth ? (
                  <div className="flex items-baseline gap-[3px]">
                    <span className="font-mono text-[11px] text-ink-faint">$</span>
                    <input
                      className={`${monoInput} w-[66px]`}
                      value={edits[cat.id] ?? (budget > 0 ? centsToDecimalString(budget) : "")}
                      placeholder="0"
                      onChange={(e) => setEdits((s) => ({ ...s, [cat.id]: e.target.value }))}
                      onBlur={(e) => void commitBudgetEdit(cat.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </div>
                ) : (
                  <span className="font-mono text-[12px]">{formatCents(budget)}</span>
                )}
                <div className="relative h-3">
                  <div className="absolute inset-x-0 top-[3px] h-[6px] bg-ink/[0.07]">
                    <div className="h-full" style={{ width: `${pct}%`, background: STATUS_COLOR[status] }} />
                  </div>
                  {period.elapsedFraction > 0 && period.elapsedFraction < 1 && (
                    <div
                      className="absolute top-0 h-3 w-px bg-ink/40"
                      title="Pace — where spending would be if spread evenly"
                      style={{ left: `${period.elapsedFraction * 100}%` }}
                    />
                  )}
                  <div className="absolute inset-x-0 top-[9px] h-px bg-ink/35" />
                </div>
                <span className="text-right font-mono text-[12px]" style={{ color: STATUS_COLOR[status] }}>
                  {formatCents(spent)}
                </span>
                <span className={`text-right font-mono text-[11.5px] ${left < 0 ? "text-danger" : "text-ink-soft"}`}>
                  {formatCents(left)}
                </span>
              </div>
            );
          })
        )}
        <div className={`${GRID} border-b-2 border-ink px-1 py-2.5`}>
          <span />
          <span className="font-courier text-[11px] tracking-[0.12em] text-ink-mute">TOTAL</span>
          <span className="pl-2.5 font-mono text-[12px]">{formatCents(totals.budget)}</span>
          <span />
          <span className="text-right font-mono text-[12px] font-semibold">{formatCents(totals.spent)}</span>
          <span className={`text-right font-mono text-[11.5px] ${totals.budget - totals.spent < 0 ? "text-danger" : ""}`}>
            {formatCents(totals.budget - totals.spent)}
          </span>
        </div>
      </div>

      {uncatSpent > 0 && (
        <div className="mb-9 -mt-5 text-[12px] italic text-ink-mute">
          {formatCents(uncatSpent)} across {mix.uncategorizedCount} uncategorized{" "}
          {mix.uncategorizedCount === 1 ? "entry" : "entries"} isn't budgeted — categorize them in Transactions.
        </div>
      )}

      {/* Tier targets */}
      <div className={`${label} mb-3.5`}>TIER TARGETS — MUST SUM TO 100</div>
      <div className="mb-3 grid grid-cols-3 gap-11">
        {TIERS.map((t) => {
          const actual = mix.sharePct[t];
          const target = Number(targets[t]) || 0;
          const off = Math.abs(actual - target) > 5 && totals.spent > 0;
          const budgeted = alloc.sharePct[t];
          const budgetedOff = Math.abs(budgeted - target) > 5 && alloc.totalCents > 0;
          return (
            <div key={t} className="border-t border-rule pt-3">
              <div className="mb-2.5 flex items-center gap-2">
                <TierDot tier={t} />
                <span className="font-courier text-[11.5px] font-bold tracking-[0.1em]">{TIER_LABELS[t].toUpperCase()}</span>
              </div>
              <div className="flex items-baseline gap-2.5">
                <input
                  className={`${monoInput} w-[52px] text-[16px]`}
                  value={targets[t]}
                  onChange={(e) => setTargets((s) => ({ ...s, [t]: e.target.value }))}
                  onBlur={async (e) => {
                    const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                    setTargets((s) => ({ ...s, [t]: String(v) }));
                    try {
                      await setSetting(`tier_target_${t}`, String(v));
                    } catch (err) {
                      setError(String(err));
                    }
                  }}
                />
                <span className="font-mono text-[13px] text-ink-faint">%</span>
                <span className="ml-auto text-[12px] italic text-ink-mute">
                  actual{" "}
                  <span className={`font-mono not-italic ${off ? "text-danger" : "text-ink"}`}>{actual}%</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between text-[12px] italic text-ink-mute">
                <span>
                  budgeted{" "}
                  <span
                    data-testid={`tier-budgeted-${t}`}
                    className={`font-mono not-italic ${budgetedOff ? "text-danger" : "text-ink"}`}
                  >
                    {budgeted}%
                  </span>
                </span>
                <span className="font-mono not-italic text-[11px] text-ink-faint">
                  {formatCents(alloc.budgetCents[t])}
                  {isMonth ? "/mo" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {alloc.totalCents > 0 && (
        <div className="mb-3 text-[11.5px] italic text-ink-faint">
          Budgeted mix shows how your budget amounts split across tiers (by each category's default
          tier) — adjust budgets above until it matches your targets.
        </div>
      )}
      {targetSum !== 100 && (
        <div className="mb-6 text-[12.5px] italic text-danger">
          Targets sum to <span className="font-mono not-italic">{targetSum}%</span> — adjust them to total 100.
        </div>
      )}
      {mix.uncategorizedCount > 0 && totals.spent > 0 && (
        <div className="mb-6 text-[11.5px] italic text-ink-faint">
          Actual mix excludes {mix.uncategorizedCount} uncategorized{" "}
          {mix.uncategorizedCount === 1 ? "entry" : "entries"} ({formatCents(mix.uncategorizedCents)}).
        </div>
      )}

      {/* Manage categories */}
      <div className="mt-10 border-t border-rule pt-3">
        <div
          className={`${label} cursor-pointer select-none hover:text-ink`}
          onClick={() => setManageOpen((o) => !o)}
        >
          {manageOpen ? "▾" : "▸"} MANAGE CATEGORIES
        </div>
        {manageOpen && (
          <table className="mt-3 w-full max-w-xl border-collapse">
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className={`border-b border-rule-soft ${c.isArchived ? "opacity-45" : ""}`}>
                  <td className="py-2 pr-4 text-[13px]">{c.name}</td>
                  <td className="py-2 pr-4">
                    <select
                      className="cursor-pointer border-0 border-b border-ink/40 bg-transparent px-0.5 py-1 font-serif text-[12.5px] text-ink focus:border-accent"
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
      </div>
    </div>
  );
}
