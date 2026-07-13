/** "Apply rules" retro-files existing uncategorized entries across the whole
 * ledger with the same engine imports use. */
import { test, expect, nav, executed } from "./support/helpers";

test("apply rules files matching uncategorized entries across the whole ledger", async ({ page }) => {
  await nav(page, "Transactions");
  await expect(page.getByText("2 UNCATEGORIZED")).toBeVisible();

  await page.getByRole("button", { name: "Apply rules" }).click();

  // The stub's netflix rule matches the current-period Netflix row, and the
  // whole-foods rule matches a prior-month backlog entry → 2 filed total.
  await expect(page.getByText("✓ 2 entries filed by your rules")).toBeVisible();
  const updates = (await executed(page)).filter((q) => q.startsWith("UPDATE transactions SET category_id"));
  expect(updates.length).toBeGreaterThan(0);
});
