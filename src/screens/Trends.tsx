import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useResolvedPeriod } from "../state/period";
import { formatCents } from "../lib/money";
import { monthsInRange, type Bucket } from "../lib/period";
import { spendByCategory } from "../lib/budget";
import {
  categorySpendByBucket,
  tierShareChange,
  tierSpendByBucket,
  topMerchants,
} from "../lib/chart";
import { TIER_LABELS } from "../lib/tier";
import {
  AXIS_STROKE,
  ChartFrame,
  GRID_STROKE,
  LINE_SERIES,
  LUXURY_STROKE,
  PaperTooltip,
  TIER_FILL,
  tickStyle,
} from "../components/charts";
import { listCategories, type Category } from "../db/repo/categories";
import { queryTransactions, type TxRow } from "../db/repo/transactions";

const label = "font-courier text-[10.5px] tracking-[0.2em] text-ink-mute";

/** 12 monthly buckets ending with the month containing `end`. */
function trailingYearBuckets(end: string): Bucket[] {
  const endMonth = end.slice(0, 7);
  const [y, m] = endMonth.split("-").map(Number);
  const startY = m === 12 ? y : y - 1;
  const startM = m === 12 ? 1 : m + 1;
  const start = `${startY}-${String(startM).padStart(2, "0")}-01`;
  return monthsInRange(start, end).map((mo) => {
    const [yy, mm] = mo.month.split("-").map(Number);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return { start: mo.start, end: mo.end, label: `${MONTHS[mm - 1]}${mm === 1 ? ` ${String(yy).slice(2)}` : ""}` };
  });
}

