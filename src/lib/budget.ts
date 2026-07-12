/**
 * Budget/spend aggregation helpers. Pure functions over already-loaded rows —
 * effective-tier logic comes from lib/tier so it is never duplicated in SQL.
 *
 * "Spend" is money out: transactions with negative amounts, aggregated as
 * positive cents. Inflows are ignored by these aggregations.
 */
import { effectiveTier, type Tier } from "./tier";

export interface SpendRow {
  amountCents: number;
  categoryId: number | null;
  categoryDefaultTier: Tier | null;
  tierOverride: Tier | null;
}

/** Positive spend cents per categoryId. Inflows and uncategorized-in rows
 * with positive amounts are excluded; uncategorized spend maps to null. */
export function spendByCategory(rows: readonly SpendRow[]): Map<number | null, number> {
  const out = new Map<number | null, number>();
  for (const r of rows) {
    if (r.amountCents >= 0) continue;
    const key = r.categoryId;
    out.set(key, (out.get(key) ?? 0) + -r.amountCents);
  }
  return out;
}

export interface TierMix {
  /** Positive spend cents per tier (categorized rows only). */
  spendCents: Record<Tier, number>;
  /** Share of categorized spend per tier, 0–100, rounded to one decimal.
   * All zeros when there is no categorized spend. */
  sharePct: Record<Tier, number>;
  /** Uncategorized spend excluded from the mix — surfaced, never hidden. */
  uncategorizedCount: number;
  uncategorizedCents: number;
}

export function tierMixActual(rows: readonly SpendRow[]): TierMix {
  const spendCents: Record<Tier, number> = { need: 0, comfortable: 0, luxury: 0 };
  let uncategorizedCount = 0;
  let uncategorizedCents = 0;
  for (const r of rows) {
    if (r.amountCents >= 0) continue;
    const tier = effectiveTier(r.tierOverride, r.categoryDefaultTier);
    if (tier === null) {
      uncategorizedCount++;
      uncategorizedCents += -r.amountCents;
      continue;
    }
    spendCents[tier] += -r.amountCents;
  }
  const total = spendCents.need + spendCents.comfortable + spendCents.luxury;
  const share = (c: number) => (total === 0 ? 0 : Math.round((c / total) * 1000) / 10);
  return {
    spendCents,
    sharePct: {
      need: share(spendCents.need),
      comfortable: share(spendCents.comfortable),
      luxury: share(spendCents.luxury),
    },
    uncategorizedCount,
    uncategorizedCents,
  };
}

export type BudgetStatus = "ok" | "warn" | "over";

/** 80% / 100% thresholds. A zero budget with any spend is over. */
export function budgetStatus(spentCents: number, budgetCents: number): BudgetStatus {
  if (budgetCents <= 0) return spentCents > 0 ? "over" : "ok";
  const ratio = spentCents / budgetCents;
  if (ratio > 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "ok";
}
