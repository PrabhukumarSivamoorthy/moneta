/**
 * Rule offers queue up: bulk-categorizing several uncategorized merchants
 * offers one rule per merchant, and "Create all" persists them in one go —
 * skipping merchants an existing rule already covers.
 */
import { test, expect, nav, executed } from "./support/helpers";

test("bulk categorize offers one rule per merchant; create-all skips already-covered ones", async ({ page }) => {
  await nav(page, "Transactions");

  // Select both uncategorized rows (Netflix + Spotify) and bulk-file them.
  await page.getByTestId("tx-row").filter({ hasText: "Netflix.com" }).locator('input[type="checkbox"]').check();
  await page.getByTestId("tx-row").filter({ hasText: "Spotify USA" }).locator('input[type="checkbox"]').check();
  await page.locator("select").filter({ hasText: "Set category…" }).selectOption({ label: "Subscriptions" });
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  // Two offers queue up together.
  await expect(page.getByText("2 RULE OFFERS")).toBeVisible();
  await expect(page.getByText(/Always file .*Netflix\.com/)).toBeVisible();
  await expect(page.getByText(/Always file .*Spotify USA/)).toBeVisible();

  await page.getByRole("button", { name: "Create all 2 rules" }).click();
  await expect(page.getByText("2 RULE OFFERS")).not.toBeVisible();

  // The stub already has a netflix rule, so create-all persists ONLY the
  // Spotify rule — no duplicate for Netflix.
  await expect
    .poll(async () => (await executed(page)).filter((q) => q.startsWith("INSERT INTO rules")).length)
    .toBe(1);
  // …and the new rules immediately file the matching uncategorized entries.
  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("UPDATE transactions SET category_id")))
    .toBe(true);
});

test("individual offers can be created or dismissed independently", async ({ page }) => {
  await nav(page, "Transactions");

  // Two manual recategorizations queue two offers.
  await page.getByTestId("tx-row").filter({ hasText: "Netflix.com" }).locator("select").selectOption({ label: "Subscriptions" });
  await page.getByTestId("tx-row").filter({ hasText: "Spotify USA" }).locator("select").first().selectOption({ label: "Subscriptions" });
  await expect(page.getByText("2 RULE OFFERS")).toBeVisible();

  // Dismiss the Spotify offer, keep Netflix.
  const spotifyOffer = page.getByTestId("rule-offer").filter({ hasText: "Spotify USA" });
  await spotifyOffer.getByText("just this one").click();
  await expect(page.getByTestId("rule-offer").filter({ hasText: "Spotify USA" })).toHaveCount(0);
  await expect(page.getByTestId("rule-offer").filter({ hasText: "Netflix.com" })).toBeVisible();

  // Create the remaining one.
  await page.getByTestId("rule-offer").filter({ hasText: "Netflix.com" }).getByRole("button", { name: "Create rule" }).click();
  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("INSERT INTO rules")))
    .toBe(true);
  await expect(page.getByTestId("rule-offer")).toHaveCount(0);
});