export default function Trends() {
  const period = useResolvedPeriod();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [yearRows, setYearRows] = useState<TxRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [drillCat, setDrillCat] = useState<number | null>(null);

  const drillBuckets = useMemo(() => trailingYearBuckets(period.end), [period.end]);
  const drillStart = drillBuckets[0]?.start ?? period.start;

  const load = useCallback(async () => {
    try {
      const [txs, yearTxs, cats] = await Promise.all([
        queryTransactions({ start: period.start, end: period.end }),
        queryTransactions({ start: drillStart, end: period.end }),
        listCategories(),
      ]);
      setRows(txs);
      setYearRows(yearTxs);
      setCategories(cats);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [period.start, period.end, drillStart]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Top 5 categories by period spend — fixed order, colors follow the
   * entity: toggling a chip hides a line without repainting the others. */
  const topCats = useMemo(() => {
    const spend = spendByCategory(rows);
    return categories
      .map((c) => ({ cat: c, spent: spend.get(c.id) ?? 0 }))
      .filter((c) => c.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);
  }, [rows, categories]);

  const lineData = useMemo(() => {
    const series = topCats.map((tc) => categorySpendByBucket(rows, period.buckets, tc.cat.id));
    return period.buckets.map((b, i) => {
      const point: Record<string, number | string> = { label: b.label };
      topCats.forEach((tc, s) => {
        point[`c${tc.cat.id}`] = series[s][i] / 100;
      });
      return point;
    });
  }, [rows, period.buckets, topCats]);

  const tierBuckets = useMemo(() => tierSpendByBucket(rows, period.buckets), [rows, period.buckets]);
  const stackData = useMemo(
    () =>
      period.buckets.map((b, i) => ({
        label: b.label,
        need: tierBuckets[i].need,
        comfortable: tierBuckets[i].comfortable,
        luxury: tierBuckets[i].luxury,
      })),
    [period.buckets, tierBuckets],
  );
  const luxuryChange = useMemo(() => tierShareChange(tierBuckets, "luxury"), [tierBuckets]);

  const activeDrillCat = drillCat ?? topCats[0]?.cat.id ?? categories[0]?.id ?? null;
  const drillData = useMemo(() => {
    if (activeDrillCat === null) return [];
    const cents = categorySpendByBucket(yearRows, drillBuckets, activeDrillCat);
    return drillBuckets.map((b, i) => ({ label: b.label, dollars: cents[i] / 100, cents: cents[i] }));
  }, [yearRows, drillBuckets, activeDrillCat]);
  const drillCurrent = drillData[drillData.length - 1]?.cents ?? 0;
  const drillPrev = drillData[drillData.length - 2]?.cents ?? 0;
  const drillMoM = drillPrev > 0 ? Math.round(((drillCurrent - drillPrev) / drillPrev) * 100) : null;
  const drillTop = useMemo(
    () => topMerchants(yearRows, activeDrillCat, 5),
    [yearRows, activeDrillCat],
  );
  const drillMax = Math.max(...drillTop.map((m) => m.cents), 1);

  return (
    <div>
      <div className="mb-5 flex items-baseline gap-3.5">
        <div className="text-[20px] font-semibold">Trends</div>
        <div className="text-[12px] italic text-ink-mute">{period.label.toLowerCase()} · {period.sub}</div>
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {/* Spend by category — multiline with toggleable legend chips */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <div className={`${label} mr-1.5`}>SPEND BY CATEGORY</div>
        {topCats.map((tc, i) => {
          const hidden = hiddenSeries.has(tc.cat.id);
          const s = LINE_SERIES[i];
          return (
            <div
              key={tc.cat.id}
              onClick={() =>
                setHiddenSeries((set) => {
                  const next = new Set(set);
                  if (next.has(tc.cat.id)) next.delete(tc.cat.id);
                  else next.add(tc.cat.id);
                  return next;
                })
              }
              className={`flex cursor-pointer items-center gap-1.5 border px-2.5 py-[3px] text-[12px] hover:border-ink/50 ${
                hidden ? "border-ink/15 text-ink-faint" : "border-ink/30 text-ink"
              }`}
            >
              <svg width="14" height="4">
                <line x1="0" y1="2" x2="14" y2="2" stroke={hidden ? "#8B9384" : s.stroke} strokeWidth="2" strokeDasharray={s.dash} />
              </svg>
              {tc.cat.name}
            </div>
          );
        })}
        {topCats.length === 0 && <span className="text-[12px] italic text-ink-faint">no spend in this period</span>}
      </div>
      <div className="mb-9">
        <ChartFrame>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={lineData} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip
                content={
                  <PaperTooltip
                    format={(payload, lbl) => (
                      <div>
                        <div className="mb-0.5 font-courier text-[10px] text-ink-mute">{String(lbl)}</div>
                        {payload.map((p) => {
                          const cat = topCats.find((tc) => `c${tc.cat.id}` === p.dataKey);
                          return (
                            <div key={String(p.dataKey)}>
                              {cat?.cat.name}: ${Number(p.value ?? 0).toFixed(2)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  />
                }
              />
              {topCats.map((tc, i) => {
                const s = LINE_SERIES[i];
                return (
                  <Line
                    key={tc.cat.id}
                    dataKey={`c${tc.cat.id}`}
                    hide={hiddenSeries.has(tc.cat.id)}
                    stroke={s.stroke}
                    strokeWidth={1.6}
                    strokeDasharray={s.dash}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      {/* Tier composition — 100% stacked area */}
      <div className="mb-3.5 flex items-baseline gap-3.5">
        <div className={label}>TIER COMPOSITION — SHARE OF SPEND</div>
        {luxuryChange && (
          <div
            className="ml-auto text-[12px] italic"
            style={{ color: luxuryChange.deltaPt > 2 ? "#B3362C" : "#65705F" }}
          >
            Luxury share {luxuryChange.deltaPt >= 0 ? "+" : ""}
            {luxuryChange.deltaPt}pt across the period ({luxuryChange.firstPct}% → {luxuryChange.lastPct}%)
          </div>
        )}
      </div>
      <div className="mb-2.5">
        <ChartFrame>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={stackData} stackOffset="expand" margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
              <Tooltip
                content={
                  <PaperTooltip
                    format={(payload, lbl) => {
                      const total = payload.reduce((a, p) => a + Number(p.value ?? 0), 0);
                      return (
                        <div>
                          <div className="mb-0.5 font-courier text-[10px] text-ink-mute">{String(lbl)}</div>
                          {payload.map((p) => (
                            <div key={String(p.dataKey)}>
                              {TIER_LABELS[p.dataKey as keyof typeof TIER_LABELS]}:{" "}
                              {total > 0 ? Math.round((Number(p.value ?? 0) / total) * 100) : 0}% ·{" "}
                              {formatCents(Number(p.value ?? 0))}
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                }
              />
              <Area dataKey="need" stackId="mix" fill={TIER_FILL.need} stroke="none" fillOpacity={1} />
              <Area dataKey="comfortable" stackId="mix" fill={TIER_FILL.comfortable} stroke="none" fillOpacity={1} />
              <Area dataKey="luxury" stackId="mix" fill={TIER_FILL.luxury} stroke={LUXURY_STROKE} fillOpacity={1} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>
      <div className="mb-9 flex gap-4 text-[11.5px] text-ink-mute">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: TIER_FILL.need }} /> Need
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: TIER_FILL.comfortable }} /> Comfortable
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border" style={{ background: TIER_FILL.luxury, borderColor: LUXURY_STROKE }} /> Luxury
        </span>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-11">
        {/* Drill-down */}
        <div className="border-t border-rule pt-3.5">
          <div className="mb-4 flex items-center gap-3">
            <div className={label}>DRILL-DOWN · LAST 12 MONTHS</div>
            <select
              className="cursor-pointer border-0 border-b border-ink/40 bg-transparent px-0.5 py-1 font-serif text-[12.5px] text-ink focus:border-accent"
              value={activeDrillCat ?? ""}
              onChange={(e) => setDrillCat(Number(e.target.value))}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="ml-auto flex items-baseline gap-2">
              <span className="font-mono text-[15px] font-semibold">{formatCents(drillCurrent)}</span>
              {drillMoM !== null && (
                <span className="font-mono text-[11.5px]" style={{ color: drillMoM > 0 ? "#B3362C" : "#41684A" }}>
                  {drillMoM > 0 ? "+" : ""}
                  {drillMoM}% MoM
                </span>
              )}
            </div>
          </div>
          <ChartFrame>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={drillData} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={tickStyle} stroke={AXIS_STROKE} tickLine={false} />
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
                <Bar dataKey="dollars" fill={TIER_FILL.need} radius={[2, 2, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>

          <div className={`${label} mb-2.5 mt-5`}>TOP MERCHANTS IN CATEGORY</div>
          <div className="flex flex-col gap-[7px]">
            {drillTop.map((m) => (
              <div key={m.name} className="flex items-center gap-3 border-b border-dotted border-ink/20 pb-1.5">
                <span className="w-[170px] flex-none text-[12.5px]">{m.name}</span>
                <div className="h-[5px] flex-1 bg-ink/[0.06]">
                  <div className="h-full bg-accent/55" style={{ width: `${(m.cents / drillMax) * 100}%` }} />
                </div>
                <span className="w-[68px] text-right font-mono text-[11px] text-ink-mute">{formatCents(m.cents)}</span>
              </div>
            ))}
            {drillTop.length === 0 && (
              <span className="text-[12px] italic text-ink-faint">no spend in this category yet</span>
            )}
          </div>
        </div>

        {/* Recurring (Phase 5) */}
        <div className="border-t border-rule pt-3.5">
          <div className={`${label} mb-2.5`}>RECURRING</div>
          <div className="border border-dashed border-rule px-4 py-6 text-center">
            <div className="font-courier text-[11px] tracking-[0.15em] text-accent">PHASE 5</div>
            <div className="mt-1.5 text-[12px] italic text-ink-mute">
              Subscription detection (≥3 charges, matching merchant, ~monthly cadence) arrives in phase 5.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
