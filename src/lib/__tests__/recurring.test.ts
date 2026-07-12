import { describe, expect, it } from "vitest";
import { detectRecurring, type RecurringInput } from "../recurring";

const charge = (date: string, amountCents: number, merchant = "Netflix.com"): RecurringInput => ({
  date,
  amountCents,
  merchantNormalized: merchant,
  categoryId: 6,
  categoryName: "Subscriptions",
  accountName: "Chase Checking",
});

describe("detectRecurring", () => {
  it("detects a monthly charge with stable amount", () => {
    const [c] = detectRecurring([
      charge("2026-04-09", -1549),
      charge("2026-05-09", -1549),
      charge("2026-06-09", -1549),
      charge("2026-07-09", -1549),
    ]);
    expect(c).toMatchObject({
      merchant: "Netflix.com",
      count: 4,
      medianCents: 1549,
      cadence: "monthly",
      medianGapDays: 30,
      lastDate: "2026-07-09",
      nextDate: "2026-08-08",
      priceChangePct: null,
    });
  });

  it("requires at least three occurrences", () => {
    expect(detectRecurring([charge("2026-06-09", -1549), charge("2026-07-09", -1549)])).toEqual([]);
  });

  it("rejects non-monthly cadence (weekly)", () => {
    expect(
      detectRecurring([
        charge("2026-07-01", -500, "Coffee Cart"),
        charge("2026-07-08", -500, "Coffee Cart"),
        charge("2026-07-15", -500, "Coffee Cart"),
      ]),
    ).toEqual([]);
  });

  it("tolerates ±10% amount drift and flags a price change", () => {
    const [c] = detectRecurring([
      charge("2026-04-09", -1549),
      charge("2026-05-09", -1549),
      charge("2026-06-09", -1549),
      charge("2026-07-09", -1649), // +6.5%
    ]);
    expect(c.count).toBe(4);
    expect(c.priceChangePct).toBe(6);
    expect(c.lastCents).toBe(1649);
  });

  it("drops outlier amounts before the cadence check", () => {
    const [c] = detectRecurring([
      charge("2026-04-09", -1549),
      charge("2026-05-09", -1549),
      charge("2026-05-20", -9900), // gift card, not the subscription
      charge("2026-06-09", -1549),
      charge("2026-07-09", -1549),
    ]);
    expect(c.count).toBe(4);
    expect(c.medianCents).toBe(1549);
  });

  it("ignores merchants with irregular amounts (groceries)", () => {
    expect(
      detectRecurring([
        charge("2026-05-01", -4200, "Whole Foods"),
        charge("2026-06-01", -8100, "Whole Foods"),
        charge("2026-07-01", -2600, "Whole Foods"),
      ]),
    ).toEqual([]);
  });

  it("sorts candidates by amount descending", () => {
    const rows = [
      charge("2026-05-01", -1000, "Small"),
      charge("2026-06-01", -1000, "Small"),
      charge("2026-07-01", -1000, "Small"),
      charge("2026-05-03", -2299, "Adobe"),
      charge("2026-06-03", -2299, "Adobe"),
      charge("2026-07-03", -2299, "Adobe"),
    ];
    expect(detectRecurring(rows).map((c) => c.merchant)).toEqual(["Adobe", "Small"]);
  });
});
