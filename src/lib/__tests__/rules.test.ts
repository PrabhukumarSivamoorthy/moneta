import { describe, expect, it } from "vitest";
import { applyRules, ruleMatches, type RuleSpec } from "../rules";
import { effectiveTier } from "../tier";

const rule = (partial: Partial<RuleSpec>): RuleSpec => ({
  id: 1,
  matcher: "",
  matchType: "contains",
  categoryId: 10,
  priority: 100,
  ...partial,
});

describe("ruleMatches", () => {
  it("contains is case-insensitive", () => {
    expect(ruleMatches(rule({ matcher: "netflix" }), "Netflix.com")).toBe(true);
    expect(ruleMatches(rule({ matcher: "hulu" }), "Netflix.com")).toBe(false);
  });

  it("prefix anchors at the start", () => {
    expect(ruleMatches(rule({ matcher: "whole", matchType: "prefix" }), "Wholefds Seattle")).toBe(true);
    expect(ruleMatches(rule({ matcher: "seattle", matchType: "prefix" }), "Wholefds Seattle")).toBe(false);
  });

  it("regex matches case-insensitively and never throws on bad patterns", () => {
    expect(ruleMatches(rule({ matcher: "^shell( oil)?", matchType: "regex" }), "Shell Oil Seattle")).toBe(true);
    expect(ruleMatches(rule({ matcher: "([bad", matchType: "regex" }), "anything")).toBe(false);
  });

  it("an empty matcher never matches", () => {
    expect(ruleMatches(rule({ matcher: "" }), "anything")).toBe(false);
    expect(ruleMatches(rule({ matcher: "", matchType: "prefix" }), "anything")).toBe(false);
  });
});

describe("applyRules", () => {
  it("first match in priority order wins", () => {
    const rules = [
      rule({ id: 1, matcher: "coffee", categoryId: 5, priority: 200 }),
      rule({ id: 2, matcher: "blue bottle", categoryId: 7, priority: 100 }),
    ];
    expect(applyRules(rules, "Blue Bottle Coffee")).toBe(7);
  });

  it("ties break by id for determinism", () => {
    const rules = [
      rule({ id: 9, matcher: "shop", categoryId: 3, priority: 100 }),
      rule({ id: 2, matcher: "shop", categoryId: 4, priority: 100 }),
    ];
    expect(applyRules(rules, "The Shop")).toBe(4);
  });

  it("returns null when nothing matches", () => {
    expect(applyRules([rule({ matcher: "x" })], "Unmatched Merchant")).toBeNull();
  });
});

describe("effectiveTier", () => {
  it("override beats category default; falls back to default; null when uncategorized", () => {
    expect(effectiveTier("luxury", "need")).toBe("luxury");
    expect(effectiveTier(null, "comfortable")).toBe("comfortable");
    expect(effectiveTier(null, null)).toBeNull();
  });
});
