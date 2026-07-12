import { describe, expect, it } from "vitest";
import { buildBackup, buildTransactionsCsv, TX_CSV_HEADER } from "../export";
import { readCsv } from "../csv/parse";
import type { TxRow } from "../../db/repo/transactions";

const tx = (partial: Partial<TxRow>): TxRow => ({
  id: 1,
  date: "2026-07-11",
  amountCents: -8427,
  merchantRaw: "WHOLEFDS #10233",
  merchantNormalized: "Wholefds Seattle Wa",
  accountId: 1,
  accountName: "Chase Checking",
  categoryId: 2,
  categoryName: "Groceries",
  categoryDefaultTier: "need",
  categoryIsSystem: false,
  categorizationSource: "rule",
  tierOverride: null,
  uploadId: 1,
  ...partial,
});

describe("buildBackup", () => {
  it("wraps everything with app/version/timestamp and never contains an API key", () => {
    const json = buildBackup({
      exportedAt: "2026-07-12T10:00:00Z",
      accounts: [{ id: 1, name: "Chase Checking" }],
      categories: [],
      transactions: [tx({})],
      rules: [],
      budgets: [],
      goals: [],
      bankProfiles: [],
      uploads: [],
      settings: { currency: "USD", ai_assist_enabled: "1" },
    });
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe("moneta");
    expect(parsed.backupVersion).toBe(1);
    expect(parsed.exportedAt).toBe("2026-07-12T10:00:00Z");
    expect(parsed.data.transactions).toHaveLength(1);
    expect(json).not.toContain("sk-ant");
    expect(json).not.toContain("api_key");
  });
});

describe("buildTransactionsCsv", () => {
  it("writes decimal amounts with bank-statement signs", () => {
    const csv = buildTransactionsCsv([tx({}), tx({ id: 2, amountCents: 425000, categoryName: "Income" })]);
    const rows = readCsv(csv);
    expect(rows[0]).toEqual([...TX_CSV_HEADER]);
    expect(rows[1][1]).toBe("-84.27");
    expect(rows[2][1]).toBe("4250.00");
  });

  it("round-trips fields containing commas, quotes, and newlines through our own parser", () => {
    const tricky = tx({
      merchantRaw: 'SMITH, JOHN "THE PLUMBER"\nLINE2',
      merchantNormalized: "Smith, John",
    });
    const rows = readCsv(buildTransactionsCsv([tricky]));
    expect(rows[1][3]).toBe('SMITH, JOHN "THE PLUMBER"\nLINE2');
    expect(rows[1][2]).toBe("Smith, John");
  });

  it("writes empty fields for nulls", () => {
    const rows = readCsv(buildTransactionsCsv([tx({ categoryName: null, tierOverride: null })]));
    expect(rows[1][5]).toBe("");
    expect(rows[1][6]).toBe("");
  });
});
