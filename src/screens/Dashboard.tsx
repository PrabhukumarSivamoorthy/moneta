import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNavigate } from "../App";
import { useResolvedPeriod } from "../state/period";
import { formatCents } from "../lib/money";
import { monthsInRange, prorateBudget } from "../lib/period";
import { budgetStatus, spendByCategory, tierMixActual } from "../lib/budget";
import { categorySpendByBucket, tierShareByBucket, tierSpendByBucket } from "../lib/chart";
import { effectiveTier, TIER_LABELS, TIERS, type Tier } from "../lib/tier";
import {
  AXIS_STROKE,
  ChartFrame,
  GRID_STROKE,
  INK,
  PaperTooltip,
  STATUS,
  TIER_FILL,
  LUXURY_STROKE,
  tickStyle,
} from "../components/charts";
import { listCategories, type Category } from "../db/repo/categories";
import { budgetsForMonths, type BudgetRow } from "../db/repo/budgets";
import { getAllSettings } from "../db/repo/settings";
import { countTransactions, queryTransactions, type TxRow } from "../db/repo/transactions";

const label = "font-courier text-[10.5px] tracking-[0.2em] text-ink-mute";

function TierDot({ tier, size = 11 }: { tier: Tier; size?: number }) {
  return (
    <span
      title={TIER_LABELS[tier]}
      className="inline-flex flex-none items-center justify-center rounded-full border-[1.5px] border-accent"
      style={{ width: size, height: size, background: TIER_FILL[tier] }}
    />
  );
}

