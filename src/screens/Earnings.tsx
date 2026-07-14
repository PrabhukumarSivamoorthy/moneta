import { useCallback, useEffect, useMemo, useState } from "react";
import { useResolvedPeriod } from "../state/period";
import { centsToDecimalString, formatCents, parseAmountToCents } from "../lib/money";
import { monthsInRange, prorateBudget } from "../lib/period";
import { classifyIncome, type IncomeType } from "../lib/income";
import { allocateEarnings, type IncomeSourceSpec } from "../lib/earnings";
import { isSpend } from "../lib/budget";
import { detectRecurring } from "../lib/recurring";
import { normalizeMerchant } from "../lib/csv/normalize";
import { dedupHash } from "../lib/dedup";
import type { MatchType } from "../lib/rules";
import { listAccounts, type Account } from "../db/repo/accounts";
import { listCategories } from "../db/repo/categories";
import { getAllSettings, setSetting } from "../db/repo/settings";
import { insertManual, queryTransactions, type TxRow } from "../db/repo/transactions";
import {
  applyPlansToMonths,
  copyPlans,
  createIncomeSource,
  deleteIncomeSource,
  listIncomeSources,
  plansForMonths,
  replacePlansForMonths,
  setPlan,
  updateIncomeSource,
  type IncomePlanRow,
} from "../db/repo/income";

const label = "font-courier text-[10px] tracking-[0.18em] text-ink-mute mb-1.5";
const PLAN_GRID = "grid grid-cols-[170px_1fr_130px_120px_130px_90px] items-center gap-3";
const monoInput =
  "bg-transparent border-0 border-b border-ink/35 px-0.5 py-[3px] font-mono text-[12px] text-ink text-right focus:border-accent";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

