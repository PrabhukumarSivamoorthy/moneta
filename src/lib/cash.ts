/**
 * Derived ("expected") cash balance for an account.
 *
 * Statements never carry an opening balance, so transactions alone can't
 * produce a true cash figure. Instead the hand-entered statement balance
 * acts as an ANCHOR: expected balance = anchor + every transaction dated
 * strictly after the anchor's as-of date (a statement balance already
 * includes that day's activity). With no anchor set, the sum of all the
 * account's entries is used — correct only when the full history has been
 * uploaded.
 *
 * Comparing the expected balance against the real account balance is how
 * the user reconciles: a mismatch means a statement gap or a missing entry.
 */

export interface CashRow {
  accountId: number;
  /** ISO YYYY-MM-DD. */
  date: string;
  amountCents: number;
}

export interface DerivedCash {
  /** Expected balance in cents: anchor + activity after the anchor date. */
  cents: number;
  /** How many transactions were counted after the anchor. */
  entriesCounted: number;
  /** Whether a hand-entered anchor (balance_as_of) exists. */
  anchored: boolean;
}

export function derivedCash(
  account: { id: number; balanceCents: number; balanceAsOf: string | null },
  rows: readonly CashRow[],
): DerivedCash {
  const anchored = account.balanceAsOf !== null;
  let cents = account.balanceCents;
  let entriesCounted = 0;
  for (const r of rows) {
    if (r.accountId !== account.id) continue;
    if (anchored && r.date <= account.balanceAsOf!) continue;
    cents += r.amountCents;
    entriesCounted++;
  }
  return { cents, entriesCounted, anchored };
}
