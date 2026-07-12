import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, nav, executed, written, aiCalls } from "./support/helpers";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Insight screens (Overview, Earnings, Lent & borrowed, Goals & loans,
 * Recurring, Trends) plus Settings exports/wipe and the PDF-consent flow.
 * Every expected number is derived from the deterministic stub dataset in
 * e2e/support/tauri-stub.js.
 *
 * Balances from the stub: Chase Checking (checking) $8,420.00, E*TRADE
 * (brokerage) $24,500.00, Amex Gold (credit card) $1,284.40.
 * Lent & borrowed: Sam K −$250 sent / +$100 received → +$150 owed to you;
 * Dad +$500 received → −$500 you owe. Net lent = −$350.
 * Net position = 842000 + 2450000 + (−35000) − 128440 = 3128560 → $31,285.60.
 */

test("Overview: net position and 3-month forecast", async ({ page }) => {
  await nav(page, "Overview");

  await expect(page.getByText("NET POSITION")).toBeVisible();
  await expect(page.getByText("$31,285.60")).toBeVisible();

  // Forecast: header row + exactly 3 projection rows share this grid template.
  await expect(page.getByText("PROJECTED LIQUID")).toBeVisible();
  const forecastRows = page.locator('[class*="80px_1fr_1fr_1fr_1fr"]');
  await expect(forecastRows).toHaveCount(4);
});

test("Earnings: earned this period, manual tag, source type", async ({ page }) => {
  await nav(page, "Earnings");

  // Current-month Income rows: Acme payroll $4,250.00 + Freelance $300.00.
  await expect(page.getByText("EARNED THIS PERIOD")).toBeVisible();
  await expect(page.getByText("$4,550.00")).toBeVisible();

  const freelanceRow = page.locator('[class*="100px_1fr_170px_90px_120px"]', {
    hasText: "Freelance Logo Work",
  });
  await expect(freelanceRow.getByText("MANUAL")).toBeVisible();

  await expect(page.getByText("BY SOURCE TYPE")).toBeVisible();
  await expect(page.getByText("Payroll", { exact: true })).toBeVisible();
});

test("Lent & borrowed: owed / owe / net and person groups", async ({ page }) => {
  await nav(page, "Lent & borrowed");

  await expect(page.getByText("OWED TO YOU")).toBeVisible();
  // These values also repeat as the matching person balance, so scope to the
  // stat cards, which render first in the DOM.
  await expect(page.getByText("$150.00").first()).toBeVisible(); // owed to you
  await expect(page.getByText("$500.00").first()).toBeVisible(); // you owe
  await expect(page.getByText("-$350.00")).toBeVisible(); // net

  await expect(page.getByText("Sam K", { exact: true })).toBeVisible();
  await expect(page.getByText("Dad", { exact: true })).toBeVisible();
  await expect(page.getByText("owes you")).toBeVisible();
  await expect(page.getByText("you owe", { exact: true })).toBeVisible();
});

test("Goals & loans: goal progress and loan schedule", async ({ page }) => {
  await nav(page, "Goals & loans");

  await expect(page.getByText("Japan trip")).toBeVisible();
  await expect(page.getByText("$1,200.00")).toBeVisible();
  await expect(page.getByText(/of \$2,000\.00/)).toBeVisible();
  await expect(page.getByText("60%")).toBeVisible();

  await page.getByText("LOAN CALCULATOR").click();

  // $12,000 @ 7.0% / 3yr / 12 payments → level payment $370.53, 36 rows.
  await expect(page.getByText("$370.53")).toBeVisible();
  const scheduleRows = page.locator(
    '[class*="44px_80px_1fr_105px_105px_90px_1fr_120px"]',
  );
  await expect(scheduleRows).toHaveCount(37); // header + 36 payments
  await expect(scheduleRows.last()).toContainText("36");
});

