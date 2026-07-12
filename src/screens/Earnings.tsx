import { useCallback, useEffect, useMemo, useState } from "react";
import { useResolvedPeriod } from "../state/period";
import { centsToDecimalString, formatCents, parseAmountToCents } from "../lib/money";
import { prorateBudget } from "../lib/period";
import { classifyIncome, type IncomeType } from "../lib/income";
import { isSpend } from "../lib/budget";
import { detectRecurring } from "../lib/recurring";
import { normalizeMerchant } from "../lib/csv/normalize";
import { dedupHash } from "../lib/dedup";
import { listAccounts, type Account } from "../db/repo/accounts";
import { listCategories } from "../db/repo/categories";
import { getAllSettings, setSetting } from "../db/repo/settings";
import { insertManual, queryTransactions, type TxRow } from "../db/repo/transactions";

const label = "font-courier text-[10px] tracking-[0.18em] text-ink-mute mb-1.5";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

  const load = useCallback(async () => {
    try {
      const [txs, accts, cats, settings] = await Promise.all([
        queryTransactions({ start: period.start, end: period.end }),
        listAccounts(),
        listCategories(false, true),
        getAllSettings(),
      ]);
      setRows(txs);
      setAccounts(accts);
      setIncAcct((id) => id ?? accts[0]?.id ?? null);
      setIncomeCategoryId(cats.find((c) => c.isSystem && c.name === "Income")?.id ?? null);
      setPlanPerMonth(settings.income_plan_cents ? centsToDecimalString(Number(settings.income_plan_cents)) : "");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [period.start, period.end]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** Plan for the period: monthly plan prorated the same way budgets are. */
  const planCents = parseAmountToCents(planPerMonth || "0") ?? 0;
  const plannedForPeriod = prorateBudget(period.start, period.end, () => planCents);
  const planPct = plannedForPeriod > 0 ? (earned / plannedForPeriod) * 100 : 0;
  const planGap = earned - plannedForPeriod;
  const planColor = planPct >= 100 ? "#2F5D45" : planPct >= 70 ? "#9C6F1F" : "#B3362C";

  /** DTI: recurring monthly obligations vs the monthly plan. */
  const dti = useMemo(() => {
    if (planCents <= 0) return null;
    const recurringMonthly = detectRecurring(rows).reduce((a, c) => a + c.medianCents, 0);
    return Math.round((recurringMonthly / planCents) * 100);
  }, [rows, planCents]);

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
