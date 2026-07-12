import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCents } from "../lib/money";
import { groupByPerson } from "../lib/lending";
import { listAccounts, type Account } from "../db/repo/accounts";
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const accts = await listAccounts();
      // Lent & borrowed is all-time; pull the system-category rows.
      const rows = await queryTransactions({ start: "0000-01-01", end: todayIso() });
      setLendingRows(rows.filter((r) => r.categoryIsSystem && r.categoryName === "Lent & borrowed"));
      setAccounts(accts);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const liquid = accounts.filter((a) => LIQUID_TYPES.has(a.type));
  const invested = accounts.filter((a) => INVESTED_TYPES.has(a.type));
  const cards = accounts.filter((a) => CARD_TYPES.has(a.type));

  const liquidTotal = liquid.reduce((a, x) => a + x.balanceCents, 0);
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

  const balanceNote = (a: Account) => (a.balanceAsOf ? `as of ${a.balanceAsOf}` : "not set");

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-baseline gap-3.5">
        <div className="text-[20px] font-semibold">Overview</div>
        <div className="font-mono text-[11px] text-ink-faint">as of {todayIso()}</div>
      </div>
      <div className="mb-6 text-[12px] italic text-ink-mute">
        Where everything stands. Balances are entered by hand in Settings → Accounts after each statement; brokerage
        figures are net contributions, not market value.
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
      {liquid.map((a) => (
        <div key={a.id} className={row}>
          <span className="text-[13.5px]">{a.name}</span>
          <span className="font-mono text-[11px] text-ink-faint">{balanceNote(a)}</span>
          <span className="text-right font-mono text-[13px]">{formatCents(a.balanceCents)}</span>
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

      <div className="mt-2 font-courier text-[10px] text-ink-faint">
        Balances are entered manually — update them in Settings → Accounts after each statement.
      </div>
    </div>
  );
}
