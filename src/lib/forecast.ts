/**
 * Cash-flow forecast: a simple monthly projection of liquid cash. Each
 * projected month takes planned income, subtracts recurring obligations,
 * and subtracts the average non-recurring spend of recent history. It is a
 * straight-line estimate, not a promise — the UI labels it as such.
 */

export interface ForecastInput {
  /** Liquid cash today, cents. */
  startingBalanceCents: number;
  /** Planned income per month, cents (the legacy single Earnings plan).
   * Falls back to observed average income when null. */
  plannedIncomeCents: number | null;
  /** Per-month planned income from the income-source plans ('YYYY-MM' →
   * cents). A month present here wins over plannedIncomeCents; absent
   * months use the fallback chain. */
  plannedIncomeCentsByMonth?: Record<string, number>;
  /** Observed average monthly income over the lookback, cents. */
  avgIncomeCents: number;
  /** Sum of detected recurring charges per month, cents. */
  recurringCents: number;
  /** Observed average monthly spend EXCLUDING recurring charges, cents. */
  avgOtherSpendCents: number;
  /** 'YYYY-MM' of the first projected month. */
  firstMonth: string;
  months: number;
}

export interface ForecastMonth {
  month: string;
  incomeCents: number;
  outCents: number;
  netCents: number;
  projectedBalanceCents: number;
}

function addMonths(month: string, count: number): string {
  const [y, m] = month.split("-").map(Number);
  const am = y * 12 + (m - 1) + count;
  return `${Math.floor(am / 12)}-${String((am % 12) + 1).padStart(2, "0")}`;
}

export function forecast(input: ForecastInput): ForecastMonth[] {
  const out = input.recurringCents + input.avgOtherSpendCents;
  const rows: ForecastMonth[] = [];
  let balance = input.startingBalanceCents;
  for (let i = 0; i < input.months; i++) {
    const month = addMonths(input.firstMonth, i);
    const income =
      input.plannedIncomeCentsByMonth?.[month] ??
      input.plannedIncomeCents ??
      input.avgIncomeCents;
    const net = income - out;
    balance += net;
    rows.push({
      month,
      incomeCents: income,
      outCents: out,
      netCents: net,
      projectedBalanceCents: balance,
    });
  }
  return rows;
}
