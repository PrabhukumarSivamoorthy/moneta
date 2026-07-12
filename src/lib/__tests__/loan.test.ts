import { describe, expect, it } from "vitest";
import { amortize, loanPaymentCents, type LoanSpec } from "../loan";

const BASE: LoanSpec = {
  principalCents: 1200000, // $12,000
  aprPct: 7.0,
  years: 3,
  paymentsPerYear: 12,
  firstDueMonth: "2026-08",
};

describe("loanPaymentCents", () => {
  it("matches the standard annuity formula", () => {
    // $12,000 @ 7% / 36 months → $370.53
    expect(loanPaymentCents(BASE)).toBe(37053);
  });

  it("handles zero interest as straight division", () => {
    expect(loanPaymentCents({ ...BASE, aprPct: 0 })).toBe(Math.ceil(1200000 / 36));
  });
});

describe("amortize", () => {
  it("produces a full schedule that ends at zero", () => {
    const s = amortize(BASE);
    expect(s.rows).toHaveLength(36);
    expect(s.rows[0].month).toBe("2026-08");
    expect(s.rows[35].month).toBe("2029-07");
    expect(s.rows[35].endingCents).toBe(0);
    // First row interest: 12000 × 7%/12 = $70.00
    expect(s.rows[0].interestCents).toBe(7000);
    expect(s.totalInterestCents).toBeGreaterThan(0);
    expect(s.totalPaidCents).toBe(1200000 + s.totalInterestCents);
    expect(s.interestSharePct).toBeCloseTo((s.totalInterestCents / 1200000) * 100, 0);
  });

  it("balances flow row to row", () => {
    const s = amortize(BASE);
    for (let i = 1; i < s.rows.length; i++) {
      expect(s.rows[i].beginningCents).toBe(s.rows[i - 1].endingCents);
    }
  });

  it("extra payments shorten the schedule and cut interest", () => {
    const withExtra = amortize({ ...BASE, extraByPaymentNo: new Map([[6, 100000]]) });
    const without = amortize(BASE);
    expect(withExtra.rows.length).toBeLessThan(without.rows.length);
    expect(withExtra.totalInterestCents).toBeLessThan(without.totalInterestCents);
    expect(withExtra.rows[5].extraCents).toBe(100000);
  });

  it("never loops when the payment cannot cover interest", () => {
    const s = amortize({ ...BASE, aprPct: 1000 });
    expect(s.rows.length).toBeLessThan(2000);
  });
});
