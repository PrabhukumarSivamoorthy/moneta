import { useCallback, useEffect, useMemo, useState } from "react";
import { useResolvedPeriod } from "../state/period";
import { formatCents } from "../lib/money";
import { queryTransactions, type TxRow } from "../db/repo/transactions";

const label = "font-courier text-[10px] tracking-[0.18em] text-ink-mute mb-1.5";

/** Group investing transfers by destination (the merchant's leading name). */
function destinationOf(merchantNormalized: string): string {
  return merchantNormalized.split(/\s+(?:Deposit|Withdrawal|Ach|Transfer)/i)[0].trim() || merchantNormalized;
}

export default function Transfers() {
  const period = useResolvedPeriod();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const txs = await queryTransactions({ start: period.start, end: period.end });
      setRows(
        txs.filter(
          (r) => r.categoryIsSystem && (r.categoryName === "Investing transfer" || r.categoryName === "Card payment"),
        ),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [period.start, period.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const investing = rows.filter((r) => r.categoryName === "Investing transfer");
  const cardPayments = rows.filter((r) => r.categoryName === "Card payment");

  const movedOut = investing.filter((r) => r.amountCents < 0).reduce((a, r) => a + -r.amountCents, 0);
  const movedBack = investing.filter((r) => r.amountCents > 0).reduce((a, r) => a + r.amountCents, 0);

  const destinations = useMemo(() => {
    const byDest = new Map<string, TxRow[]>();
    for (const r of investing) {
      const dest = destinationOf(r.merchantNormalized);
      const list = byDest.get(dest) ?? [];
      list.push(r);
      byDest.set(dest, list);
    }
    return [...byDest.entries()]
      .map(([name, entries]) => {
        const inCents = entries.filter((e) => e.amountCents < 0).reduce((a, e) => a + -e.amountCents, 0);
        const outCents = entries.filter((e) => e.amountCents > 0).reduce((a, e) => a + e.amountCents, 0);
        return { name, entries, inCents, outCents, netCents: inCents - outCents };
      })
      .sort((a, b) => b.netCents - a.netCents);
  }, [investing]);

  return (
    <div>
      <div className="mb-1 text-[20px] font-semibold">Transfers &amp; investing</div>
      <div className="mb-6 text-[12px] italic text-ink-mute">
        ACH moves between your accounts and brokerages, within {period.label.toLowerCase()}. Money you invest isn't
        spending — it never touches budgets or the tier mix.
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      <div className="mb-8 grid max-w-[560px] grid-cols-2 gap-11">
        <div className="border-t border-rule pt-3">
          <div className={label}>MOVED TO BROKERAGES</div>
          <div className="font-mono text-[24px] font-semibold">{formatCents(movedOut)}</div>
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>WITHDRAWN BACK</div>
          <div className="font-mono text-[24px] font-semibold text-[#41684A]">{formatCents(movedBack)}</div>
        </div>
      </div>

      {destinations.map((d) => (
        <div key={d.name} className="border-t-2 border-ink pb-6 pt-3">
          <div className="mb-2.5 flex items-baseline gap-3.5">
            <span className="text-[15px] font-semibold">{d.name}</span>
            <span className="text-[11.5px] italic text-ink-mute">
              in {formatCents(d.inCents)} · out {formatCents(d.outCents)}
            </span>
            <span className={`ml-auto font-mono text-[14px] font-semibold ${d.netCents < 0 ? "text-danger" : ""}`}>
              net {formatCents(d.netCents)}
            </span>
          </div>
          {d.entries.map((e) => (
            <div key={e.id} className="grid grid-cols-[92px_1fr_140px_110px_110px] items-center gap-3 border-b border-[rgba(74,108,88,0.28)] py-[5px] hover:bg-ink/[0.035]">
              <span className="font-mono text-[11px] text-ink-mute">{e.date}</span>
              <span className="text-[12.5px]">{e.merchantNormalized}</span>
              <span className="text-[11.5px] text-ink-mute">{e.accountName}</span>
              <span className="text-[10.5px] italic text-ink-faint">
                {e.amountCents < 0 ? "into the brokerage" : "back to checking"}
              </span>
              <span className={`text-right font-mono text-[12px] ${e.amountCents > 0 ? "text-accent" : ""}`}>
                {formatCents(e.amountCents)}
              </span>
            </div>
          ))}
        </div>
      ))}
      {destinations.length === 0 && (
        <div className="border-t-2 border-ink py-5 text-[12.5px] italic text-ink-faint">
          No investing transfers in this period — categorize any transfer as "Investing transfer" in the ledger to file
          it here.
        </div>
      )}

      {cardPayments.length > 0 && (
        <div className="border-t-2 border-ink pb-5 pt-3">
          <div className="mb-2.5 flex items-baseline gap-3.5">
            <span className="text-[15px] font-semibold">Card payments</span>
            <span className="text-[11.5px] italic text-ink-mute">
              both sides of a payment cancel out — never spending
            </span>
          </div>
          {cardPayments.map((e) => (
            <div key={e.id} className="grid grid-cols-[92px_1fr_140px_110px] items-center gap-3 border-b border-[rgba(74,108,88,0.28)] py-[5px] hover:bg-ink/[0.035]">
              <span className="font-mono text-[11px] text-ink-mute">{e.date}</span>
              <span className="text-[12.5px]">{e.merchantNormalized}</span>
              <span className="text-[11.5px] text-ink-mute">{e.accountName}</span>
              <span className="text-right font-mono text-[12px]">{formatCents(e.amountCents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
