/**
 * Backup restore: pick a backup file → counts preview → explicit
 * replace-everything confirmation → full teardown + reinsert.
 * The stub's open dialog returns a fixed path and read_text_file serves
 * whatever the test primes into window.__backupFile.
 */
import { test, expect, nav, executed } from "./support/helpers";

const BACKUP = {
  app: "moneta",
  backupVersion: 1,
  exportedAt: "2026-01-15T09:00:00Z",
  data: {
    accounts: [{ id: 1, name: "Old Chase", type: "checking", balance_cents: 5000, balance_as_of: null }],
    categories: [{ id: 2, name: "Groceries", parent_id: null, default_tier: "need", is_archived: 0, is_system: 0 }],
    transactions: [
      {
        id: 10, upload_id: null, account_id: 1, date: "2026-01-10", amount_cents: -1234,
        merchant_raw: "OLD SHOP", merchant_normalized: "Old Shop", category_id: 2,
        categorization_source: "manual", tier_override: null, dedup_hash: "aa", created_at: "2026-01-10T00:00:00Z",
      },
    ],
    rules: [],
    budgets: [],
    goals: [],
    bankProfiles: [],
    uploads: [],
    settings: { currency: "USD", tier_target_need: "50" },
  },
};

test("restore shows a preview and replaces the ledger only after confirmation", async ({ page }) => {
  await page.evaluate((b) => {
    (window as unknown as { __backupFile: string }).__backupFile = JSON.stringify(b);
  }, BACKUP);

  await nav(page, "Settings");
  await page.getByRole("button", { name: "Restore from backup…" }).click();

  // Preview with the backup's counts — nothing written yet.
  await expect(page.getByText("RESTORE REPLACES EVERYTHING CURRENTLY IN THE LEDGER")).toBeVisible();
  await expect(page.getByText("Backup from 2026-01-15")).toBeVisible();
  expect((await executed(page)).some((q) => q.startsWith("DELETE"))).toBe(false);

  await page.getByRole("button", { name: "Replace ledger with this backup" }).click();
  await expect(page.getByText(/ledger restored from/)).toBeVisible();

  const writes = await executed(page);
  // Full teardown including seed tables…
  for (const table of ["transactions", "categories", "settings", "accounts"]) {
    expect(writes).toContain(`DELETE FROM ${table}`);
  }
  // …then parents-first reinsert with original ids, and still no pooled txns.
  expect(writes.some((q) => q.startsWith("INSERT INTO accounts"))).toBe(true);
  expect(writes.some((q) => q.startsWith("INSERT INTO transactions"))).toBe(true);
  expect(writes.indexOf(writes.find((q) => q.startsWith("INSERT INTO accounts"))!)).toBeLessThan(
    writes.indexOf(writes.find((q) => q.startsWith("INSERT INTO transactions"))!),
  );
  expect(writes.filter((q) => /^(BEGIN|COMMIT|ROLLBACK)/i.test(q.trim()))).toEqual([]);
});

test("a foreign file is rejected with a readable error and no writes", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __backupFile: string }).__backupFile = '{"totally":"unrelated"}';
  });
  await nav(page, "Settings");
  await page.getByRole("button", { name: "Restore from backup…" }).click();
  await expect(page.getByText(/Not a Moneta backup/)).toBeVisible();
  expect((await executed(page)).some((q) => q.startsWith("DELETE"))).toBe(false);
});
