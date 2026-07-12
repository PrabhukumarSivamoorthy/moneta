import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCents } from "../lib/money";
import { addDays } from "../lib/period";
import { detectRecurring, type RecurringCandidate } from "../lib/recurring";
import { getAllSettings, setSetting } from "../db/repo/settings";
import { queryTransactions } from "../db/repo/transactions";

const label = "font-courier text-[10px] tracking-[0.18em] text-ink-mute mb-1.5";
const GRID = "grid grid-cols-[1fr_120px_150px_90px_100px_110px_90px] items-center gap-3";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Detection looks at the trailing 8 months so ≥3 monthly charges can form. */
const LOOKBACK_DAYS = 8 * 31;

export default function Recurring() {
  const [candidates, setCandidates] = useState<RecurringCandidate[] | null>(null);
  const [stopped, setStopped] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const end = todayIso();
      const rows = await queryTransactions({ start: addDays(end, -LOOKBACK_DAYS), end });
      setCandidates(detectRecurring(rows));
      const settings = await getAllSettings();
      const raw = settings.recurring_stopped;
      setStopped(new Set(raw ? (JSON.parse(raw) as string[]) : []));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStoppedPersisted = async (next: Set<string>) => {
    setStopped(next);
    try {
      await setSetting("recurring_stopped", JSON.stringify([...next]));
    } catch (e) {
      setError(String(e));
    }
  };

  const tracked = useMemo(
    () => (candidates ?? []).filter((c) => !stopped.has(c.merchant)),
    [candidates, stopped],
  );
  const stoppedRows = useMemo(
    () => (candidates ?? []).filter((c) => stopped.has(c.merchant)),
    [candidates, stopped],
  );

  const monthlyTotal = tracked.reduce((a, c) => a + c.medianCents, 0);
  const nextUp = tracked.length > 0 ? tracked.reduce((a, c) => (c.nextDate < a.nextDate ? c : a)) : null;

  return (
    <div>
      <div className="mb-1 text-[20px] font-semibold">Recurring</div>
      <div className="mb-6 text-[12px] italic text-ink-mute">
        Detected from ≥3 charges with matching merchant and amount on a roughly monthly cadence. Stopping tracking only
        removes the item here — it never cancels the subscription itself.
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-8 grid max-w-[700px] grid-cols-3 gap-11">
        <div className="border-t border-rule pt-3">
          <div className={label}>PER MONTH</div>
          <div className="font-mono text-[24px] font-semibold">{formatCents(monthlyTotal)}</div>
          <div className="mt-[3px] text-[11px] italic text-ink-faint">≈ {formatCents(monthlyTotal * 12)} a year</div>
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>TRACKED</div>
          <div className="font-mono text-[24px] font-semibold">{tracked.length}</div>
          <div className="mt-[3px] text-[11px] italic text-ink-faint">recurring payments</div>
        </div>
        <div className="border-t border-rule pt-3">
          <div className={label}>NEXT DUE</div>
          {nextUp ? (
            <>
              <div className="mt-1.5 text-[14px] font-semibold">{nextUp.merchant}</div>
              <div className="mt-[3px] font-mono text-[11px] text-ink-faint">
                {nextUp.nextDate} · {formatCents(nextUp.medianCents)}
              </div>
            </>
          ) : (
            <div className="mt-1.5 text-[12px] italic text-ink-faint">nothing tracked</div>
          )}
        </div>
      </div>

      {/* Tracked table */}
      <div className="border-t-2 border-ink">
        <div className={`${GRID} border-b border-ink px-1 py-2 font-courier text-[10px] tracking-[0.14em] text-ink-mute`}>
          <span>MERCHANT</span>
          <span>CATEGORY</span>
          <span>ACCOUNT</span>
          <span>CADENCE</span>
          <span>NEXT</span>
          <span className="text-right">AMOUNT</span>
          <span />
        </div>
        {candidates === null ? (
          <div className="px-1 py-4 text-[13px] italic text-ink-mute">Loading…</div>
        ) : tracked.length === 0 ? (
          <div className="px-1 py-5 text-[12.5px] italic text-ink-faint">
            Nothing looks recurring yet — detection needs at least three matching monthly charges, so keep importing
            statements.
          </div>
        ) : (
          tracked.map((c) => (
            <div key={c.merchant} className={`${GRID} border-b border-[rgba(74,108,88,0.28)] px-1 py-2 hover:bg-ink/[0.035]`}>
              <div>
                <span className="text-[13px]">{c.merchant}</span>
                {c.priceChangePct !== null && (
                  <span className="ml-2 font-mono text-[10px] text-[#A06E12]" title={`Last charge ${formatCents(c.lastCents)} vs usual ${formatCents(c.medianCents)}`}>
                    {c.priceChangePct > 0 ? "+" : ""}
                    {c.priceChangePct}%
                  </span>
                )}
              </div>
              <span className="text-[11.5px] text-ink-mute">{c.categoryName ?? "—"}</span>
              <span className="text-[11.5px] text-ink-mute">{c.accountName}</span>
              <span className="font-courier text-[10px] tracking-[0.08em] text-ink-mute">MONTHLY</span>
              <span className="font-mono text-[11px] text-ink-mute">{c.nextDate}</span>
              <span className="text-right font-mono text-[12px]">{formatCents(c.medianCents)}</span>
              <span
                className="cursor-pointer text-right font-courier text-[10.5px] text-ink-mute underline hover:text-danger"
                onClick={() => void setStoppedPersisted(new Set([...stopped, c.merchant]))}
              >
                stop tracking
              </span>
            </div>
          ))
        )}
      </div>

      {/* Stopped */}
      {stoppedRows.length > 0 && (
        <>
          <div className="mb-2 mt-6 font-courier text-[10.5px] tracking-[0.2em] text-ink-faint">NO LONGER TRACKED</div>
          {stoppedRows.map((c) => (
            <div key={c.merchant} className={`${GRID} border-b border-[rgba(74,108,88,0.22)] px-1 py-2 opacity-55`}>
              <span className="text-[13px]">{c.merchant}</span>
              <span className="text-[11.5px] text-ink-mute">{c.categoryName ?? "—"}</span>
              <span className="text-[11.5px] text-ink-mute">{c.accountName}</span>
              <span className="font-courier text-[10px] text-ink-mute">MONTHLY</span>
              <span />
              <span className="text-right font-mono text-[12px]">{formatCents(c.medianCents)}</span>
              <span
                className="cursor-pointer text-right font-courier text-[10.5px] text-accent underline hover:text-ink"
                onClick={() => {
                  const next = new Set(stopped);
                  next.delete(c.merchant);
                  void setStoppedPersisted(next);
                }}
              >
                track again
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