export default function Dashboard() {
  const period = useResolvedPeriod();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [targets, setTargets] = useState<Record<Tier, number>>({ need: 50, comfortable: 30, luxury: 20 });
  const [ledgerEmpty, setLedgerEmpty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"mix" | "breakdown">("mix");
  const [tierTab, setTierTab] = useState<Tier>("need");
  const [breakdownTab, setBreakdownTab] = useState<"category" | "tier" | "alerts">("category");
  const [expandedCat, setExpandedCat] = useState<number | null>(null);
  const [expandedTier, setExpandedTier] = useState<Tier | null>(null);
  const [chartCat, setChartCat] = useState<number | null>(null);

  const months = useMemo(
    () => monthsInRange(period.start, period.end).map((m) => m.month),
    [period.start, period.end],
  );

  const load = useCallback(async () => {
    try {
      const [txs, cats, buds, settings, total] = await Promise.all([
        queryTransactions({ start: period.start, end: period.end }),
        listCategories(),
        budgetsForMonths(months),
        getAllSettings(),
        countTransactions(),
      ]);
      setRows(txs);
      setCategories(cats);
      setBudgets(buds);
      setTargets({
        need: Number(settings.tier_target_need ?? 50),
        comfortable: Number(settings.tier_target_comfortable ?? 30),
        luxury: Number(settings.tier_target_luxury ?? 20),
      });
      setLedgerEmpty(total === 0);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    }
  }, [period.start, period.end, months]);

  useEffect(() => {
    void load();
  }, [load]);

  const budgetMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of budgets) m.set(`${b.categoryId}:${b.month}`, b.amountCents);
    return m;
  }, [budgets]);
  const periodBudget = useCallback(
    (categoryId: number) =>
      prorateBudget(period.start, period.end, (m) => budgetMap.get(`${categoryId}:${m}`) ?? 0),
    [period.start, period.end, budgetMap],
  );

  const spend = useMemo(() => spendByCategory(rows), [rows]);
  const mix = useMemo(() => tierMixActual(rows), [rows]);
  const tierBuckets = useMemo(() => tierSpendByBucket(rows, period.buckets), [rows, period.buckets]);

  const totalSpent = [...spend.values()].reduce((a, b) => a + b, 0);
  const totalBudget = categories.reduce((a, c) => a + periodBudget(c.id), 0);
  const totalPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const totalStatus = budgetStatus(totalSpent, totalBudget);

  const catRows = categories
    .map((c) => {
      const budget = periodBudget(c.id);
      const spent = spend.get(c.id) ?? 0;
      return { cat: c, budget, spent, status: budgetStatus(spent, budget) };
    })
    .sort((a, b) => b.spent - a.spent);
  const alerts = catRows.filter((r) => r.status !== "ok" && r.spent > 0);

  const tierRows = TIERS.map((t) => {
    const spent = mix.spendCents[t];
    const budget = catRows.filter((r) => r.cat.defaultTier === t).reduce((a, r) => a + r.budget, 0);
    return { tier: t, spent, budget, status: budgetStatus(spent, budget) };
  });

  /** Tier trend: per-bucket share of the selected tier vs its target. */
  const tierTrendData = useMemo(() => {
    const shares = tierShareByBucket(tierBuckets, tierTab);
    return period.buckets.map((b, i) => ({ label: b.label, share: shares[i] }));
  }, [tierBuckets, period.buckets, tierTab]);

  /** Category trend: per-bucket spend vs an even per-bucket budget line. */
  const activeChartCat = chartCat ?? catRows[0]?.cat.id ?? null;
  const catTrend = useMemo(() => {
    if (activeChartCat === null) return { data: [], perBucketBudget: 0 };
    const cents = categorySpendByBucket(rows, period.buckets, activeChartCat);
    const budget = periodBudget(activeChartCat);
    const perBucketBudget = period.buckets.length > 0 ? budget / period.buckets.length : 0;
    return {
      data: period.buckets.map((b, i) => ({ label: b.label, dollars: cents[i] / 100 })),
      perBucketBudget: perBucketBudget / 100,
    };
  }, [rows, period.buckets, activeChartCat, periodBudget]);

  const expandedRows = useMemo(() => {
    if (expandedCat !== null) return rows.filter((r) => r.categoryId === expandedCat && r.amountCents < 0);
    if (expandedTier !== null)
      return rows.filter(
        (r) => r.amountCents < 0 && effectiveTier(r.tierOverride, r.categoryDefaultTier) === expandedTier,
      );
    return [];
  }, [rows, expandedCat, expandedTier]);

  if (loaded && ledgerEmpty) {
    return (
      <div className="flex min-h-[64vh] items-center justify-center">
        <div className="max-w-[430px] text-center">
          <div className="mb-4 font-courier text-[11px] tracking-[0.2em] text-ink-mute">— PAGE 1 · NO ENTRIES —</div>
          <div className="mb-2.5 text-[21px] font-semibold">The ledger is empty</div>
          <div className="mb-6 text-[13.5px] italic leading-[1.7] text-ink-mute">
            Moneta reads bank statements you export as CSV. Nothing connects to your bank — every entry passes your
            review first.
          </div>
          <button
            onClick={() => navigate("upload")}
            className="cursor-pointer border-0 bg-ink px-5 py-[11px] font-courier text-[12.5px] font-bold text-paper hover:bg-accent"
          >
            Upload your first statement
          </button>
        </div>
      </div>
    );
  }

  const mixW1 = mix.sharePct.need;
  const mixW2 = mix.sharePct.comfortable;
  const tick1 = targets.need;
  const tick2 = targets.need + targets.comfortable;

  const breakdownRow = (
    key: string | number,
    onClick: () => void,
    expanded: boolean,
    dot: React.ReactNode,
    name: string,
    spent: number,
    budget: number,
    status: keyof typeof STATUS,
  ) => {
    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : spent > 0 ? 100 : 0;
    return (
      <div
        key={key}
        onClick={onClick}
        title={`Show ${name} transactions`}
        className={`grid cursor-pointer grid-cols-[14px_120px_1fr_150px] items-center gap-2.5 border-b border-[rgba(74,108,88,0.22)] px-1 py-1.5 hover:bg-ink/[0.04] ${expanded ? "bg-ink/[0.04]" : ""}`}
      >
        <span className="font-mono text-[10px] text-ink-faint">{expanded ? "▾" : "▸"}</span>
        <div className="flex items-center gap-[7px]">
          {dot}
          <span className="text-[12.5px]">{name}</span>
        </div>
        <div className="relative h-3">
          <div className="absolute inset-x-0 top-[3px] h-[6px] bg-ink/[0.07]">
            <div className="h-full" style={{ width: `${pct}%`, background: STATUS[status] }} />
          </div>
          <div className="absolute left-[80%] top-0 h-3 w-px bg-ink/40" />
          <div className="absolute inset-x-0 top-[9px] h-px bg-ink/35" />
        </div>
        <div className="text-right font-mono text-[11px] text-ink-mute">
          <span style={{ color: STATUS[status] }}>{formatCents(spent)}</span> / {formatCents(budget)}
        </div>
      </div>
    );
  };

  return (
    <div>
      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {/* Total line */}
      <div className="mb-3.5 flex items-baseline gap-3.5">
        <span className="font-mono text-[34px] font-semibold tracking-[-0.01em]">{formatCents(totalSpent)}</span>
        <span className="text-[14px] italic text-ink-mute">spent of</span>
        <span className="font-mono text-[16px]">{formatCents(totalBudget)}</span>
        <span className="text-[12.5px] italic text-ink-mute">{period.sub}</span>
        <span className="ml-auto font-mono text-[13px]" style={{ color: STATUS[totalStatus] }}>
          {totalBudget > 0 ? `${Math.round(totalPct)}% of budget` : "no budgets set"}
        </span>
      </div>
      <div className="relative mb-1 h-[22px]">
        <div className="absolute inset-x-0 top-2 h-[7px] bg-ink/[0.08]">
          <div className="h-full" style={{ width: `${Math.min(totalPct, 100)}%`, background: STATUS[totalStatus] }} />
        </div>
        <div className="absolute left-[80%] top-1 h-[15px] w-px bg-ink/45" />
        <div className="absolute inset-x-0 top-[15px] h-px bg-ink" />
        {period.elapsedFraction > 0 && period.elapsedFraction < 1 && (
          <>
            <div className="absolute top-[2px] h-[19px] w-px bg-accent" style={{ left: `${period.elapsedFraction * 100}%` }} />
            <div
              className="absolute -top-[11px] -translate-x-1/2 whitespace-nowrap font-courier text-[9.5px] text-accent"
              style={{ left: `${period.elapsedFraction * 100}%` }}
            >
              {period.sub.startsWith("day") ? `${period.sub.split(" ")[1]} of ${period.buckets.length} pace` : "pace"}
            </div>
          </>
        )}
      </div>
      <div className="mb-4 flex justify-between font-mono text-[9.5px] text-ink-faint">
        <span>0</span>
        <span className="ml-auto mr-[16.5%]">80%</span>
        <span>100%</span>
      </div>

      {/* View tabs */}
      <div className="mb-5 flex items-center gap-[2px] border-b border-rule">
        {(["mix", "breakdown"] as const).map((v) => (
          <span
            key={v}
            onClick={() => setView(v)}
            className={`-mb-px cursor-pointer border-b-2 px-3.5 py-1.5 font-courier text-[11.5px] tracking-[0.06em] hover:text-ink ${
              view === v ? "border-accent font-bold text-ink" : "border-transparent text-ink-mute"
            }`}
          >
            {v === "mix" ? "MIX" : "BREAKDOWN"}
          </span>
        ))}
      </div>

      {view === "mix" && (
        <>
          {/* Tier mix (signature) */}
          <div className="mb-9 pt-0.5">
            <div className="mb-4 flex items-baseline justify-between">
              <div className={label}>TIER MIX — SPEND VS TARGET</div>
              <div
                onClick={() => navigate("budgets")}
                className="cursor-pointer font-courier text-[10.5px] text-accent underline hover:text-ink"
              >
                edit targets
              </div>
            </div>
            <div className="grid grid-cols-3">
              {TIERS.map((t, i) => {
                const actual = mix.sharePct[t];
                const delta = Math.round((actual - targets[t]) * 10) / 10;
                const overLuxury = t === "luxury" && delta > 0;
                const deltaColor = delta === 0 || totalSpent === 0 ? "#65705F" : overLuxury || (t === "need" && delta < -10) ? "#B3362C" : "#41684A";
                return (
                  <div key={t} className={i > 0 ? "border-l border-rule pl-[22px] pr-[22px] pb-1.5 pt-0.5" : "pr-[22px] pb-1.5 pt-0.5"}>
                    <div className="mb-2 flex items-center gap-2">
                      <TierDot tier={t} />
                      <span className="font-courier text-[11.5px] font-bold tracking-[0.1em]">{TIER_LABELS[t].toUpperCase()}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[26px] font-semibold">{actual}%</span>
                      <span className="text-[12px] italic text-ink-mute">target {targets[t]}%</span>
                      <span className="font-mono text-[12px]" style={{ color: deltaColor }}>
                        {delta > 0 ? `+${delta}` : delta}pt
                      </span>
                    </div>
                    <div className="mt-[3px] font-mono text-[11px] text-ink-mute">{formatCents(mix.spendCents[t])}</div>
                  </div>
                );
              })}
            </div>
            {/* Mix rule */}
            <div className="relative mt-3 h-[26px]">
              <div className="absolute inset-x-0 top-2 flex h-[9px]">
                <div style={{ width: `${mixW1}%`, background: TIER_FILL.need }} />
                <div style={{ width: `${mixW2}%`, background: TIER_FILL.comfortable }} />
                <div className="flex-1" style={{ background: TIER_FILL.luxury }} />
              </div>
              <div className="absolute top-1 h-[17px] w-px bg-ink" style={{ left: `${tick1}%` }} />
              <div className="absolute top-1 h-[17px] w-px bg-ink" style={{ left: `${tick2}%` }} />
              <div className="absolute top-[22px] -translate-x-1/2 whitespace-nowrap font-courier text-[9px] text-ink-faint" style={{ left: `${tick1}%` }}>
                target {targets.need}
              </div>
              <div className="absolute top-[22px] -translate-x-1/2 whitespace-nowrap font-courier text-[9px] text-ink-faint" style={{ left: `${tick2}%` }}>
                target {tick2}
              </div>
            </div>
            {mix.uncategorizedCount > 0 && (
              <div className="mt-4 text-[11.5px] italic text-ink-faint">
                Mix excludes {mix.uncategorizedCount} uncategorized {mix.uncategorizedCount === 1 ? "entry" : "entries"} ({formatCents(mix.uncategorizedCents)}).
              </div>
            )}
          </div>

          {/* Tier trend vs target */}
          <div className="mb-7 border-t border-rule pt-3.5">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="flex items-center gap-3.5">
                <div className={label}>TIER TREND VS TARGET</div>
                <div className="flex gap-[2px]">
                  {TIERS.map((t) => (
                    <span
                      key={t}
                      onClick={() => setTierTab(t)}
                      className={`flex cursor-pointer items-center gap-1.5 border-b-2 px-2 py-[3px] font-courier text-[10.5px] hover:text-ink ${
                        tierTab === t ? "border-accent font-bold text-ink" : "border-transparent text-ink-mute"
                      }`}
                    >
                      <span
                        className="h-[9px] w-[9px]"
                        style={{ background: TIER_FILL[t], border: t === "luxury" ? `1px solid ${LUXURY_STROKE}` : "none" }}
                      />
                      {TIER_LABELS[t]}
                    </span>
                  ))}
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-mute">
                <span className="w-3.5 border-t-2 border-dashed border-ink" />
                target {targets[tierTab]}%
              </span>
            </div>
            <ChartFrame>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={tierTrendData} margin={{ top: 12, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_STROKE} />
                  <XAxis dataKey="label" tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip
                    cursor={{ fill: "rgba(31,38,30,0.05)" }}
                    content={
                      <PaperTooltip
                        format={(payload, lbl) => (
                          <span>
                            {String(lbl)}: {payload[0]?.value ?? 0}% {TIER_LABELS[tierTab]}
                          </span>
                        )}
                      />
                    }
                  />
                  <ReferenceLine y={targets[tierTab]} stroke={INK} strokeWidth={2} strokeDasharray="6 4" />
                  <Bar
                    dataKey="share"
                    fill={TIER_FILL[tierTab]}
                    stroke={tierTab === "luxury" ? LUXURY_STROKE : "none"}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={40}
                  >
                    {period.buckets.length <= 16 && (
                      <LabelList dataKey="share" position="top" style={{ ...tickStyle, fill: "#65705F" }} formatter={(v) => (v == null ? "" : `${v}`)} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
            <div className="mt-1.5 font-courier text-[9.5px] text-ink-faint">
              {TIER_LABELS[tierTab]} share of categorized spend per {period.scope === "year" ? "month" : period.scope === "custom" ? "bucket" : "day"} · dashed line = target
            </div>
          </div>
        </>
      )}

      {view === "breakdown" && (
        <>
          <div className="mb-5">
            <div className="mb-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className={label}>SPENT VS PLANNED</div>
                <div className="flex gap-[2px]">
                  {(
                    [
                      ["category", "By category"],
                      ["tier", "By tier"],
                      ["alerts", `Alerts (${alerts.length})`],
                    ] as const
                  ).map(([k, lbl]) => (
                    <span
                      key={k}
                      onClick={() => setBreakdownTab(k)}
                      className={`cursor-pointer border-b-2 px-2 py-[3px] font-courier text-[10.5px] hover:text-ink ${
                        breakdownTab === k ? "border-accent font-bold text-ink" : "border-transparent text-ink-mute"
                      }`}
                    >
                      {lbl}
                    </span>
                  ))}
                </div>
              </div>
              <div onClick={() => navigate("budgets")} className="cursor-pointer font-courier text-[10.5px] text-accent underline hover:text-ink">
                edit budgets
              </div>
            </div>

            {breakdownTab === "category" &&
              catRows.map((r) =>
                breakdownRow(
                  r.cat.id,
                  () => {
                    setExpandedTier(null);
                    setExpandedCat((c) => (c === r.cat.id ? null : r.cat.id));
                  },
                  expandedCat === r.cat.id,
                  <TierDot tier={r.cat.defaultTier} size={9} />,
                  r.cat.name,
                  r.spent,
                  r.budget,
                  r.status,
                ),
              )}
            {breakdownTab === "tier" &&
              tierRows.map((r) =>
                breakdownRow(
                  r.tier,
                  () => {
                    setExpandedCat(null);
                    setExpandedTier((t) => (t === r.tier ? null : r.tier));
                  },
                  expandedTier === r.tier,
                  <TierDot tier={r.tier} />,
                  TIER_LABELS[r.tier],
                  r.spent,
                  r.budget,
                  r.status,
                ),
              )}
            {breakdownTab === "alerts" &&
              (alerts.length === 0 ? (
                <div className="px-1 py-4 text-[12.5px] italic text-ink-faint">
                  Nothing needs attention — every category is under 80% of budget this period.
                </div>
              ) : (
                alerts.map((r) => (
                  <div key={r.cat.id} className="flex items-baseline gap-2.5 border-b border-dotted border-ink/20 px-1 py-[7px]">
                    <span className="font-mono text-[11px]" style={{ color: STATUS[r.status] }}>
                      {r.status === "over" ? "▲" : "●"}
                    </span>
                    <span className="text-[13px] font-medium">{r.cat.name}</span>
                    <span className="text-[12.5px] italic" style={{ color: STATUS[r.status] }}>
                      {r.status === "over"
                        ? `over budget by ${formatCents(r.spent - r.budget)}`
                        : `at ${Math.round((r.spent / r.budget) * 100)}% of budget`}
                    </span>
                    <span className="ml-auto font-mono text-[11.5px]" style={{ color: STATUS[r.status] }}>
                      {formatCents(r.spent)} / {formatCents(r.budget)}
                    </span>
                  </div>
                ))
              ))}
          </div>

          {(expandedCat !== null || expandedTier !== null) && (
            <div className="mb-9 border-l-[3px] border-accent bg-accent/[0.04] px-4 py-3.5">
              <div className="mb-2.5 flex items-baseline gap-3">
                <span className="font-courier text-[11px] font-bold tracking-[0.14em]">
                  {expandedCat !== null
                    ? categories.find((c) => c.id === expandedCat)?.name.toUpperCase()
                    : `${TIER_LABELS[expandedTier!].toUpperCase()} TIER`}
                </span>
                <span className="font-mono text-[11px] text-ink-mute">
                  {expandedRows.length} {expandedRows.length === 1 ? "entry" : "entries"}
                </span>
                <span
                  onClick={() => {
                    setExpandedCat(null);
                    setExpandedTier(null);
                  }}
                  className="ml-auto cursor-pointer font-courier text-[10.5px] text-ink-mute underline hover:text-ink"
                >
                  close
                </span>
              </div>
              {expandedRows.map((t) => (
                <div key={t.id} className="grid grid-cols-[92px_1fr_150px_110px] items-center gap-3 border-b border-[rgba(74,108,88,0.28)] py-[5px] hover:bg-ink/[0.035]">
                  <span className="font-mono text-[11px] text-ink-mute">{t.date}</span>
                  <span className="text-[12.5px]">{t.merchantNormalized}</span>
                  <span className="text-[11.5px] text-ink-mute">{expandedCat !== null ? t.accountName : (t.categoryName ?? "—")}</span>
                  <span className="text-right font-mono text-[12px]">{formatCents(t.amountCents)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Category trend vs budget */}
          <div className="mb-7 border-t border-rule pt-3.5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3.5">
                <div className={label}>CATEGORY TREND VS BUDGET</div>
                <select
                  className="cursor-pointer border-0 border-b border-ink/40 bg-transparent px-0.5 py-1 font-serif text-[12.5px] text-ink focus:border-accent"
                  value={activeChartCat ?? ""}
                  onChange={(e) => setChartCat(Number(e.target.value))}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-mute">
                <span className="w-3.5 border-t-2 border-dashed border-ink" />
                budget / {period.scope === "year" ? "month" : "day"}
              </span>
            </div>
            <ChartFrame>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={catTrend.data} margin={{ top: 12, right: 6, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_STROKE} />
                  <XAxis dataKey="label" tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip
                    cursor={{ fill: "rgba(31,38,30,0.05)" }}
                    content={
                      <PaperTooltip
                        format={(payload, lbl) => (
                          <span>
                            {String(lbl)}: ${Number(payload[0]?.value ?? 0).toFixed(2)}
                          </span>
                        )}
                      />
                    }
                  />
                  {catTrend.perBucketBudget > 0 && (
                    <ReferenceLine y={catTrend.perBucketBudget} stroke={INK} strokeWidth={2} strokeDasharray="6 4" />
                  )}
                  <Bar dataKey="dollars" radius={[2, 2, 0, 0]} maxBarSize={40}>
                    {catTrend.data.map((d, i) => (
                      <Cell
                        key={i}
                        fill={catTrend.perBucketBudget > 0 && d.dollars > catTrend.perBucketBudget ? STATUS.over : STATUS.ok}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>
        </>
      )}
    </div>
  );
}
