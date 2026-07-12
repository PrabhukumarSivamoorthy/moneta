import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCents, parseAmountToCents } from "../lib/money";
import { groupByPerson, type PersonLedger } from "../lib/lending";
import { normalizeMerchant } from "../lib/csv/normalize";
import { dedupHash } from "../lib/dedup";
import { listAccounts, type Account } from "../db/repo/accounts";
import { listCategories } from "../db/repo/categories";
import { insertManual, queryTransactions, type TxRow } from "../db/repo/transactions";

const label = "font-courier text-[10px] tracking-[0.18em] text-ink-mute mb-1.5";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function LentBorrowed() {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lendingCategoryId, setLendingCategoryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repayOpen, setRepayOpen] = useState<string | null>(null);
  const [repayAmt, setRepayAmt] = useState("");

  const load = useCallback(async () => {
    try {
      const [txs, accts, cats] = await Promise.all([
        queryTransactions({ start: "0000-01-01", end: todayIso() }),
        listAccounts(),
        listCategories(false, true),
      ]);
      setRows(txs.filter((r) => r.categoryIsSystem && r.categoryName === "Lent & borrowed"));
      setAccounts(accts);
      setLendingCategoryId(cats.find((c) => c.isSystem && c.name === "Lent & borrowed")?.id ?? null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const people: PersonLedger[] = useMemo(
    () =>
      groupByPerson(
        rows.map((r) => ({
          date: r.date,
          amountCents: r.amountCents,
          merchantNormalized: r.merchantNormalized,
          accountName: r.accountName,
        })),
      ),
    [rows],
  );

  const owedToYou = people.filter((p) => p.balanceCents > 0).reduce((a, p) => a + p.balanceCents, 0);
  const youOwe = people.filter((p) => p.balanceCents < 0).reduce((a, p) => a + -p.balanceCents, 0);
  const net = owedToYou - youOwe;

  const recordRepayment = async (person: PersonLedger) => {
    const cents = parseAmountToCents(repayAmt);
    if (!cents || cents <= 0 || lendingCategoryId === null || accounts.length === 0) return;
    // Direction: a repayment reduces the balance toward zero.
    const amountCents = person.balanceCents > 0 ? cents : -cents;
    const merchantRaw =
      person.balanceCents > 0 ? `Repayment from ${person.person}` : `Repayment to ${person.person}`;
    try {
      const merchantNormalized = normalizeMerchant(merchantRaw);
      const accountId = accounts[0].id;
      const date = todayIso();
      await insertManual({
        accountId,
        date,
        amountCents,
        merchantRaw,
        merchantNormalized,
        categoryId: lendingCategoryId,
        dedupHash: await dedupHash(accountId, date, amountCents, merchantNormalized),
      });
      setRepayOpen(null);
      setRepayAmt("");
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <div className="mb-1 text-[20px] font-semibold">Lent &amp; borrowed</div>
      <div className="mb-6 text-[12px] italic text-ink-mute">
        Zelle transfers, ATM withdrawals, and cash movements land here when you file them under "Lent &amp; borrowed"
        in the ledger. Not every transfer is a loan — a lunch split paid back over Zelle belongs in Dining. Balances
        here are all-time and never count as spending.
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      <div className="mb-8 grid grid-cols-3 gap-11">
        <div className="border-t border-rule pt-3">
          <div className={label}>OWED TO YOU</div>
          <div className="font-mono text-[24px] font-semibold">{formatCents(owedToYou)}</div>
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>YOU OWE</div>
          <div className="font-mono text-[24px] font-semibold text-danger">{formatCents(youOwe)}</div>
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>NET</div>
          <div className={`font-mono text-[24px] font-semibold ${net < 0 ? "text-danger" : ""}`}>{formatCents(net)}</div>
        </div>
      </div>

      {people.map((p) => {
        const settled = p.balanceCents === 0;
        return (
          <div key={p.person} className="mb-1 border-t-2 border-ink pb-6 pt-3">
            <div className="mb-2.5 flex items-baseline gap-3">
              <span className="text-[15px] font-semibold">{p.person}</span>
              <span className="text-[12px] italic" style={{ color: p.balanceCents > 0 ? "#2F5D45" : p.balanceCents < 0 ? "#B3362C" : "#65705F" }}>
                {p.balanceCents > 0 ? "owes you" : p.balanceCents < 0 ? "you owe" : "settled"}
              </span>
              <span className={`font-mono text-[15px] font-semibold ${p.balanceCents < 0 ? "text-danger" : ""}`}>
                {formatCents(Math.abs(p.balanceCents))}
              </span>
              {settled ? (
                <span className="-rotate-2 border-[1.5px] border-[#41684A] px-2 py-0.5 font-courier text-[10px] tracking-[0.14em] text-[#41684A]">
                  SETTLED ✓
                </span>
              ) : (
                <span
                  onClick={() => {
                    setRepayOpen((o) => (o === p.person ? null : p.person));
                    setRepayAmt("");
                  }}
                  className="ml-auto cursor-pointer font-courier text-[11px] text-accent underline hover:text-ink"
                >
                  {p.balanceCents > 0 ? "record repayment received" : "record repayment sent"}
                </span>
              )}
            </div>
            {repayOpen === p.person && (
              <div className="mb-3 flex items-center gap-3 border-[1.5px] border-dashed border-accent/50 bg-accent/[0.04] px-3.5 py-2.5">
                <span className="font-mono text-[11px] text-ink-faint">$</span>
                <input
                  className="w-20 border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] text-right font-mono text-[12.5px] text-ink focus:border-accent"
                  placeholder="0.00"
                  value={repayAmt}
                  onChange={(e) => setRepayAmt(e.target.value)}
                />
                <button
                  className="cursor-pointer border-0 bg-ink px-3 py-[7px] font-courier text-[11px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
                  disabled={!parseAmountToCents(repayAmt)}
                  onClick={() => void recordRepayment(p)}
                >
                  Record repayment
                </button>
                <span className="cursor-pointer font-courier text-[11px] text-ink-mute underline" onClick={() => setRepayOpen(null)}>
                  cancel
                </span>
              </div>
            )}
            {p.entries.map((e, i) => (
              <div key={i} className="grid grid-cols-[92px_1fr_120px_110px] items-center gap-3 border-b border-[rgba(74,108,88,0.28)] py-[5px] hover:bg-ink/[0.035]">
                <span className="font-mono text-[11px] text-ink-mute">{e.date}</span>
                <span className="text-[12.5px]">{e.merchantNormalized}</span>
                <span className="text-[10.5px] italic text-ink-faint">
                  {e.amountCents < 0 ? "you sent" : "you received"}
                </span>
                <span className={`text-right font-mono text-[12px] ${e.amountCents > 0 ? "text-accent" : ""}`}>
                  {formatCents(e.amountCents)}
                </span>
              </div>
            ))}
          </div>
        );
      })}
      {people.length === 0 && (
        <div className="border-t-2 border-ink py-5 text-[12.5px] italic text-ink-faint">
          Nothing tracked yet.
        </div>
      )}

      <div className="mt-1.5 font-courier text-[10px] text-ink-faint">
        Mark any transaction as "Lent &amp; borrowed" in the ledger to attach it to a person here.
      </div>
    </div>
  );
}
