/** "Apply rules" retro-files existing uncategorized entries with the same
 * engine imports use — a rule created today also cleans up history. */
import { test, expect, nav, executed } from "./support/helpers";

test("apply rules files matching uncategorized entries with source 'rule'", async ({ page }) => {
  await nav(page, "Transactions");
  await expect(page.getByText("2 UNCATEGORIZED")).toBeVisible();

  await page.getByRole("button", { name: "Apply rules" }).click();

  // The stub has a netflix→Subscriptions rule; Spotify has no matching rule.
  await expect(page.getByText("✓ 1 entry filed by your rules")).toBeVisible();
  const update = (await executed(page)).find((q) => q.startsWith("UPDATE transactions SET category_id"));
  expect(update).toBeTruthy();
  expect(update).toContain("IN ($3)"); // exactly one row updated
});