export default function Earnings() {
  const period = useResolvedPeriod();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeCategoryId, setIncomeCategoryId] = useState<number | null>(null);
  const [planPerMonth, setPlanPerMonth] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [incName, setIncName] = useState("");
  const [incAmt, setIncAmt] = useState("");
  const [incDate, setIncDate] = useState(todayIso());
  const [incAcct, setIncAcct] = useState<number | null>(null);

  // Planned earnings: sources + per-month plans.
  const [sources, setSources] = useState<IncomeSourceSpec[]>([]);
  const [plans, setPlans] = useState<IncomePlanRow[]>([]);
  const [planEdits, setPlanEdits] = useState<Record<number, string>>({});
  const [sourceForm, setSourceForm] = useState<{ id: number | null; name: string; matcher: string; matchType: MatchType } | null>(null);
  const [armedDelete, setArmedDelete] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  /** After "apply forward": target months + their pre-apply rows, for undo. */
  const [applied, setApplied] = useState<{ months: string[]; snapshot: IncomePlanRow[] } | null>(null);

  const isMonth = period.scope === "month";
  const month = period.start.slice(0, 7);
  const months = useMemo(
    () => monthsInRange(period.start, period.end).map((m) => m.month),
    [period.start, period.end],
  );

  const load = useCallback(async () => {
    try {
      const [txs, accts, cats, settings, srcs, planRows] = await Promise.all([
        queryTransactions({ start: period.start, end: period.end }),
        listAccounts(),
        listCategories(false, true),
        getAllSettings(),
        listIncomeSources(),
        plansForMonths(months),
      ]);
      setRows(txs);
      setAccounts(accts);
      setIncAcct((id) => id ?? accts[0]?.id ?? null);
      setIncomeCategoryId(cats.find((c) => c.isSystem && c.name === "Income")?.id ?? null);
      setPlanPerMonth(settings.income_plan_cents ? centsToDecimalString(Number(settings.income_plan_cents)) : "");
      setSources(srcs);
      setPlans(planRows);
      setPlanEdits({});
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [period.start, period.end, months]);

  useEffect(() => {
    void load();
  }, [load]);

  // The undo snapshot belongs to the month it was taken for.
  useEffect(() => {
    setApplied(null);
    setCopied(null);
  }, [month]);

  const income = useMemo(
    () => rows.filter((r) => r.categoryName === "Income" && r.categoryIsSystem && r.amountCents > 0),
    [rows],
  );
  const earned = income.reduce((a, r) => a + r.amountCents, 0);
  const spent = rows.filter(isSpend).reduce((a, r) => a + -r.amountCents, 0);
  const kept = earned - spent;

  const topSource = useMemo(() => {
    const byMerchant = new Map<string, number>();
    for (const r of income) byMerchant.set(r.merchantNormalized, (byMerchant.get(r.merchantNormalized) ?? 0) + r.amountCents);
    const sorted = [...byMerchant.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0] ?? null;
  }, [income]);

  const byType = useMemo(() => {
    const types = new Map<IncomeType, number>();
    for (const r of income) {
      const t = classifyIncome(r.merchantNormalized);
      types.set(t, (types.get(t) ?? 0) + r.amountCents);
    }
    return [...types.entries()].sort((a, b) => b[1] - a[1]);
  }, [income]);

  // ---- Planned earnings (per-source) -------------------------------------
  const hasSources = sources.length > 0;
  const alloc = useMemo(() => allocateEarnings(sources, income), [sources, income]);

  const planMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plans) m.set(`${p.sourceId}:${p.month}`, p.amountCents);
    return m;
  }, [plans]);

  /** A source's plan for the whole selected period (prorated like budgets). */
  const periodPlan = useCallback(
    (sourceId: number) =>
      prorateBudget(period.start, period.end, (m) => planMap.get(`${sourceId}:${m}`) ?? 0),
    [period.start, period.end, planMap],
  );

  const sourceRows = sources.map((s) => {
    const plan = periodPlan(s.id);
    const sourceEarned = alloc.bySource.get(s.id) ?? 0;
    return { source: s, plan, earned: sourceEarned, gap: sourceEarned - plan };
  });
  const planTotals = sourceRows.reduce(
    (acc, r) => ({ plan: acc.plan + r.plan, earned: acc.earned + r.earned }),
    { plan: 0, earned: 0 },
  );

  /** Legacy single plan — the fallback until sources exist. */
  const legacyPlanCents = parseAmountToCents(planPerMonth || "0") ?? 0;
  const plannedForPeriod = hasSources
    ? planTotals.plan
    : prorateBudget(period.start, period.end, () => legacyPlanCents);
  const planPct = plannedForPeriod > 0 ? (earned / plannedForPeriod) * 100 : 0;
  const planGap = earned - plannedForPeriod;
  const planColor = planPct >= 100 ? "#2F5D45" : planPct >= 70 ? "#9C6F1F" : "#B3362C";

  /** Monthly plan figure for DTI: this month's source plans, or the legacy plan. */
  const monthlyPlanCents = hasSources
    ? sources.reduce((a, s) => a + (planMap.get(`${s.id}:${month}`) ?? 0), 0)
    : legacyPlanCents;

  /** DTI: recurring monthly obligations vs the monthly plan. */
  const dti = useMemo(() => {
    if (monthlyPlanCents <= 0) return null;
    const recurringMonthly = detectRecurring(rows).reduce((a, c) => a + c.medianCents, 0);
    return Math.round((recurringMonthly / monthlyPlanCents) * 100);
  }, [rows, monthlyPlanCents]);

  const saveSource = async () => {
    if (!sourceForm || !sourceForm.name.trim() || !sourceForm.matcher.trim()) return;
    try {
      if (sourceForm.id === null) {
        await createIncomeSource(sourceForm.name.trim(), sourceForm.matcher.trim(), sourceForm.matchType);
      } else {
        await updateIncomeSource(sourceForm.id, sourceForm.name.trim(), sourceForm.matcher.trim(), sourceForm.matchType);
      }
      setSourceForm(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeSource = async (id: number) => {
    if (armedDelete !== id) {
      setArmedDelete(id);
      return;
    }
    try {
      await deleteIncomeSource(id);
      setArmedDelete(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const commitPlanEdit = async (sourceId: number, value: string) => {
    const cents = parseAmountToCents(value || "0");
    if (cents === null || cents < 0) return;
    try {
      await setPlan(sourceId, month, cents);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const copyLastMonth = async () => {
    try {
      const n = await copyPlans(prevMonthKey(month), month);
      setCopied(n);
      setApplied(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const restMonths = yearMonths(month).filter((m) => m > month);
  const otherMonths = yearMonths(month).filter((m) => m !== month);

  const applyForward = async (targets: string[]) => {
    if (targets.length === 0) return;
    try {
      const snapshot = await plansForMonths(targets);
      await applyPlansToMonths(month, targets);
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
      await replacePlansForMonths(applied.months, applied.snapshot);
      setApplied(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const recordIncome = async () => {
    const cents = parseAmountToCents(incAmt);
    if (!incName.trim() || !cents || cents <= 0 || incAcct === null || incomeCategoryId === null) return;
    try {
      const merchantRaw = incName.trim();
      const merchantNormalized = normalizeMerchant(merchantRaw);
      await insertManual({
        accountId: incAcct,
        date: incDate,
        amountCents: cents,
        merchantRaw,
        merchantNormalized,
        categoryId: incomeCategoryId,
        dedupHash: await dedupHash(incAcct, incDate, cents, merchantNormalized),
      });
      setIncName("");
      setIncAmt("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-[20px] font-semibold">Earnings</div>
        <button
          onClick={() => setAdding(true)}
          className="cursor-pointer border-0 bg-ink px-3 py-[7px] font-courier text-[11px] font-bold text-paper hover:bg-accent"
        >
          Record income
        </button>
      </div>
      <div className="mb-6 text-[12px] italic text-ink-mute">
        Payroll and interest arrive with statements; anything else — cash, refunds outside a card, side work — record
        here by hand.
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-8 grid max-w-[980px] grid-cols-4 gap-8">
        <div className="border-t border-rule pt-3">
          <div className={label}>EARNED THIS PERIOD</div>
          <div className="font-mono text-[24px] font-semibold text-[#41684A]">{formatCents(earned)}</div>
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>TOP SOURCE</div>
          {topSource ? (
            <>
              <div className="mt-1 text-[14px] font-semibold">{topSource[0]}</div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-faint">{formatCents(topSource[1])}</div>
            </>
          ) : (
            <div className="mt-1 text-[12px] italic text-ink-faint">none yet</div>
          )}
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>KEPT</div>
          <div className="font-mono text-[24px] font-semibold" style={{ color: kept >= 0 ? "#41684A" : "#B3362C" }}>
            {formatCents(kept)}
          </div>
          <div className="mt-[3px] text-[11px] italic text-ink-faint">earned minus spending</div>
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>DEBT-TO-INCOME</div>
          {dti !== null ? (
            <div
              className="w-fit cursor-help font-mono text-[24px] font-semibold"
              style={{ color: dti > 36 ? "#B3362C" : dti > 28 ? "#9C6F1F" : "#2F5D45" }}
              title="Recurring monthly obligations as a share of planned monthly income"
            >
              {dti}%
            </div>
          ) : (
            <div className="mt-1 text-[12px] italic text-ink-faint">set a plan below</div>
          )}
          <div className="mt-[3px] text-[11px] italic text-ink-faint">monthly obligations vs planned income</div>
        </div>
      </div>

      {/* Record income */}
      {adding && (
        <div className="mb-4 flex flex-wrap items-center gap-4 border-[1.5px] border-dashed border-accent/50 bg-accent/[0.04] px-4 py-3">
          <input
            className="w-[230px] border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-serif text-[13px] text-ink focus:border-accent"
            placeholder="Source (e.g. Freelance · logo work)"
            value={incName}
            onChange={(e) => setIncName(e.target.value)}
          />
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-[11px] text-ink-faint">$</span>
            <input
              className="w-[76px] border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] text-right font-mono text-[12.5px] text-ink focus:border-accent"
              placeholder="0.00"
              value={incAmt}
              onChange={(e) => setIncAmt(e.target.value)}
            />
          </div>
          <input
            type="date"
            className="border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-mono text-[12px] text-ink focus:border-accent"
            value={incDate}
            onChange={(e) => setIncDate(e.target.value)}
          />
          <select
            className="cursor-pointer border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-serif text-[12.5px] text-ink focus:border-accent"
            value={incAcct ?? ""}
            onChange={(e) => setIncAcct(Number(e.target.value))}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            className="cursor-pointer border-0 bg-ink px-3.5 py-2 font-courier text-[11px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
            disabled={!incName.trim() || !parseAmountToCents(incAmt)}
            onClick={() => void recordIncome()}
          >
            Record income
          </button>
          <span className="cursor-pointer font-courier text-[11px] text-ink-mute underline" onClick={() => setAdding(false)}>
            cancel
          </span>
        </div>
      )}

      {/* Planned vs earned */}
      <div className="mb-7 border-t border-rule pt-3">
        <div className="mb-3 flex flex-wrap items-baseline gap-3.5">
          <div className="font-courier text-[10.5px] tracking-[0.2em] text-ink-mute">PLANNED VS EARNED</div>
          {hasSources ? (
            <span className="text-[11.5px] italic text-ink-mute">
              plan <span className="font-mono not-italic text-ink">{formatCents(plannedForPeriod)}</span> this period ·
              from {sources.length} source{sources.length === 1 ? "" : "s"} below
            </span>
          ) : (
            <span className="flex items-baseline gap-1.5 text-[11.5px] italic text-ink-mute">
              plan <span className="font-mono text-[11px] not-italic text-ink-faint">$</span>
              <input
                className="w-16 border-0 border-b border-ink/40 bg-transparent px-0.5 py-0.5 text-right font-mono text-[12px] not-italic text-ink focus:border-accent"
                value={planPerMonth}
                onChange={(e) => setPlanPerMonth(e.target.value)}
                onBlur={async (e) => {
                  const cents = parseAmountToCents(e.target.value || "0");
                  if (cents === null) return;
                  try {
                    await setSetting("income_plan_cents", String(cents));
                  } catch (err) {
                    setError(String(err));
                  }
                }}
              />
              /mo → <span className="font-mono not-italic text-ink">{formatCents(plannedForPeriod)}</span> this period
            </span>
          )}
          {plannedForPeriod > 0 && (
            <span className="ml-auto font-mono text-[11.5px]" style={{ color: planColor }}>
              {Math.round(planPct)}% of plan
            </span>
          )}
        </div>
        <div className="relative h-4 max-w-[760px]">
          <div className="absolute inset-x-0 top-1 h-[7px] bg-ink/[0.07]">
            <div className="h-full" style={{ width: `${Math.min(planPct, 100)}%`, background: planColor }} />
          </div>
          <div className="absolute inset-x-0 top-[11px] h-px bg-ink/35" />
        </div>
        {plannedForPeriod > 0 && (
          <div className="flex max-w-[760px] justify-end gap-1.5 text-[11.5px] italic text-ink-mute">
            <span className="font-mono not-italic" style={{ color: planGap >= 0 ? "#41684A" : "#B3362C" }}>
              {formatCents(planGap)}
            </span>
            {planGap >= 0 ? "ahead of plan" : "behind plan"}
          </div>
        )}
      </div>

      {/* Planned earnings by source */}
      <div className="mb-7 border-t border-rule pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2.5">
          <div className="font-courier text-[10.5px] tracking-[0.2em] text-ink-mute">PLANNED EARNINGS BY SOURCE</div>
          <button
            data-testid="add-source"
            onClick={() => setSourceForm({ id: null, name: "", matcher: "", matchType: "contains" })}
            className="ml-2 cursor-pointer border-0 bg-ink px-2.5 py-[5px] font-courier text-[10.5px] font-bold text-paper hover:bg-accent"
          >
            Add source
          </button>
          <button
            onClick={() => void copyLastMonth()}
            disabled={!isMonth || !hasSources}
            title={isMonth ? `Copy ${prevMonthKey(month)} plans into ${month}` : "Switch to month scope to edit plans"}
            className="cursor-pointer border border-accent/50 bg-transparent px-2.5 py-[5px] font-courier text-[10.5px] text-accent hover:bg-accent/[0.08] disabled:cursor-default disabled:border-ink/20 disabled:text-ink-faint"
          >
            Copy last month's plans
          </button>
          <div className="flex items-center gap-1.5 border border-accent/50 px-2.5 py-[5px]">
            <span className="font-courier text-[10.5px] text-ink-mute">
              Apply {isMonth ? shortMonthName(month) : "month"} to
            </span>
            <button
              data-testid="plan-apply-rest-of-year"
              onClick={() => void applyForward(restMonths)}
              disabled={!isMonth || !hasSources || restMonths.length === 0}
              className="cursor-pointer border-0 bg-transparent p-0 font-courier text-[10.5px] text-accent underline hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:no-underline"
            >
              rest of year
            </button>
            <span className="font-courier text-[10.5px] text-ink-faint">·</span>
            <button
              data-testid="plan-apply-entire-year"
              onClick={() => void applyForward(otherMonths)}
              disabled={!isMonth || !hasSources}
              className="cursor-pointer border-0 bg-transparent p-0 font-courier text-[10.5px] text-accent underline hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:no-underline"
            >
              entire year
            </button>
          </div>
        </div>
        <div className="mb-3 text-[11.5px] italic text-ink-faint">
          {isMonth
            ? "Income matching each source's pattern counts toward its plan; the rest shows as Unplanned."
            : "Switch the period bar to MONTH to edit planned amounts."}
          {copied !== null && (
            <span className="ml-3 font-courier not-italic text-[11px] text-accent">
              ✓ copied {copied} plan{copied === 1 ? "" : "s"} from {prevMonthKey(month)}
            </span>
          )}
          {applied && (
            <span data-testid="plan-apply-note" className="ml-3 font-courier not-italic text-[11px] text-accent">
              ✓ applied to {shortMonthName(applied.months[0])}–{shortMonthName(applied.months[applied.months.length - 1])} ({applied.months.length} month{applied.months.length === 1 ? "" : "s"}){" "}
              <button
                data-testid="plan-apply-undo"
                onClick={() => void undoApply()}
                className="cursor-pointer border-0 bg-transparent p-0 font-courier text-[11px] text-accent underline hover:text-ink"
              >
                undo
              </button>
            </span>
          )}
        </div>

        {sourceForm && (
          <div className="mb-4 flex flex-wrap items-center gap-4 border-[1.5px] border-dashed border-accent/50 bg-accent/[0.04] px-4 py-3">
            <input
              className="w-[160px] border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-serif text-[13px] text-ink focus:border-accent"
              placeholder="Source name (e.g. Salary)"
              value={sourceForm.name}
              onChange={(e) => setSourceForm((f) => f && { ...f, name: e.target.value })}
            />
            <select
              className="cursor-pointer border-0 border-b border-ink/35 bg-transparent px-0.5 py-[5px] font-serif text-[12.5px] text-ink focus:border-accent"
              value={sourceForm.matchType}
              onChange={(e) => setSourceForm((f) => f && { ...f, matchType: e.target.value as MatchType })}
            >
              <option value="contains">contains</option>
              <option value="prefix">starts with</option>
              <option value="regex">regex</option>
            </select>
            <input
              className="w-[200px] border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-mono text-[12px] text-ink focus:border-accent"
              placeholder="pattern (e.g. acme payroll)"
              value={sourceForm.matcher}
              onChange={(e) => setSourceForm((f) => f && { ...f, matcher: e.target.value })}
            />
            <button
              className="cursor-pointer border-0 bg-ink px-3.5 py-2 font-courier text-[11px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
              disabled={!sourceForm.name.trim() || !sourceForm.matcher.trim()}
              onClick={() => void saveSource()}
            >
              {sourceForm.id === null ? "Add source" : "Save source"}
            </button>
            <span className="cursor-pointer font-courier text-[11px] text-ink-mute underline" onClick={() => setSourceForm(null)}>
              cancel
            </span>
          </div>
        )}

        {hasSources ? (
          <div className="max-w-[900px] border-t-2 border-ink">
            <div className={`${PLAN_GRID} border-b border-ink px-1 py-2 font-courier text-[10px] tracking-[0.14em] text-ink-mute`}>
              <span>SOURCE</span>
              <span>PATTERN</span>
              <span>{isMonth ? "PLAN /MO" : period.scope === "year" ? `PLAN ${period.label}` : "PRORATED"}</span>
              <span className="text-right">EARNED</span>
              <span className="text-right">GAP</span>
              <span />
            </div>
            {sourceRows.map(({ source: s, plan, earned: sourceEarned, gap }) => (
              <div key={s.id} data-testid="plan-row" className={`${PLAN_GRID} border-b border-[rgba(74,108,88,0.28)] px-1 py-2 hover:bg-ink/[0.035]`}>
                <span className="text-[13px] font-medium">{s.name}</span>
                <span className="font-mono text-[11px] text-ink-mute">
                  {s.matchType === "contains" ? "…" : s.matchType === "prefix" ? "^" : "//"} {s.matcher}
                </span>
                {isMonth ? (
                  <div className="flex items-baseline gap-[3px]">
                    <span className="font-mono text-[11px] text-ink-faint">$</span>
                    <input
                      data-testid={`plan-input-${s.id}`}
                      className={`${monoInput} w-[74px]`}
                      value={planEdits[s.id] ?? (plan > 0 ? centsToDecimalString(plan) : "")}
                      placeholder="0"
                      onChange={(e) => setPlanEdits((st) => ({ ...st, [s.id]: e.target.value }))}
                      onBlur={(e) => void commitPlanEdit(s.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </div>
                ) : (
                  <span className="font-mono text-[12px]">{formatCents(plan)}</span>
                )}
                <span className="text-right font-mono text-[12px] text-[#41684A]">{formatCents(sourceEarned)}</span>
                <span
                  className="text-right font-mono text-[11.5px]"
                  style={{ color: plan === 0 ? "#8B9384" : gap >= 0 ? "#2F5D45" : "#B3362C" }}
                >
                  {plan === 0 ? "—" : gap === 0 ? "✓" : `${gap > 0 ? "+" : "−"}${formatCents(Math.abs(gap))}`}
                </span>
                <span className="text-right font-courier text-[10.5px]">
                  <span
                    className="cursor-pointer text-ink-mute underline hover:text-ink"
                    onClick={() => setSourceForm({ id: s.id, name: s.name, matcher: s.matcher, matchType: s.matchType })}
                  >
                    edit
                  </span>{" "}
                  <span
                    className={`cursor-pointer underline ${armedDelete === s.id ? "text-danger" : "text-ink-mute hover:text-ink"}`}
                    onClick={() => void removeSource(s.id)}
                  >
                    {armedDelete === s.id ? "confirm?" : "delete"}
                  </span>
                </span>
              </div>
            ))}
            {alloc.unplannedCents > 0 && (
              <div data-testid="plan-row-unplanned" className={`${PLAN_GRID} border-b border-[rgba(74,108,88,0.28)] px-1 py-2`}>
                <span className="text-[13px] italic text-ink-mute">Unplanned</span>
                <span className="text-[11px] italic text-ink-faint">
                  {alloc.unplannedCount} {alloc.unplannedCount === 1 ? "entry" : "entries"} matching no source
                </span>
                <span className="font-mono text-[12px] text-ink-faint">—</span>
                <span className="text-right font-mono text-[12px] text-[#41684A]">{formatCents(alloc.unplannedCents)}</span>
                <span className="text-right font-mono text-[11.5px] text-ink-faint">—</span>
                <span />
              </div>
            )}
            <div data-testid="plan-total-row" className={`${PLAN_GRID} border-b-2 border-ink px-1 py-2.5`}>
              <span className="font-courier text-[11px] tracking-[0.12em] text-ink-mute">TOTAL</span>
              <span />
              <span className="pl-1 font-mono text-[12px]">{formatCents(planTotals.plan)}</span>
              <span className="text-right font-mono text-[12px] font-semibold">
                {formatCents(planTotals.earned + alloc.unplannedCents)}
              </span>
              <span
                className="text-right font-mono text-[11.5px]"
                style={{ color: planGap >= 0 ? "#2F5D45" : "#B3362C" }}
              >
                {planGap >= 0 ? "+" : "−"}
                {formatCents(Math.abs(planGap))}
              </span>
              <span />
            </div>
          </div>
        ) : (
          <div className="text-[12px] italic text-ink-faint">
            No income sources yet. Add one (e.g. Salary ← <span className="font-mono not-italic">payroll</span>) to
            plan earnings per source — until then the single monthly plan above applies.
          </div>
        )}
      </div>

      {/* By source type */}
      <div className="mb-7 border-t border-rule pt-3">
        <div className="mb-3 font-courier text-[10.5px] tracking-[0.2em] text-ink-mute">BY SOURCE TYPE</div>
        <div className="flex max-w-[560px] flex-col gap-2">
          {byType.map(([type, cents]) => (
            <div key={type} className="grid grid-cols-[150px_1fr_110px_44px] items-center gap-3">
              <span className="text-[12.5px]">{type}</span>
              <div className="relative h-2.5">
                <div className="absolute inset-x-0 top-0.5 h-1.5 bg-ink/[0.07]">
                  <div className="h-full bg-accent/60" style={{ width: `${earned > 0 ? (cents / earned) * 100 : 0}%` }} />
                </div>
                <div className="absolute inset-x-0 top-2 h-px bg-ink/35" />
              </div>
              <span className="text-right font-mono text-[11.5px]">{formatCents(cents)}</span>
              <span className="text-right font-mono text-[10.5px] text-ink-faint">
                {earned > 0 ? Math.round((cents / earned) * 100) : 0}%
              </span>
            </div>
          ))}
          {byType.length === 0 && <span className="text-[12px] italic text-ink-faint">no income this period</span>}
        </div>
      </div>

      {/* Income table */}
      <div className="border-t-2 border-ink">
        <div className="grid grid-cols-[100px_1fr_170px_90px_120px] gap-3 border-b border-ink px-1 py-2 font-courier text-[10px] tracking-[0.14em] text-ink-mute">
          <span>DATE</span>
          <span>SOURCE</span>
          <span>ACCOUNT</span>
          <span />
          <span className="text-right">AMOUNT</span>
        </div>
        {income.map((r) => (
          <div key={r.id} className="grid grid-cols-[100px_1fr_170px_90px_120px] items-center gap-3 border-b border-[rgba(74,108,88,0.28)] px-1 py-[7px] hover:bg-ink/[0.035]">
            <span className="font-mono text-[11px] text-ink-mute">{r.date}</span>
            <span className="text-[13px]">{r.merchantNormalized}</span>
            <span className="text-[11.5px] text-ink-mute">{r.accountName}</span>
            {r.uploadId === null ? (
              <span className="w-fit border border-ink/20 px-1.5 py-px font-courier text-[9px] tracking-[0.1em] text-ink-mute">MANUAL</span>
            ) : (
              <span />
            )}
            <span className="text-right font-mono text-[12.5px] text-[#41684A]">{formatCents(r.amountCents)}</span>
          </div>
        ))}
        {income.length === 0 && (
          <div className="border-b border-[rgba(74,108,88,0.28)] py-8 text-center text-[13px] italic text-ink-mute">
            No income in this period. Step ◀ to an earlier period, or record income by hand. Payroll rows land here
            once you categorize them as Income in the ledger.
          </div>
        )}
      </div>
    </div>
  );
}
