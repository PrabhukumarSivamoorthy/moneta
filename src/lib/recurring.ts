/**
 * Subscription detection. A merchant looks recurring when it has ≥3 charges
 * whose amounts sit within ±10% of their median and whose dates land on a
 * roughly monthly cadence (median gap 25–35 days). Pure function over
 * already-loaded rows.
 */
import { daysBetween } from "./period";

export interface RecurringInput {
  date: string;
  amountCents: number;
  merchantNormalized: string;
  categoryId: number | null;
  categoryName: string | null;
  accountName: string;
}

export interface RecurringCandidate {
  merchant: string;
  count: number;
  /** Median charge, positive cents. */
  medianCents: number;
  /** Most recent charge, positive cents (may differ from median). */
  lastCents: number;
  /** Percent change of the last charge vs the median, when ≥ 2%. */
  priceChangePct: number | null;
  lastDate: string;
  medianGapDays: number;
  /** Projected next charge date. */
  nextDate: string;
  cadence: "monthly";
  categoryId: number | null;
  categoryName: string | null;
  accountName: string;
}

const MIN_COUNT = 3;
const AMOUNT_TOLERANCE = 0.1;
const GAP_MIN = 25;
const GAP_MAX = 35;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function detectRecurring(rows: readonly RecurringInput[]): RecurringCandidate[] {
  const byMerchant = new Map<string, RecurringInput[]>();
  for (const r of rows) {
    if (r.amountCents >= 0) continue;
    const list = byMerchant.get(r.merchantNormalized) ?? [];
    list.push(r);
    byMerchant.set(r.merchantNormalized, list);
  }

  const out: RecurringCandidate[] = [];
  for (const [merchant, charges] of byMerchant) {
    if (charges.length < MIN_COUNT) continue;
    charges.sort((a, b) => a.date.localeCompare(b.date));

    const amounts = charges.map((c) => -c.amountCents).sort((a, b) => a - b);
    const medianCents = median(amounts);
    const similar = charges.filter(
      (c) => Math.abs(-c.amountCents - medianCents) <= medianCents * AMOUNT_TOLERANCE,
    );
    if (similar.length < MIN_COUNT) continue;

    const gaps: number[] = [];
    for (let i = 1; i < similar.length; i++) {
      gaps.push(daysBetween(similar[i - 1].date, similar[i].date) - 1);
    }
    const medianGap = median([...gaps].sort((a, b) => a - b));
    if (medianGap < GAP_MIN || medianGap > GAP_MAX) continue;

    const last = similar[similar.length - 1];
    const lastCents = -last.amountCents;
    const changePct = medianCents > 0 ? Math.round(((lastCents - medianCents) / medianCents) * 100) : 0;

    // Project the next date by adding the median gap to the last date.
    const [y, m, d] = last.date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + medianGap));
    const nextDate = next.toISOString().slice(0, 10);

    out.push({
      merchant,
      count: similar.length,
      medianCents,
      lastCents,
      priceChangePct: Math.abs(changePct) >= 2 ? changePct : null,
      lastDate: last.date,
      medianGapDays: medianGap,
      nextDate,
      cadence: "monthly",
      categoryId: last.categoryId,
      categoryName: last.categoryName,
      accountName: last.accountName,
    });
  }

  return out.sort((a, b) => b.medianCents - a.medianCents);
}
