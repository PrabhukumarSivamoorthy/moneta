import { describe, expect, it } from "vitest";
import {
  budgetStatus,
  spendByCategory,
  tierMixActual,
  type SpendRow,
} from "../budget";

const row = (
  amountCents: number,
  categoryId: number | null,
  defaultTier: SpendRow["categoryDefaultTier"] = "need",
  tierOverride: SpendRow["tierOverride"] = null,
): SpendRow => ({ amountCents, categoryId, categoryDefaultTier: categoryId === null ? null : defaultTier, tierOverride });

describe("spendByCategory", () => {
  it("sums outflows as positive cents per category, ignoring inflows", () => {
    const m = spendByCategory([
      row(-1000, 1),
      row(-500, 1),
      row(-200, 2),
      row(425000, 3), // income ignored
    ]);
    expect(m.get(1)).toBe(1500);
    expect(m.get(2)).toBe(200);
    expect(m.has(3)).toBe(false);
  });

  it("keys uncategorized spend under null", () => {
    const m = spendByCategory([row(-750, null)]);
    expect(m.get(null)).toBe(750);
  });
});

describe("tierMixActual", () => {
  it("computes shares over categorized spend only and surfaces uncategorized", () => {
    const mix = tierMixActual([
      row(-5000, 1, "need"),
      row(-3000, 2, "comfortable"),
      row(-2000, 3, "luxury"),
      row(-999, null),
      row(10000, 4, "need"), // inflow ignored
    ]);
    expect(mix.spendCents).toEqual({ need: 5000, comfortable: 3000, luxury: 2000 });
    expect(mix.sharePct).toEqual({ need: 50, comfortable: 30, luxury: 20 });
    expect(mix.uncategorizedCount).toBe(1);
    expect(mix.uncategorizedCents).toBe(999);
  });

  it("respects tier overrides", () => {
    const mix = tierMixActual([row(-1000, 1, "need", "luxury")]);
    expect(mix.spendCents.luxury).toBe(1000);
    expect(mix.spendCents.need).toBe(0);
  });

  it("returns zero shares when there is no categorized spend", () => {
    const mix = tierMixActual([row(-1000, null)]);
    expect(mix.sharePct).toEqual({ need: 0, comfortable: 0, luxury: 0 });
  });
});

describe("budgetStatus", () => {
  it("applies 80%/100% thresholds", () => {
    expect(budgetStatus(7999, 10000)).toBe("ok");
    expect(budgetStatus(8000, 10000)).toBe("warn");
    expect(budgetStatus(10000, 10000)).toBe("warn");
    expect(budgetStatus(10001, 10000)).toBe("over");
  });

  it("treats any spend against a zero budget as over", () => {
    expect(budgetStatus(0, 0)).toBe("ok");
    expect(budgetStatus(1, 0)).toBe("over");
  });
});
