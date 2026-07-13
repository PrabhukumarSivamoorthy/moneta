import { describe, expect, it } from "vitest";
import { derivedCash, type CashRow } from "../cash";

const row = (accountId: number, date: string, amountCents: number): CashRow => ({
  accountId,
  date,
  amountCents,
});

describe("derivedCash", () => {
  it("adds only transactions strictly after the anchor date", () => {
    const account = { id: 1, balanceCents: 100000, balanceAsOf: "2026-07-07" };
    const d = derivedCash(account, [
      row(1, "2026-07-07", -9999), // on the anchor day — already in the statement balance
      row(1, "2026-07-08", -2500),
      row(1, "2026-07-10", 4000),
    ]);
    expect(d.cents).toBe(101500);
    expect(d.entriesCounted).toBe(2);
    expect(d.anchored).toBe(true);
  });

  it("ignores other accounts' transactions", () => {
    const account = { id: 1, balanceCents: 50000, balanceAsOf: "2026-01-01" };
    const d = derivedCash(account, [row(2, "2026-02-01", -10000)]);
    expect(d.cents).toBe(50000);
    expect(d.entriesCounted).toBe(0);
  });

  it("sums all of the account's entries when no anchor is set", () => {
    const account = { id: 1, balanceCents: 0, balanceAsOf: null };
    const d = derivedCash(account, [
      row(1, "2026-01-05", 425000),
      row(1, "2026-01-08", -8427),
    ]);
    expect(d.cents).toBe(416573);
    expect(d.entriesCounted).toBe(2);
    expect(d.anchored).toBe(false);
  });

  it("returns the bare anchor when nothing postdates it", () => {
    const account = { id: 1, balanceCents: 842000, balanceAsOf: "2026-07-10" };
    const d = derivedCash(account, [row(1, "2026-07-10", -1850)]);
    expect(d.cents).toBe(842000);
    expect(d.entriesCounted).toBe(0);
  });
});
