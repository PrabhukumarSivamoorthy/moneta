/**
 * Loan amortization. Pure integer-cents math: the level payment comes from
 * the standard annuity formula; each row's interest is rounded to whole
 * cents and the final payment absorbs the rounding remainder.
 */

export interface LoanSpec {
  principalCents: number;
  /** Annual rate as a percentage, e.g. 7.0. */
  aprPct: number;
  years: number;
  paymentsPerYear: number;
  /** 'YYYY-MM' of the first payment. */
  firstDueMonth: string;
  /** Extra principal payments keyed by payment number (1-based). */
  extraByPaymentNo?: ReadonlyMap<number, number>;
}

export interface AmortRow {
  no: number;
  /** 'YYYY-MM' */
  month: string;
  beginningCents: number;
  interestCents: number;
  principalCents: number;
  extraCents: number;
  endingCents: number;
  cumulativeInterestCents: number;
}

export interface AmortSchedule {
  paymentCents: number;
  rows: AmortRow[];
  totalPaidCents: number;
  totalInterestCents: number;
  /** Interest as a share of principal, percent, one decimal. */
  interestSharePct: number;
}

/** Level payment for the loan, in cents. */
export function loanPaymentCents(spec: LoanSpec): number {
  const n = Math.round(spec.years * spec.paymentsPerYear);
  if (n <= 0 || spec.principalCents <= 0) return 0;
  const r = spec.aprPct / 100 / spec.paymentsPerYear;
  if (r === 0) return Math.ceil(spec.principalCents / n);
  const pow = Math.pow(1 + r, n);
  return Math.round((spec.principalCents * r * pow) / (pow - 1));
}

function addMonths(month: string, count: number): string {
  const [y, m] = month.split("-").map(Number);
  const am = y * 12 + (m - 1) + count;
  return `${Math.floor(am / 12)}-${String((am % 12) + 1).padStart(2, "0")}`;
}

export function amortize(spec: LoanSpec): AmortSchedule {
  const payment = loanPaymentCents(spec);
  const r = spec.aprPct / 100 / spec.paymentsPerYear;
  const monthsPerPayment = Math.max(1, Math.round(12 / spec.paymentsPerYear));
  const rows: AmortRow[] = [];

  let balance = spec.principalCents;
  let cumInterest = 0;
  let no = 0;
  const maxRows = Math.round(spec.years * spec.paymentsPerYear) + 1;

  while (balance > 0 && no < maxRows + 1000) {
    no++;
    const interest = Math.round(balance * r);
    let principal = payment - interest;
    if (principal <= 0) break; // payment doesn't cover interest — never loop
    let extra = spec.extraByPaymentNo?.get(no) ?? 0;
    if (principal >= balance) {
      principal = balance;
      extra = 0;
    } else if (extra > balance - principal) {
      extra = balance - principal;
    }
    const ending = balance - principal - extra;
    cumInterest += interest;
    rows.push({
      no,
      month: addMonths(spec.firstDueMonth, (no - 1) * monthsPerPayment),
      beginningCents: balance,
      interestCents: interest,
      principalCents: principal,
      extraCents: extra,
      endingCents: ending,
      cumulativeInterestCents: cumInterest,
    });
    balance = ending;
  }

  const totalPaid = rows.reduce((a, row) => a + row.interestCents + row.principalCents + row.extraCents, 0);
  return {
    paymentCents: payment,
    rows,
    totalPaidCents: totalPaid,
    totalInterestCents: cumInterest,
    interestSharePct:
      spec.principalCents > 0 ? Math.round((cumInterest / spec.principalCents) * 1000) / 10 : 0,
  };
}
