/**
 * Planned earnings: attribute income transactions to user-defined income
 * sources (Salary, Freelance, …) by merchant pattern, so each source's
 * actual earnings can be compared against its monthly plan.
 *
 * Matching reuses the rules-engine semantics (lib/rules.ts): first match in
 * priority order wins, case-insensitive, an invalid regex never matches.
 * Income that matches no source is "unplanned" — surfaced, never hidden.
 */
import { ruleMatches, type MatchType } from "./rules";

export interface IncomeSourceSpec {
  id: number;
  name: string;
  matcher: string;
  matchType: MatchType;
  priority: number;
}

export interface IncomeRowSpec {
  merchantNormalized: string;
  amountCents: number;
}

export interface EarningsAllocation {
  /** Earned cents per source id (every source present, 0 when unmatched). */
  bySource: Map<number, number>;
  unplannedCents: number;
  unplannedCount: number;
}

export function allocateEarnings(
  sources: readonly IncomeSourceSpec[],
  incomeRows: readonly IncomeRowSpec[],
): EarningsAllocation {
  const ordered = [...sources].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const bySource = new Map<number, number>(sources.map((s) => [s.id, 0]));
  let unplannedCents = 0;
  let unplannedCount = 0;
  for (const row of incomeRows) {
    const hit = ordered.find((s) => ruleMatches(s, row.merchantNormalized));
    if (hit) {
      bySource.set(hit.id, (bySource.get(hit.id) ?? 0) + row.amountCents);
    } else {
      unplannedCents += row.amountCents;
      unplannedCount++;
    }
  }
  return { bySource, unplannedCents, unplannedCount };
}
