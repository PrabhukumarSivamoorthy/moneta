import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, nav, executed } from "./support/helpers";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("sidebar navigates every screen", async ({ page }) => {
  const screens: [string, string | RegExp][] = [
    ["Overview", "NET POSITION"],
    ["Dashboard", "TIER MIX — SPEND VS TARGET"],
    ["Earnings", "EARNED THIS PERIOD"],
    ["Transactions", "2 UNCATEGORIZED"],
    ["Budgets", "TIER TARGETS — MUST SUM TO 100"],
    ["Trends", "SPEND BY CATEGORY"],
    ["Lent & borrowed", "OWED TO YOU"],
    ["Goals & loans", "SAVINGS GOALS"],
    ["Recurring", "PER MONTH"],
    ["Transfers & investing", "MOVED TO BROKERAGES"],
    ["Upload", "Nothing enters the ledger until you confirm in step 3."],
    ["Settings", "AI CATEGORIZATION ASSIST"],
  ];
  for (const [label, marker] of screens) {
    await nav(page, label);
    await expect(page.getByText(marker).first()).toBeVisible();
  }
});

test("CSV import: parse → review with dedup and errors → commit", async ({ page }) => {
  await nav(page, "Upload");

  await page.locator('input[type="file"]').setInputFiles(path.join(HERE, "fixtures", "chase_sample.csv"));

  // Saved profile applies immediately: 5 parsed (incl. in-file duplicate), 1 failed.
  await expect(page.getByText("5", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/rows parsed/)).toBeVisible();
  await page.getByRole("button", { name: "Review 5 rows" }).click();

  // Review: duplicate unchecked + tagged; normalization visible; error listed.
  await expect(page.getByText("4 of 5 rows will be added")).toBeVisible();
  await expect(page.getByText("DUP IN FILE")).toBeVisible();
  await expect(page.getByText("Whole Foods Market").first()).toBeVisible();
  await expect(page.getByText(/Unparseable date "bad-date"/)).toBeVisible();

  await page.getByRole("button", { name: "Add 4 entries to ledger" }).click();

  // Confirm: summary + real INSERTs issued (Whole Foods matched the rule).
  await expect(page.getByText("IMPORT COMPLETE")).toBeVisible();
  await expect(page.getByText("4 entries added to the ledger")).toBeVisible();
  await expect(page.getByText("1 auto-categorized by your rules")).toBeVisible();
  await expect(page.getByText("1 duplicates skipped")).toBeVisible();

  const writes = await executed(page);
  expect(writes.some((q) => q.startsWith("INSERT INTO uploads"))).toBe(true);
  expect(writes.some((q) => q.startsWith("INSERT INTO transactions"))).toBe(true);
});
