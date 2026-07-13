import { describe, expect, it } from "vitest";
import { parseDate, parseStatement, readCsv } from "../csv/parse";
import type { BankProfileSpec } from "../csv/types";

describe("readCsv", () => {
  it("splits simple rows", () => {
    expect(readCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas, escaped quotes, and newlines", () => {
    const text = 'name,memo\n"Smith, John","He said ""hi""\nsecond line"';
    expect(readCsv(text)).toEqual([
      ["name", "memo"],
      ["Smith, John", 'He said "hi"\nsecond line'],
    ]);
  });

  it("handles CRLF line endings and skips blank lines", () => {
    expect(readCsv("a,b\r\n1,2\r\n\r\n3,4\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("supports alternative delimiters", () => {
    expect(readCsv("a;b\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseDate", () => {
  it("parses each supported format to ISO", () => {
    expect(parseDate("2026-07-11", "YYYY-MM-DD")).toBe("2026-07-11");
    expect(parseDate("7/4/2026", "MM/DD/YYYY")).toBe("2026-07-04");
    expect(parseDate("11.07.2026", "DD.MM.YYYY")).toBe("2026-07-11");
  });

  it("parses 2-digit-year (Discover) dates, expanding to 20YY", () => {
    expect(parseDate("5/2/25", "MM/DD/YY")).toBe("2025-05-02");
    expect(parseDate("12/31/24", "MM/DD/YY")).toBe("2024-12-31");
    // A 4-digit year is not this format.
    expect(parseDate("5/2/2025", "MM/DD/YY")).toBeNull();
    // Still rejects impossible calendar dates.
    expect(parseDate("2/30/25", "MM/DD/YY")).toBeNull();
  });

  it("rejects invalid calendar dates and wrong formats", () => {
    expect(parseDate("2026-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("13/40/2026", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("2026-07-11", "MM/DD/YYYY")).toBeNull();
  });
});

const CHASE: BankProfileSpec = {
  delimiter: ",",
  dateFormat: "MM/DD/YYYY",
  columnMap: { date: "Transaction Date", description: "Description", amount: "Amount" },
  signConvention: "debits_negative",
};

describe("parseStatement — single amount column", () => {
  it("parses rows and normalizes to app sign convention", () => {
    const text = [
      "Transaction Date,Description,Amount",
      "07/11/2026,WHOLEFDS #10233 SEATTLE WA,-84.27",
      "07/05/2026,ACME CORP DIRECT DEP PAYROLL,4250.00",
    ].join("\n");
    const { rows, errors } = parseStatement(text, CHASE);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, date: "2026-07-11", amountCents: -8427, merchantRaw: "WHOLEFDS #10233 SEATTLE WA" },
      { line: 3, date: "2026-07-05", amountCents: 425000, merchantRaw: "ACME CORP DIRECT DEP PAYROLL" },
    ]);
  });

  it("flips signs for debits_positive conventions", () => {
    const text = "Transaction Date,Description,Amount\n07/11/2026,COFFEE,6.75\n07/05/2026,PAYROLL,-4250.00";
    const { rows } = parseStatement(text, { ...CHASE, signConvention: "debits_positive" });
    expect(rows[0].amountCents).toBe(-675);
    expect(rows[1].amountCents).toBe(425000);
  });

  it("collects row errors without dropping them and keeps good rows", () => {
    const text = [
      "Transaction Date,Description,Amount",
      "not-a-date,SHOP,-5.00",
      "07/11/2026,,-5.00",
      "07/11/2026,SHOP,abc",
      "07/12/2026,GOOD ROW,-1.00",
    ].join("\n");
    const { rows, errors } = parseStatement(text, CHASE);
    expect(rows).toHaveLength(1);
    expect(rows[0].merchantRaw).toBe("GOOD ROW");
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(errors[0].reason).toContain("Unparseable date");
    expect(errors[1].reason).toBe("Empty description");
    expect(errors[2].reason).toContain("Unparseable amount");
  });

  it("errors on missing mapped columns", () => {
    const { rows, errors } = parseStatement("Date,Memo,Value\n1,2,3", CHASE);
    expect(rows).toEqual([]);
    expect(errors[0].reason).toContain("Missing column(s)");
  });

  it("matches header names case-insensitively", () => {
    const text = "transaction date,DESCRIPTION,amount\n07/11/2026,SHOP,-5.00";
    const { rows, errors } = parseStatement(text, CHASE);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});

describe("parseStatement — debit/credit pair", () => {
  const AMEX: BankProfileSpec = {
    delimiter: ",",
    dateFormat: "YYYY-MM-DD",
    columnMap: { date: "Date", description: "Description", debit: "Debit", credit: "Credit" },
    signConvention: "debits_positive",
  };

  it("maps debit to negative and credit to positive regardless of convention", () => {
    const text = ["Date,Description,Debit,Credit", "2026-07-10,SUSHI KASHIBA,128.40,", "2026-07-06,ONLINE PAYMENT THANK YOU,,1284.40"].join("\n");
    const { rows, errors } = parseStatement(text, AMEX);
    expect(errors).toEqual([]);
    expect(rows[0].amountCents).toBe(-12840);
    expect(rows[1].amountCents).toBe(128440);
  });

  it("errors when both or neither column has a value", () => {
    const text = ["Date,Description,Debit,Credit", "2026-07-10,BAD,1.00,2.00", "2026-07-10,ALSO BAD,,"].join("\n");
    const { rows, errors } = parseStatement(text, AMEX);
    expect(rows).toEqual([]);
    expect(errors[0].reason).toBe("Both debit and credit have values");
    expect(errors[1].reason).toBe("Neither debit nor credit has a value");
  });
});
