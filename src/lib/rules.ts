/**
 * Deterministic categorization rules engine. Rules are evaluated in
 * priority order (lowest number first); the first match wins. Matching is
 * case-insensitive against the normalized merchant string.
 */

export type MatchType = "contains" | "prefix" | "regex";

export interface RuleSpec {
  id: number;
  matcher: string;
  matchType: MatchType;
  categoryId: number;
  priority: number;
}

export function ruleMatches(rule: RuleSpec, merchantNormalized: string): boolean {
  const merchant = merchantNormalized.toLowerCase();
  const matcher = rule.matcher.toLowerCase();
  switch (rule.matchType) {
    case "contains":
      return matcher.length > 0 && merchant.includes(matcher);
    case "prefix":
      return matcher.length > 0 && merchant.startsWith(matcher);
    case "regex":
      try {
        return new RegExp(rule.matcher, "i").test(merchantNormalized);
      } catch {
        return false; // an invalid regex never matches, never throws
      }
  }
}

/** The categoryId of the first matching rule in priority order, or null. */
export function applyRules(
  rules: readonly RuleSpec[],
  merchantNormalized: string,
): number | null {
  const ordered = [...rules].sort(
    (a, b) => a.priority - b.priority || a.id - b.id,
  );
  for (const rule of ordered) {
    if (ruleMatches(rule, merchantNormalized)) return rule.categoryId;
  }
  return null;
}
