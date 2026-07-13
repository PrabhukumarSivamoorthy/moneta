/**
 * Regression tests for the "database is locked" (SQLite code 5) incident.
 *
 * Root cause was manual BEGIN/COMMIT through the SQL plugin's connection
 * pool: the two statements can run on different pooled connections and
 * leave a stray open write-transaction holding the file lock. The fix
 * removed pooled transactions (multi-row atomic INSERTs + dedup-safe
 * retries) and added file logging of every failed SQL statement.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, nav, executed, logs, failNextExecute } from "./support/helpers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(HERE, "fixtures", "chase_sample.csv");

async function importCsvToReview(page: import("@playwright/test").Page) {
  await nav(page, "Upload");
  await page.locator('input[type="file"]').setInputFiles(CSV);
  await page.getByRole("button", { name: "Review 5 rows" }).click();
  await expect(page.getByText("4 of 5 rows will be added")).toBeVisible();
}

test("import and wipe never issue pooled BEGIN/COMMIT statements", async ({ page }) => {
  // Full import commit.
  await importCsvToReview(page);
  await page.getByRole("button", { name: "Add 4 entries to ledger" }).click();
  await expect(page.getByText("IMPORT COMPLETE")).toBeVisible();

  // Danger-zone wipe.
  await nav(page, "Settings");
  await page.getByRole("button", { name: "Wipe all data…" }).click();
  await page.locator('input[class*="border-danger"]').fill("WIPE");
  await page.getByRole("button", { name: "Erase everything" }).click();

  const writes = await executed(page);
  expect(writes.some((q) => q.startsWith("INSERT INTO transactions"))).toBe(true);
  expect(writes.some((q) => q.startsWith("DELETE FROM transactions"))).toBe(true);
  // The actual regression: no manual transaction statements on the pool.
  const txnStatements = writes.filter((q) => /^(BEGIN|COMMIT|ROLLBACK)/i.test(q.trim()));
  expect(txnStatements).toEqual([]);
});

test("a locked database during commit surfaces the error and logs the failing query", async ({ page }) => {
  await importCsvToReview(page);

  // Arm the stub: the next INSERT INTO transactions throws SQLite code 5.
  await failNextExecute(page, "^INSERT INTO transactions");
  await page.getByRole("button", { name: "Add 4 entries to ledger" }).click();

  // The UI degrades gracefully — error banner, still on the review step.
  await expect(page.getByText(/database is locked/)).toBeVisible();
  await expect(page.getByText("IMPORT COMPLETE")).not.toBeVisible();
  await expect(page.getByText("4 of 5 rows will be added")).toBeVisible();

  // The failure was logged WITH the failing query — the debugging trail the
  // incident was missing.
  const logged = await logs(page);
  const sqlLog = logged.find((l) => l.includes("database is locked"));
  expect(sqlLog).toBeTruthy();
  expect(sqlLog).toContain("[sql]");
  expect(sqlLog).toContain("INSERT INTO transactions");
});

test("retrying after a lock failure completes the import (dedup makes retries safe)", async ({ page }) => {
  await importCsvToReview(page);

  await failNextExecute(page, "^INSERT INTO transactions");
  await page.getByRole("button", { name: "Add 4 entries to ledger" }).click();
  await expect(page.getByText(/database is locked/)).toBeVisible();

  // The injection is one-shot — the user simply clicks commit again.
  await page.getByRole("button", { name: "Add 4 entries to ledger" }).click();
  await expect(page.getByText("IMPORT COMPLETE")).toBeVisible();
  await expect(page.getByText("4 entries added to the ledger")).toBeVisible();
});
