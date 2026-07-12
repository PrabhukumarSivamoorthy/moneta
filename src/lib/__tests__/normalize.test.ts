import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "../csv/normalize";

describe("normalizeMerchant", () => {
  it("strips processor prefixes", () => {
    expect(normalizeMerchant("SQ *BAR MELUSINE")).toBe("Bar Melusine");
    expect(normalizeMerchant("PAYPAL *WANDERSTAY")).toBe("Wanderstay");
  });

  it("strips trailing reference and store numbers", () => {
    expect(normalizeMerchant("WHOLEFDS #10233 SEATTLE WA")).toBe("Wholefds Seattle Wa");
    expect(normalizeMerchant("AMZN Mktp US*RT4Y82ZL3")).toBe("Amzn Mktp US");
    expect(normalizeMerchant("NETFLIX.COM 866-579-7172")).toBe("Netflix.com");
  });

  it("collapses whitespace and title-cases", () => {
    expect(normalizeMerchant("  TRADER   JOE S #130   SEATTLE ")).toBe("Trader Joe S Seattle");
  });

  it("keeps plain words that merely look like codes", () => {
    expect(normalizeMerchant("SEATTLE CITY LIGHT BILLPAY")).toBe("Seattle City Light Billpay");
  });

  it("falls back to the raw string when stripping removes everything", () => {
    expect(normalizeMerchant("12345678")).toBe("12345678");
  });

  it("is deterministic (same input, same output)", () => {
    const s = "CHASE ATM 00234 PIKE ST SEATTLE";
    expect(normalizeMerchant(s)).toBe(normalizeMerchant(s));
  });
});
