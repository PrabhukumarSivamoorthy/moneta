import { describe, expect, it } from "vitest";
import { forecast } from "../forecast";
import { buildMoneyFlow } from "../flow";
import type { TxRow } from "../../db/repo/transactions";

describe("forecast", () => {
  it("projects balances month over month, crossing year boundaries", () => {
    const rows = forecast({
      startingBalanceCents: 1000000,
      plannedIncomeCents: 800000,
      avgIncomeCents: 0,
      recurringCents: 100000,
      avgOtherSpendCents: 500000,
      firstMonth: "2026-11",
      months: 3,
    });
    expect(rows.map((r) => r.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(rows[0]).toMatchObject({ incomeCents: 800000, outCents: 600000, netCents: 200000, projectedBalanceCents: 1200000 });
    expect(rows[2].projectedBalanceCents).toBe(1600000);
  });

  it("falls back to observed income when no plan is set", () => {
    const [m] = forecast({
      startingBalanceCents: 0,
      plannedIncomeCents: null,
      avgIncomeCents: 300000,
      recurringCents: 0,
      avgOtherSpendCents: 100000,
      firstMonth: "2026-08",
      months: 1,
    });
    expect(m.incomeCents).toBe(300000);
    expect(m.netCents).toBe(200000);
  });

  it("prefers per-month source plans, month by month, over the flat plan", () => {
    const rows = forecast({
      startingBalanceCents: 0,
      plannedIncomeCents: 400000,
      plannedIncomeCentsByMonth: { "2026-08": 500000, "2026-10": 450000 },
      avgIncomeCents: 300000,
      recurringCents: 0,
      avgOtherSpendCents: 0,
      firstMonth: "2026-08",
      months: 3,
    });
    // Aug from source plans, Sep falls back to the flat plan, Oct from plans.
    expect(rows.map((r) => r.incomeCents)).toEqual([500000, 400000, 450000]);
  });

  it("per-month plans fall through to observed income when no flat plan exists", () => {
    const rows = forecast({
      startingBalanceCents: 0,
      plannedIncomeCents: null,
      plannedIncomeCentsByMonth: { "2026-08": 500000 },
      avgIncomeCents: 300000,
      recurringCents: 0,
      avgOtherSpendCents: 0,
      firstMonth: "2026-08",
      months: 2,
    });
    expect(rows.map((r) => r.incomeCents)).toEqual([500000, 300000]);
  });
});

const tx = (partial: Partial<TxRow>): TxRow => ({
  id: 1,
  date: "2026-07-11",
  amountCents: -1000,
  merchantRaw: "X",
  merchantNormalized: "X",
  accountId: 1,
  accountName: "Chase",
  categoryId: 2,
  categoryName: "Groceries",
  categoryDefaultTier: "need",
  categoryIsSystem: false,
  categorizationSource: "rule",
  tierOverride: null,
  uploadId: 1,
  ...partial,
});

describe("buildMoneyFlow", () => {
  it("routes income through the hub to tiers, investing, and kept", () => {
    const flow = buildMoneyFlow([
      tx({ amountCents: 400000, categoryName: "Income", categoryIsSystem: true }),
      tx({ amountCents: -100000, categoryName: "Groceries", categoryDefaultTier: "need" }),
      tx({ amountCents: -50000, categoryName: "Dining", categoryDefaultTier: "comfortable" }),
      tx({ amountCents: -30000, categoryName: "Investing transfer", categoryIsSystem: true }),
      tx({ amountCents: -20000, categoryId: null, categoryName: null, categoryDefaultTier: null }),
    ])!;
    const names = flow.nodes.map((n) => n.name);
    expect(names).toEqual(["Income", "This period", "Need", "Comfortable", "Uncategorized", "Investing", "Kept"]);
    const kept = flow.links.find((l) => flow.nodes[l.target].name === "Kept")!;
    expect(kept.value).toBe(200000); // 400k − 100k − 50k − 30k − 20k
    // Every link touches the hub.
    const hub = names.indexOf("This period");
    expect(flow.links.every((l) => l.source === hub || l.target === hub)).toBe(true);
  });

  it("adds a From-savings source when spending exceeds income", () => {
    const flow = buildMoneyFlow([
      tx({ amountCents: 100000, categoryName: "Income", categoryIsSystem: true }),
      tx({ amountCents: -150000 }),
    ])!;
    const names = flow.nodes.map((n) => n.name);
    expect(names).toContain("From savings");
    const savings = flow.links.find((l) => flow.nodes[l.source].name === "From savings")!;
    expect(savings.value).toBe(50000);
  });

  it("ignores card payments and returns null with no activity", () => {
    expect(buildMoneyFlow([tx({ amountCents: -128440, categoryName: "Card payment", categoryIsSystem: true })])).toBeNull();
    expect(buildMoneyFlow([])).toBeNull();
  });
});
