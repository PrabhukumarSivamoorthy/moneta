/**
 * Bucketed chart aggregation. Pure functions over already-loaded transaction
 * rows and the resolved period's buckets (lib/period). "Spend" is money out,
 * as positive cents, matching lib/budget.
 */
import type { Bucket } from "./period";
import { effectiveTier, type Tier } from "./tier";
import type { SpendRow } from "./budget";

export interface DatedSpendRow extends SpendRow {
  date: string;
}

/** Index of the bucket containing the date, or -1. Buckets are ordered and
 * non-overlapping. */
export function bucketIndex(buckets: readonly Bucket[], date: string): number {
  for (let i = 0; i < buckets.length; i++) {
    if (date >= buckets[i].start && date <= buckets[i].end) return i;
  }
  return -1;
}

/** Total spend cents per bucket. */
export function spendByBucket(
  rows: readonly DatedSpendRow[],
  buckets: readonly Bucket[],
): number[] {
  const out = new Array<number>(buckets.length).fill(0);
  for (const r of rows) {
    if (r.amountCents >= 0) continue;
    const i = bucketIndex(buckets, r.date);
    if (i >= 0) out[i] += -r.amountCents;
  }
  return out;
}

/** Spend cents per bucket for one category. */
export function categorySpendByBucket(
  rows: readonly DatedSpendRow[],
  buckets: readonly Bucket[],
  categoryId: number,
): number[] {
  return spendByBucket(
    rows.filter((r) => r.categoryId === categoryId),
    buckets,
  );
}

export type TierCents = Record<Tier, number>;

/** Spend cents per tier per bucket (uncategorized excluded). */
export function tierSpendByBucket(
  rows: readonly DatedSpendRow[],
  buckets: readonly Bucket[],
): TierCents[] {
  const out: TierCents[] = buckets.map(() => ({ need: 0, comfortable: 0, luxury: 0 }));
  for (const r of rows) {
    if (r.amountCents >= 0) continue;
    const tier = effectiveTier(r.tierOverride, r.categoryDefaultTier);
    if (tier === null) continue;
    const i = bucketIndex(buckets, r.date);
    if (i >= 0) out[i][tier] += -r.amountCents;
  }
  return out;
}

/** Per-bucket share (0–100, one decimal) of one tier within categorized
 * spend. Buckets with no categorized spend give null (no bar, not 0). */
export function tierShareByBucket(perBucket: readonly TierCents[], tier: Tier): (number | null)[] {
  return perBucket.map((b) => {
    const total = b.need + b.comfortable + b.luxury;
    if (total === 0) return null;
    return Math.round((b[tier] / total) * 1000) / 10;
  });
}

/** Change in a tier's share between the first and last buckets that have
 * categorized spend. Null when fewer than two such buckets. */
export function tierShareChange(
  perBucket: readonly TierCents[],
  tier: Tier,
): { firstPct: number; lastPct: number; deltaPt: number } | null {
  const shares = tierShareByBucket(perBucket, tier);
  const nonEmpty = shares.filter((s): s is number => s !== null);
  if (nonEmpty.length < 2) return null;
  const firstPct = nonEmpty[0];
  const lastPct = nonEmpty[nonEmpty.length - 1];
  return { firstPct, lastPct, deltaPt: Math.round((lastPct - firstPct) * 10) / 10 };
}

/** Top merchants by spend within the rows (optionally one category). */
export function topMerchants(
  rows: readonly (DatedSpendRow & { merchantNormalized: string })[],
  categoryId: number | null,
  limit: number,
): { name: string; cents: number }[] {
  const byName = new Map<string, number>();
  for (const r of rows) {
    if (r.amountCents >= 0) continue;
    if (categoryId !== null && r.categoryId !== categoryId) continue;
    byName.set(r.merchantNormalized, (byName.get(r.merchantNormalized) ?? 0) + -r.amountCents);
  }
  return [...byName.entries()]
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .slice(0, limit);
}
