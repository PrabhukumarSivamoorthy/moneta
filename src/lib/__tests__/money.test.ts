import { describe, expect, it } from "vitest";
import {
  centsToDecimalString,
  formatCents,
  parseAmountToCents,
} from "../money";

describe("parseAmountToCents", () => {
  it("parses plain decimals", () => {
    expect(parseAmountToCents("84.27")).toBe(8427);
    expect(parseAmountToCents("0.05")).toBe(5);
    expect(parseAmountToCents("1800")).toBe(180000);
  });

  it("parses signs and thousands separators", () => {
    expect(parseAmountToCents("-1,284.40")).toBe(-128440);
    expect(parseAmountToCents("+4,250.00")).toBe(425000);
  });

  it("parses single decimal digit as tens of cents", () => {
    expect(parseAmountToCents("8.2")).toBe(820);
  });

  it("rejects malformed input", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("1.234")).toBeNull();
    expect(parseAmountToCents("12.")).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats positive and negative cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-8427)).toBe("-$84.27");
    expect(formatCents(0)).toBe("$0.00");
  });
});

describe("round trip", () => {
  it("parse ∘ format is identity on cents", () => {
    for (const cents of [0, 1, 99, 100, 8427, -128440, 425000]) {
      expect(parseAmountToCents(centsToDecimalString(cents))).toBe(cents);
    }
  });
});