test("Recurring: detection, monthly total, stop tracking", async ({ page }) => {
  await nav(page, "Recurring");

  await expect(page.getByText("Netflix.com").first()).toBeVisible();
  await expect(page.getByText("Spotify USA").first()).toBeVisible();
  await expect(page.getByText("$15.49")).toBeVisible();
  await expect(page.getByText("$11.99")).toBeVisible();

  // The stub's "Misc Spend" forecast-history rows (three monthly $2,500
  // charges) also qualify as recurring, so three rows are tracked and the
  // monthly total is $2,527.48 — not just the two subscriptions.
  await expect(page.getByText("PER MONTH")).toBeVisible();
  await expect(page.getByText("$2,527.48")).toBeVisible();

  // One "stop tracking" link per tracked row; stopping one moves it to the
  // NO LONGER TRACKED group and drops the tracked count.
  const stopLinks = page.getByText("stop tracking");
  await expect(stopLinks).toHaveCount(3);
  await stopLinks.first().click();

  await expect(page.getByText("NO LONGER TRACKED")).toBeVisible();
  await expect(page.getByText("stop tracking")).toHaveCount(2);
});

test("Trends: money-flow Sankey, tier composition, category legend", async ({ page }) => {
  await nav(page, "Trends");

  await expect(page.getByText("SPEND BY CATEGORY")).toBeVisible();
  // Category names also appear in the drill-down <select>; the legend chips
  // render first, so scope to the first match.
  await expect(page.getByText("Housing", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Dining", { exact: true }).first()).toBeVisible();

  await expect(page.getByText("TIER COMPOSITION — SHARE OF SPEND")).toBeVisible();

  await expect(page.getByText(/MONEY FLOW/)).toBeVisible();
  // Sankey nodes are SVG <text> labels rendered by the FlowNode component.
  await expect(page.getByText("This period")).toBeVisible();
  await expect(page.getByText("Kept")).toBeVisible();
});

test("Settings: JSON/CSV export and danger-zone wipe", async ({ page }) => {
  await nav(page, "Settings");

  // JSON backup — must be valid JSON, version 1, and must NOT leak the key.
  await page.getByRole("button", { name: "Export JSON backup" }).click();
  await expect.poll(() => written(page).then((w) => w.length)).toBeGreaterThanOrEqual(1);
  let files = await written(page);
  const backup = JSON.parse(files[0].contents);
  expect(backup.backupVersion).toBe(1);
  expect(backup.data.accounts).toBeDefined();
  expect(files[0].contents).not.toContain("sk-ant");

  // CSV export — second file, header first.
  await page.getByRole("button", { name: "Export transactions CSV" }).click();
  await expect.poll(() => written(page).then((w) => w.length)).toBeGreaterThanOrEqual(2);
  files = await written(page);
  expect(files[1].contents.startsWith("date,amount,merchant")).toBe(true);

  // Danger zone: confirm gate then real DELETEs.
  await page.getByRole("button", { name: "Wipe all data…" }).click();
  const erase = page.getByRole("button", { name: "Erase everything" });
  await expect(erase).toBeDisabled();
  await page.locator('input[class*="border-danger"]').fill("WIPE");
  await expect(erase).toBeEnabled();
  await erase.click();

  await expect
    .poll(() => executed(page).then((w) => w.includes("DELETE FROM transactions")))
    .toBe(true);
  const writes = await executed(page);
  expect(writes).toContain("DELETE FROM transactions");
  expect(writes).toContain("DELETE FROM accounts");
});

test("Upload: PDF consent gate then extract, review, commit", async ({ page }) => {
  await nav(page, "Upload");

  await page.locator('input[type="file"]').setInputFiles(path.join(HERE, "fixtures", "test_stmt.pdf"));

  // Consent panel appears; nothing has been sent yet.
  await expect(page.getByText("PDF EXTRACTION — SENDS THE STATEMENT TO ANTHROPIC")).toBeVisible();
  expect(await aiCalls(page)).toHaveLength(0);

  await page.getByRole("button", { name: "Send & extract" }).click();

  // Exactly one request, carrying the statement as a document block.
  await expect.poll(() => aiCalls(page).then((c) => c.length)).toBe(1);
  const body = JSON.parse((await aiCalls(page))[0]);
  expect(body.messages[0].content[0].type).toBe("document");

  // Stub returns 2 valid rows + 1 garbage-date row.
  await expect(page.getByText("2 rows extracted · 1 rows failed")).toBeVisible();

  await page.getByRole("button", { name: "Review 2 rows" }).click();
  await expect(page.getByText("Alaska Air", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add 2 entries to ledger" }).click();
  await expect(page.getByText("IMPORT COMPLETE")).toBeVisible();
});
