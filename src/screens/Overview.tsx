import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCents } from "../lib/money";
import { derivedCash } from "../lib/cash";
import { groupByPerson } from "../lib/lending";
import { forecast } from "../lib/forecast";
import { isSpend } from "../lib/budget";
import { detectRecurring } from "../lib/recurring";
import { listAccounts, type Account } from "../db/repo/accounts";
import { getAllSettings } from "../db/repo/settings";
import { queryTransactions, type TxRow } from "../db/repo/transactions";

const section =
  "font-courier text-[10.5px] tracking-[0.2em] text-ink-mute border-t border-rule pt-3 mb-2";
const row = "grid grid-cols-[1fr_150px_140px] items-baseline gap-3 border-b border-[rgba(74,108,88,0.28)] py-[7px]";
const subtotal = "grid grid-cols-[1fr_140px] gap-3 py-[7px] pb-6";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const LIQUID_TYPES = new Set(["checking", "savings"]);
const INVESTED_TYPES = new Set(["brokerage"]);
const CARD_TYPES = new Set(["credit card"]);

export default function Overview() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lendingRows, setLendingRows] = useState<TxRow[]>([]);
  const [allRows, setAllRows] = useState<TxRow[]>([]);
  const [incomePlan, setIncomePlan] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [accts, rows, settings] = await Promise.all([
        listAccounts(),
        // Lent & borrowed is all-time; the forecast reads recent history.
        queryTransactions({ start: "0000-01-01", end: todayIso() }),
        getAllSettings(),
      ]);
      setLendingRows(rows.filter((r) => r.categoryIsSystem && r.categoryName === "Lent & borrowed"));
      setAllRows(rows);
      setIncomePlan(settings.income_plan_cents ? Number(settings.income_plan_cents) : null);
      setAccounts(accts);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invested = accounts.filter((a) => INVESTED_TYPES.has(a.type));
  const cards = accounts.filter((a) => CARD_TYPES.has(a.type));

  /** Liquid balances are DERIVED: hand-entered anchor + transactions after
   * the anchor date (see lib/cash.ts). Brokerage and cards stay hand-entered. */
  const liquid = useMemo(
    () =>
      accounts
        .filter((a) => LIQUID_TYPES.has(a.type))
        .map((a) => ({ account: a, cash: derivedCash(a, allRows) })),
    [accounts, allRows],
  );

  const liquidTotal = liquid.reduce((a, x) => a + x.cash.cents, 0);
  const investedTotal = invested.reduce((a, x) => a + x.balanceCents, 0);
  const cardsOwed = cards.reduce((a, x) => a + x.balanceCents, 0);

  const lentNet = useMemo(
    () =>
      groupByPerson(
        lendingRows.map((r) => ({
          date: r.date,
          amountCents: r.amountCents,
          merchantNormalized: r.merchantNormalized,
          accountName: r.accountName,
        })),
      ).reduce((a, p) => a + p.balanceCents, 0),
    [lendingRows],
  );

  const netPosition = liquidTotal + investedTotal + lentNet - cardsOwed;

  /** 3-month straight-line projection from the trailing 3 full months. */
  const projection = useMemo(() => {
    const today = todayIso();
    const [y, m] = today.split("-").map(Number);
    const monthKey = (offset: number) => {
      const am = y * 12 + (m - 1) + offset;
      return `${Math.floor(am / 12)}-${String((am % 12) + 1).padStart(2, "0")}`;
    };
    const historyMonths = new Set([monthKey(-3), monthKey(-2), monthKey(-1)]);
    const history = allRows.filter((r) => historyMonths.has(r.date.slice(0, 7)));
    const avgIncome = Math.round(
      history.filter((r) => r.categoryIsSystem && r.categoryName === "Income" && r.amountCents > 0).reduce((a, r) => a + r.amountCents, 0) / 3,
    );
    const avgSpend = Math.round(history.filter(isSpend).reduce((a, r) => a + -r.amountCents, 0) / 3);
    const recurringCents = detectRecurring(allRows).reduce((a, c) => a + c.medianCents, 0);
    return forecast({
      startingBalanceCents: liquidTotal,
      plannedIncomeCents: incomePlan,
      avgIncomeCents: avgIncome,
      recurringCents,
      avgOtherSpendCents: Math.max(0, avgSpend - recurringCents),
      firstMonth: monthKey(1),
      months: 3,
    });
  }, [allRows, liquidTotal, incomePlan]);

  const balanceNote = (a: Account) => (a.balanceAsOf ? `as of ${a.balanceAsOf}` : "not set");

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-baseline gap-3.5">
        <div className="text-[20px] font-semibold">Overview</div>
        <div className="font-mono text-[11px] text-ink-faint">as of {todayIso()}</div>
      </div>
      <div className="mb-6 text-[12px] italic text-ink-mute">
        Where everything stands. Liquid cash = the anchor balance you enter in Settings → Accounts plus every
        transaction recorded after it; brokerage and card balances are entered by hand (brokerage figures are net
        contributions, not market value).
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {/* Net position */}
      <div className="mb-7 grid grid-cols-[1fr_220px] items-baseline gap-3 border-y-2 border-ink py-3.5">
        <span className="font-courier text-[11px] font-bold tracking-[0.2em]">NET POSITION</span>
        <span className="text-right font-mono text-[26px] font-semibold">{formatCents(netPosition)}</span>
      </div>

      {/* Liquid cash */}
      <div className={section}>LIQUID CASH</div>
      {liquid.map(({ account: a, cash }) => (
        <div key={a.id} className={row}>
          <span className="text-[13.5px]">{a.name}</span>
          <span className="font-mono text-[11px] text-ink-faint">
            {cash.anchored
              ? `anchor ${formatCents(a.balanceCents)} as of ${a.balanceAsOf}` +
                (cash.entriesCounted > 0
                  ? ` + ${cash.entriesCounted} entr${cash.entriesCounted === 1 ? "y" : "ies"}`
                  : "")
              : cash.entriesCounted > 0
                ? `from ${cash.entriesCounted} entries · no anchor set`
                : "not set"}
          </span>
          <span data-testid={`liquid-${a.id}`} className="text-right font-mono text-[13px]">
            {formatCents(cash.cents)}
          </span>
        </div>
      ))}
      {liquid.length === 0 && <div className="py-2 text-[12px] italic text-ink-faint">no checking or savings accounts yet</div>}
      <div className={subtotal}>
        <span className="text-right font-courier text-[10px] tracking-[0.14em] text-ink-mute">SUBTOTAL</span>
        <span className="text-right font-mono text-[13px] font-semibold">{formatCents(liquidTotal)}</span>
      </div>

      {/* Invested */}
      <div className={section}>INVESTED &amp; SAVINGS</div>
      {invested.map((a) => (
        <div key={a.id} className={row}>
          <span className="text-[13.5px]">{a.name}</span>
          <span className="text-[11px] italic text-ink-faint">net contributions · {balanceNote(a)}</span>
          <span className="text-right font-mono text-[13px]">{formatCents(a.balanceCents)}</span>
        </div>
      ))}
      {invested.length === 0 && <div className="py-2 text-[12px] italic text-ink-faint">no brokerage accounts yet</div>}
      <div className={subtotal}>
        <span className="text-right font-courier text-[10px] tracking-[0.14em] text-ink-mute">SUBTOTAL</span>
        <span className="text-right font-mono text-[13px] font-semibold">{formatCents(investedTotal)}</span>
      </div>

      {/* Lent & borrowed + cards */}
      <div className={section}>LENT &amp; BORROWED · CARDS OWED</div>
      <div className={row}>
        <span className="text-[13.5px]">Lent &amp; borrowed</span>
        <span className="text-[11px] italic text-ink-faint">
          {lentNet >= 0 ? "net owed to you" : "net you owe"}
        </span>
        <span className={`text-right font-mono text-[13px] ${lentNet < 0 ? "text-danger" : ""}`}>
          {formatCents(lentNet)}
        </span>
      </div>
      {cards.map((a) => (
        <div key={a.id} className={row}>
          <span className="text-[13.5px]">{a.name}</span>
          <span className="font-mono text-[11px] text-ink-faint">{balanceNote(a)}</span>
          <span className="text-right font-mono text-[13px] text-danger">{formatCents(a.balanceCents)}</span>
        </div>
      ))}
      <div className={subtotal}>
        <span className="text-right font-courier text-[10px] tracking-[0.14em] text-ink-mute">CARDS OWED</span>
        <span className="text-right font-mono text-[13px] font-semibold text-danger">{formatCents(cardsOwed)}</span>
      </div>

      {/* Cash-flow forecast */}
      <div className={section}>CASH-FLOW FORECAST — NEXT 3 MONTHS</div>
      <div className="mb-2 text-[11.5px] italic text-ink-faint">
        Straight-line estimate: {incomePlan ? "your income plan" : "average income"} minus recurring charges and the
        trailing-3-month average of other spending. Not a promise.
      </div>
      <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr] gap-3 border-b border-ink py-1.5 font-courier text-[10px] tracking-[0.14em] text-ink-mute">
        <span>MONTH</span>
        <span className="text-right">IN</span>
        <span className="text-right">OUT</span>
        <span className="text-right">NET</span>
        <span className="text-right">PROJECTED LIQUID</span>
      </div>
      {projection.map((p) => (
        <div key={p.month} className="grid grid-cols-[80px_1fr_1fr_1fr_1fr] gap-3 border-b border-[rgba(74,108,88,0.28)] py-[7px]">
          <span className="font-mono text-[11px] text-ink-mute">{p.month}</span>
          <span className="text-right font-mono text-[12px] text-[#41684A]">{formatCents(p.incomeCents)}</span>
          <span className="text-right font-mono text-[12px]">{formatCents(p.outCents)}</span>
          <span className={`text-right font-mono text-[12px] ${p.netCents < 0 ? "text-danger" : ""}`}>{formatCents(p.netCents)}</span>
          <span className={`text-right font-mono text-[12.5px] font-semibold ${p.projectedBalanceCents < 0 ? "text-danger" : ""}`}>
            {formatCents(p.projectedBalanceCents)}
          </span>
        </div>
      ))}

      <div className="mt-5 font-courier text-[10px] text-ink-faint">
        Re-enter a statement balance in Settings → Accounts any time to reconcile — it becomes the new anchor.
      </div>
    </div>
  );
}
