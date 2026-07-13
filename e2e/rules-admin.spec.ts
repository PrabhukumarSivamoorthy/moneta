/**
 * Settings → Rules: filter by the category a rule sets, and sort by any
 * column. The "#" column always shows the priority-order rank, even when
 * the view is sorted by another column.
 */
import { test, expect, nav } from "./support/helpers";

/** Matcher text of each rule row, top to bottom. */
function patterns(page: import("@playwright/test").Page): Promise<string[]> {
  return page.getByTestId("rule-pattern").allInnerTexts();
}

test("filter rules by the category they set", async ({ page }) => {
  await nav(page, "Settings");
  // Stub has 4 rules: uniqlo→Shopping, whole foods→Groceries,
  // netflix→Subscriptions, trader→Groceries.
  await expect(page.getByTestId("rule-row")).toHaveCount(4);

  await page.getByText("Filter by category").locator("xpath=following-sibling::select").selectOption({ label: "Groceries" });

  // Only the two Groceries rules remain.
  await expect(page.getByText("2 of 4")).toBeVisible();
  await expect(page.getByTestId("rule-row")).toHaveCount(2);
  expect((await patterns(page)).sort()).toEqual(["trader", "whole foods"]);
});

test("sort by pattern ascending then descending", async ({ page }) => {
  await nav(page, "Settings");
  await expect(page.getByTestId("rule-row")).toHaveCount(4);

  await page.getByTestId("rule-sort-pattern").click();
  expect(await patterns(page)).toEqual(["netflix", "trader", "uniqlo", "whole foods"]);

  await page.getByTestId("rule-sort-pattern").click();
  expect(await patterns(page)).toEqual(["whole foods", "uniqlo", "trader", "netflix"]);
});

test("default order is by priority rank, shown in the # column", async ({ page }) => {
  await nav(page, "Settings");
  await expect(page.getByTestId("rule-row")).toHaveCount(4);
  // uniqlo p5, whole foods p10, netflix p20, trader p30.
  expect(await patterns(page)).toEqual(["uniqlo", "whole foods", "netflix", "trader"]);

  // Re-sort the view by category; the # still reflects priority rank —
  // whole foods is rank 2 no matter the view order.
  await page.getByTestId("rule-sort-category").click();
  const wholeFoodsRow = page.getByTestId("rule-row").filter({ hasText: "whole foods" });
  await expect(wholeFoodsRow.getByTestId("rule-rank")).toHaveText("2");
});
