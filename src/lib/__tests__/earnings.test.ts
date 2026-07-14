import { describe, expect, it } from "vitest";
import { allocateEarnings, type IncomeSourceSpec } from "../earnings";

const source = (
  id: number,
  matcher: string,
  priority: number,
  matchType: IncomeSourceSpec["matchType"] = "contains",
): IncomeSourceSpec => ({ id, name: `Source ${id}`, matcher, matchType, priority });

describe("allocateEarnings", () => {
  it("attributes income to the first matching source in priority order", () => {
    const sources = [
      source(2, "acme", 20), // also matches payroll rows, but lower priority
      source(1, "payroll", 10),
    ];
    const alloc = allocateEarnings(sources, [
      { merchantNormalized: "Acme Corp Direct Dep Payroll", amountCents: 425000 },
      { merchantNormalized: "Acme Refund", amountCents: 5000 },
    ]);
    expect(alloc.bySource.get(1)).toBe(425000); // payroll wins by priority
    expect(alloc.bySource.get(2)).toBe(5000);
    expect(alloc.unplannedCents).toBe(0);
  });

  it("matches case-insensitively and routes unmatched income to unplanned", () => {
    const alloc = allocateEarnings([source(1, "PAYROLL", 10)], [
      { merchantNormalized: "acme payroll", amountCents: 100000 },
      { merchantNormalized: "Freelance Logo Work", amountCents: 30000 },
    ]);
    expect(alloc.bySource.get(1)).toBe(100000);
    expect(alloc.unplannedCents).toBe(30000);
    expect(alloc.unplannedCount).toBe(1);
  });

  it("keeps every source in the map even with zero earnings", () => {
    const alloc = allocateEarnings([source(1, "dividend", 10)], []);
    expect(alloc.bySource.get(1)).toBe(0);
  });

  it("never throws on an invalid regex — it just never matches", () => {
    const alloc = allocateEarnings([source(1, "(unclosed", 10, "regex")], [
      { merchantNormalized: "Acme Payroll", amountCents: 1000 },
    ]);
    expect(alloc.bySource.get(1)).toBe(0);
    expect(alloc.unplannedCents).toBe(1000);
  });
});
