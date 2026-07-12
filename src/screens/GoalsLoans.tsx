import { useCallback, useEffect, useMemo, useState } from "react";
import { centsToDecimalString, formatCents, parseAmountToCents } from "../lib/money";
import { amortize, type LoanSpec } from "../lib/loan";
import { addToGoal, createGoal, deleteGoal, listGoals, type Goal } from "../db/repo/goals";

const label = "font-courier text-[10.5px] tracking-[0.2em] text-ink-mute";
const monoInput =
  "bg-transparent border-0 border-b border-ink/40 px-0.5 py-1 font-mono text-[13px] text-ink text-right focus:border-accent";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthsUntil(targetMonth: string): number {
  const [ty, tm] = targetMonth.split("-").map(Number);
  const [cy, cm] = currentMonth().split("-").map(Number);
  return Math.max(0, ty * 12 + tm - (cy * 12 + cm));
}

function fmtMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export default function GoalsLoans() {
  const [tab, setTab] = useState<"goals" | "amortization">("goals");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [addingGoal, setAddingGoal] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalAmt, setGoalAmt] = useState("2000");
  const [goalMonth, setGoalMonth] = useState("");

  const [loanAmt, setLoanAmt] = useState("12000");
  const [loanApr, setLoanApr] = useState("7.0");
  const [loanYears, setLoanYears] = useState("3");
  const [loanPerYear, setLoanPerYear] = useState("12");
  const [loanFirstDue, setLoanFirstDue] = useState(currentMonth());
  const [extras, setExtras] = useState<Map<number, number>>(new Map());
  const [addingExtra, setAddingExtra] = useState(false);
  const [extraNo, setExtraNo] = useState("6");
  const [extraAmt, setExtraAmt] = useState("1000");

  const load = useCallback(async () => {
    try {
      setGoals(await listGoals());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const perMonthNeeded = goals.reduce((a, g) => {
    const months = monthsUntil(g.targetMonth);
    const remaining = Math.max(0, g.targetCents - g.savedCents);
    return a + (months > 0 ? Math.ceil(remaining / months) : remaining);
  }, 0);

  const loanSpec: LoanSpec | null = useMemo(() => {
    const principalCents = parseAmountToCents(loanAmt);
    const aprPct = Number(loanApr);
    const years = Number(loanYears);
    const paymentsPerYear = Number(loanPerYear);
    if (!principalCents || principalCents <= 0 || !(years > 0) || !(paymentsPerYear > 0) || !/^\d{4}-\d{2}$/.test(loanFirstDue) || !(aprPct >= 0)) {
      return null;
    }
    return { principalCents, aprPct, years, paymentsPerYear, firstDueMonth: loanFirstDue, extraByPaymentNo: extras };
  }, [loanAmt, loanApr, loanYears, loanPerYear, loanFirstDue, extras]);

  const schedule = useMemo(() => (loanSpec ? amortize(loanSpec) : null), [loanSpec]);
  const baseline = useMemo(
    () => (loanSpec && extras.size > 0 ? amortize({ ...loanSpec, extraByPaymentNo: undefined }) : null),
    [loanSpec, extras.size],
  );

  return (
    <div>
      <div className="mb-1 text-[20px] font-semibold">Goals &amp; loans</div>
      <div className="mb-4 text-[12px] italic text-ink-mute">Money you're setting aside on purpose.</div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      <div className="mb-5 flex gap-[2px] border-b border-rule">
        {(["goals", "amortization"] as const).map((t) => (
          <span
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px cursor-pointer border-b-2 px-3.5 py-1.5 font-courier text-[11.5px] tracking-[0.06em] hover:text-ink ${
              tab === t ? "border-accent font-bold text-ink" : "border-transparent text-ink-mute"
            }`}
          >
            {t === "goals" ? "SAVINGS GOALS" : "LOAN CALCULATOR"}
          </span>
        ))}
      </div>

      {tab === "goals" && (
        <>
          <div className="mb-3.5 flex items-baseline justify-between pt-0.5">
            <div className={label}>SAVINGS GOALS — {formatCents(perMonthNeeded)} /MO NEEDED</div>
            <button
              onClick={() => setAddingGoal(true)}
              className="cursor-pointer border-0 bg-ink px-3 py-[7px] font-courier text-[11px] font-bold text-paper hover:bg-accent"
            >
              Add goal
            </button>
          </div>

          {addingGoal && (
            <div className="mb-4 flex flex-wrap items-center gap-4 border-[1.5px] border-dashed border-accent/50 bg-accent/[0.04] px-4 py-3">
              <input
                className="w-[170px] border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-serif text-[13px] text-ink focus:border-accent"
                placeholder="Goal name"
                value={goalName}
                onChange={(e) => setGoalName(e.target.value)}
              />
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-[11px] text-ink-faint">$</span>
                <input className={`${monoInput} w-[70px]`} value={goalAmt} onChange={(e) => setGoalAmt(e.target.value)} />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] italic text-ink-mute">by</span>
                <input
                  type="month"
                  className="border-0 border-b border-ink/40 bg-transparent px-0.5 py-[5px] font-mono text-[12px] text-ink focus:border-accent"
                  value={goalMonth}
                  onChange={(e) => setGoalMonth(e.target.value)}
                />
              </div>
              <button
                className="cursor-pointer border-0 bg-ink px-3.5 py-2 font-courier text-[11px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
                disabled={!goalName.trim() || !parseAmountToCents(goalAmt) || !/^\d{4}-\d{2}$/.test(goalMonth)}
                onClick={async () => {
                  try {
                    await createGoal(goalName.trim(), parseAmountToCents(goalAmt)!, goalMonth);
                    setGoalName("");
                    setAddingGoal(false);
                    await load();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Add goal
              </button>
              <span className="cursor-pointer font-courier text-[11px] text-ink-mute underline" onClick={() => setAddingGoal(false)}>
                cancel
              </span>
            </div>
          )}

          <div className="mb-9">
            {goals.map((g) => {
              const months = monthsUntil(g.targetMonth);
              const remaining = Math.max(0, g.targetCents - g.savedCents);
              const perMonth = months > 0 ? Math.ceil(remaining / months) : remaining;
              const pct = g.targetCents > 0 ? Math.min((g.savedCents / g.targetCents) * 100, 100) : 0;
              const done = remaining === 0;
              return (
                <div key={g.id} className="border-b border-[rgba(74,108,88,0.28)] py-3">
                  <div className="mb-2 flex items-baseline gap-3">
                    <span className="text-[14px] font-semibold">{g.name}</span>
                    <span className="text-[11.5px] italic text-ink-mute">
                      by {fmtMonth(g.targetMonth)} · {months} month{months === 1 ? "" : "s"} left
                    </span>
                    <span className="ml-auto font-mono text-[12px]">
                      <span className="font-semibold">{formatCents(g.savedCents)}</span>{" "}
                      <span className="text-ink-faint">of {formatCents(g.targetCents)}</span>
                    </span>
                    <span className="font-mono text-[11px] text-ink-mute">{Math.round(pct)}%</span>
                  </div>
                  <div className="relative mb-2 h-3.5">
                    <div className="absolute inset-x-0 top-1 h-[7px] bg-ink/[0.07]">
                      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="absolute inset-x-0 top-[11px] h-px bg-ink/35" />
                  </div>
                  <div className="flex items-center gap-3.5">
                    {done ? (
                      <span className="-rotate-2 border-[1.5px] border-[#41684A] px-2 py-0.5 font-courier text-[10px] tracking-[0.14em] text-[#41684A]">
                        FUNDED ✓
                      </span>
                    ) : (
                      <span className="text-[12px] italic text-ink-mute">
                        set aside <span className="font-mono not-italic text-ink">{formatCents(perMonth)}</span> /mo to stay on pace
                      </span>
                    )}
                    {!done && (
                      <span
                        onClick={async () => {
                          try {
                            await addToGoal(g.id, Math.min(10000, remaining));
                            await load();
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                        className="ml-auto cursor-pointer font-courier text-[10.5px] text-accent underline hover:text-ink"
                      >
                        Record $100 set aside
                      </span>
                    )}
                    <span
                      onClick={async () => {
                        try {
                          await deleteGoal(g.id);
                          await load();
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                      className={`cursor-pointer font-courier text-[10.5px] text-ink-mute underline hover:text-danger ${done ? "ml-auto" : ""}`}
                    >
                      remove
                    </span>
                  </div>
                </div>
              );
            })}
            {goals.length === 0 && (
              <div className="py-4 text-[12.5px] italic text-ink-faint">No goals yet — add one to start setting money aside.</div>
            )}
          </div>
        </>
      )}

      {tab === "amortization" && schedule && (
        <>
          <div className="mb-5 grid max-w-[860px] grid-cols-2 gap-11">
            <div>
              <div className={`${label} mb-3`}>LOAN DATA</div>
              <div className="flex flex-col gap-2.5">
                <div className="grid grid-cols-[150px_1fr] items-center gap-2.5">
                  <span className="text-[12px] italic text-ink-mute">Loan amount</span>
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-[11px] text-ink-faint">$</span>
                    <input className={`${monoInput} w-[90px]`} value={loanAmt} onChange={(e) => setLoanAmt(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-[150px_1fr] items-center gap-2.5">
                  <span className="text-[12px] italic text-ink-mute">Annual interest rate</span>
                  <div className="flex items-baseline gap-1">
                    <input className={`${monoInput} w-[50px]`} value={loanApr} onChange={(e) => setLoanApr(e.target.value)} />
                    <span className="font-mono text-[11px] text-ink-faint">%</span>
                  </div>
                </div>
                <div className="grid grid-cols-[150px_1fr] items-center gap-2.5">
                  <span className="text-[12px] italic text-ink-mute">Term in years</span>
                  <input className={`${monoInput} w-[50px]`} value={loanYears} onChange={(e) => setLoanYears(e.target.value)} />
                </div>
                <div className="grid grid-cols-[150px_1fr] items-center gap-2.5">
                  <span className="text-[12px] italic text-ink-mute">Payments per year</span>
                  <input className={`${monoInput} w-[50px]`} value={loanPerYear} onChange={(e) => setLoanPerYear(e.target.value)} />
                </div>
                <div className="grid grid-cols-[150px_1fr] items-center gap-2.5">
                  <span className="text-[12px] italic text-ink-mute">First payment due</span>
                  <input
                    type="month"
                    className="w-[130px] border-0 border-b border-ink/40 bg-transparent px-0.5 py-1 font-mono text-[13px] text-ink focus:border-accent"
                    value={loanFirstDue}
                    onChange={(e) => setLoanFirstDue(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="self-start border-l-[3px] border-accent bg-accent/[0.04] px-5 py-4">
              <div className="mb-2 flex items-baseline gap-2.5">
                <span className="font-courier text-[10px] tracking-[0.16em] text-ink-mute">CALCULATED PAYMENT</span>
                <span className="font-mono text-[22px] font-semibold">{formatCents(schedule.paymentCents)}</span>
              </div>
              <div className="text-[12px] italic leading-[1.8] text-ink-mute">
                {schedule.rows.length} payments · total repaid{" "}
                <span className="font-mono not-italic text-ink">{formatCents(schedule.totalPaidCents)}</span> · interest{" "}
                <span className="font-mono not-italic text-danger">{formatCents(schedule.totalInterestCents)}</span>
                <br />
                That's{" "}
                <span className="font-mono not-italic" style={{ color: schedule.interestSharePct > 15 ? "#B3362C" : "#2F5D45" }}>
                  {schedule.interestSharePct}% of the principal in interest
                </span>
              </div>
            </div>
          </div>

          {/* Extra payments */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className={label}>EXTRA PAYMENTS</span>
            {[...extras.entries()].sort((a, b) => a[0] - b[0]).map(([no, cents]) => (
              <span key={no} className="flex items-center gap-2 border border-accent/50 bg-accent/5 px-2.5 py-[3px] font-mono text-[11px]">
                at #{no}: {formatCents(cents)}
                <span
                  onClick={() =>
                    setExtras((m) => {
                      const next = new Map(m);
                      next.delete(no);
                      return next;
                    })
                  }
                  className="cursor-pointer font-courier text-ink-mute hover:text-danger"
                >
                  ×
                </span>
              </span>
            ))}
            {addingExtra ? (
              <span className="flex items-baseline gap-2 border-[1.5px] border-dashed border-accent/50 px-2.5 py-[5px]">
                <span className="text-[11px] italic text-ink-mute">at payment</span>
                <input className={`${monoInput} w-9 text-[11.5px]`} value={extraNo} onChange={(e) => setExtraNo(e.target.value)} />
                <span className="text-[11px] italic text-ink-mute">pay extra $</span>
                <input className={`${monoInput} w-16 text-[11.5px]`} value={extraAmt} onChange={(e) => setExtraAmt(e.target.value)} />
                <button
                  className="cursor-pointer border-0 bg-ink px-2.5 py-1 font-courier text-[10.5px] font-bold text-paper hover:bg-accent"
                  onClick={() => {
                    const no = Number(extraNo);
                    const cents = parseAmountToCents(extraAmt);
                    if (no > 0 && cents && cents > 0) {
                      setExtras((m) => new Map(m).set(no, cents));
                      setAddingExtra(false);
                    }
                  }}
                >
                  Add
                </button>
                <span className="cursor-pointer font-courier text-[10.5px] text-ink-mute underline" onClick={() => setAddingExtra(false)}>
                  cancel
                </span>
              </span>
            ) : (
              <span onClick={() => setAddingExtra(true)} className="cursor-pointer font-courier text-[10.5px] text-accent underline hover:text-ink">
                + add extra payment
              </span>
            )}
          </div>
          {baseline && (
            <div className="mb-3.5 border-l-[3px] border-[#41684A] bg-[rgba(65,104,74,0.06)] px-3.5 py-2 text-[12.5px]">
              <span className="mr-2.5 font-courier text-[10px] tracking-[0.12em] text-[#41684A]">✓ SAVINGS</span>
              <span className="font-mono text-[11.5px]">
                {formatCents(baseline.totalInterestCents - schedule.totalInterestCents)} less interest ·{" "}
                {baseline.rows.length - schedule.rows.length} fewer payments
              </span>
            </div>
          )}

          {/* Schedule */}
          <div className="max-w-[1000px] border-t-2 border-ink">
            <div className="grid grid-cols-[44px_80px_1fr_105px_105px_90px_1fr_120px] gap-3 border-b border-ink px-1 py-2 font-courier text-[10px] tracking-[0.12em] text-ink-mute">
              <span>NO.</span>
              <span>MONTH</span>
              <span className="text-right">BEGINNING</span>
              <span className="text-right">INTEREST</span>
              <span className="text-right">PRINCIPAL</span>
              <span className="text-right">EXTRA</span>
              <span className="text-right">ENDING</span>
              <span className="text-right">CUM. INTEREST</span>
            </div>
            {schedule.rows.map((r) => (
              <div
                key={r.no}
                className={`grid grid-cols-[44px_80px_1fr_105px_105px_90px_1fr_120px] items-center gap-3 px-1 py-1 hover:bg-ink/[0.035] ${
                  r.no % 12 === 0 ? "border-b-2 border-ink/50" : "border-b border-[rgba(74,108,88,0.28)]"
                } ${r.extraCents > 0 ? "bg-[rgba(65,104,74,0.06)]" : ""}`}
              >
                <span className="font-mono text-[10.5px] text-ink-faint">{r.no}</span>
                <span className="font-mono text-[10.5px] text-ink-mute">{r.month}</span>
                <span className="text-right font-mono text-[11px]">{centsToDecimalString(r.beginningCents)}</span>
                <span className="text-right font-mono text-[11px] text-danger">{centsToDecimalString(r.interestCents)}</span>
                <span className="text-right font-mono text-[11px] text-accent">{centsToDecimalString(r.principalCents)}</span>
                <span className="text-right font-mono text-[11px] font-semibold text-[#41684A]">
                  {r.extraCents > 0 ? centsToDecimalString(r.extraCents) : ""}
                </span>
                <span className="text-right font-mono text-[11px]">{centsToDecimalString(r.endingCents)}</span>
                <span className="text-right font-mono text-[11px] text-ink-mute">{centsToDecimalString(r.cumulativeInterestCents)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 font-courier text-[10px] text-ink-faint">
            interest in red · principal in green · extra payments highlighted — a heavier rule closes each year of payments
          </div>
        </>
      )}
      {tab === "amortization" && !schedule && (
        <div className="py-5 text-[12.5px] italic text-ink-faint">Enter a valid loan amount, rate, term, and first-due month.</div>
      )}
    </div>
  );
}
