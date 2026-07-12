/**
 * Spend tiers. Every categorized transaction has an effective tier:
 * its per-transaction override if set, otherwise its category's default.
 * Uncategorized transactions have no tier — tier aggregations must exclude
 * them but surface their count so the mix is never silently wrong.
 */

export type Tier = "need" | "comfortable" | "luxury";

export const TIERS: readonly Tier[] = ["need", "comfortable", "luxury"];

export const TIER_LABELS: Record<Tier, string> = {
  need: "Need",
  comfortable: "Comfortable",
  luxury: "Luxury",
};

/** COALESCE(tier_override, category default). Null when uncategorized. */
export function effectiveTier(
  tierOverride: Tier | null,
  categoryDefaultTier: Tier | null,
): Tier | null {
  return tierOverride ?? categoryDefaultTier;
}
