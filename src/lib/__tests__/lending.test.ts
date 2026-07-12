import { describe, expect, it } from "vitest";
import { extractPerson, groupByPerson, type LendingEntry } from "../lending";
import { classifyIncome } from "../income";

describe("extractPerson", () => {
  it("extracts names from transfer descriptions", () => {
    expect(extractPerson("Zelle Payment To Sam K")).toBe("Sam K");
    expect(extractPerson("Zelle Payment From Dad")).toBe("Dad");
    expect(extractPerson("Venmo Payment To Priya")).toBe("Priya");
  });

  it("groups ATM and cash under Cash", () => {
    expect(extractPerson("Chase ATM Pike St Seattle")).toBe("Cash");
    expect(extractPerson("Cash Deposit Branch")).toBe("Cash");
  });

  it("falls back to the merchant itself", () => {
    expect(extractPerson("Wire Transfer Ref")).toBe("Wire Transfer Ref");
  });
});

describe("groupByPerson", () => {
  const e = (date: string, amountCents: number, merchant: string): LendingEntry => ({
    date,
    amountCents,
    merchantNormalized: merchant,
    accountName: "Chase Checking",
  });

  it("computes per-person all-time balances with the owed-to-you convention", () => {
    const people = groupByPerson([
      e("2026-07-08", -25000, "Zelle Payment To Sam K"), // you sent $250
      e("2026-07-10", 10000, "Zelle Payment From Sam K"), // Sam repaid $100
      e("2026-06-15", 50000, "Zelle Payment From Dad"), // Dad sent you $500
    ]);
    const sam = people.find((p) => p.person === "Sam K")!;
    expect(sam.balanceCents).toBe(15000); // Sam owes you $150
    const dad = people.find((p) => p.person === "Dad")!;
    expect(dad.balanceCents).toBe(-50000); // you owe Dad $500
  });

  it("sorts people by balance magnitude and entries newest-first", () => {
    const people = groupByPerson([
      e("2026-07-01", -1000, "Zelle Payment To Small"),
      e("2026-07-01", -90000, "Zelle Payment To Big"),
      e("2026-07-05", -1000, "Zelle Payment To Small"),
    ]);
    expect(people[0].person).toBe("Big");
    expect(people[1].entries[0].date).toBe("2026-07-05");
  });
});

describe("classifyIncome", () => {
  it("classifies payroll, dividends/interest, and other", () => {
    expect(classifyIncome("Acme Corp Direct Dep Payroll")).toBe("Payroll");
    expect(classifyIncome("Etrade Div Vanguard Tot Stk")).toBe("Dividends & interest");
    expect(classifyIncome("Chase Interest Payment")).toBe("Dividends & interest");
    expect(classifyIncome("Freelance Logo Work")).toBe("Other");
  });
});
