/**
 * Deleting a single transaction, bulk delete, and undoing a whole import —
 * every destructive action requires a second, explicit click.
 */
import { test, expect, nav, executed } from "./support/helpers";

test("per-row delete arms first, then deletes exactly that row", async ({ page }) => {
  await nav(page, "Transactions");
  const row = page.getByTestId("tx-row").filter({ hasText: "Sushi Kashiba" });
  await expect(row).toBeVisible();

  await row.locator('span[title="Delete this entry"]').click();
  // Armed, not deleted.
  expect((await executed(page)).some((q) => q.startsWith("DELETE FROM transactions"))).toBe(false);
  await row.getByText("delete?", { exact: true }).click();

  const del = (await executed(page)).find((q) => q.startsWith("DELETE FROM transactions"));
  expect(del).toBe("DELETE FROM transactions WHERE id IN ($1)");
});

test("arming a delete and clicking no cancels it", async ({ page }) => {
  await nav(page, "Transactions");
  const row = page.getByTestId("tx-row").filter({ hasText: "Sushi Kashiba" });
  await row.locator('span[title="Delete this entry"]').click();
  await row.getByText("no", { exact: true }).click();
  await expect(row.locator('span[title="Delete this entry"]')).toBeVisible();
  expect((await executed(page)).some((q) => q.startsWith("DELETE FROM transactions"))).toBe(false);
});

test("bulk delete requires the armed confirmation", async ({ page }) => {
  await nav(page, "Transactions");
  await page.getByTestId("tx-row").filter({ hasText: "Sushi Kashiba" }).locator('input[type="checkbox"]').check();
  await page.getByTestId("tx-row").filter({ hasText: "Uniqlo" }).locator('input[type="checkbox"]').check();

  await page.getByRole("button", { name: "Delete 2…" }).click();
  expect((await executed(page)).some((q) => q.startsWith("DELETE FROM transactions"))).toBe(false);
  await page.getByRole("button", { name: "Really delete 2?" }).click();

  const del = (await executed(page)).find((q) => q.startsWith("DELETE FROM transactions"));
  expect(del).toBe("DELETE FROM transactions WHERE id IN ($1, $2)");
});

test("undo import deletes the upload's transactions then the upload record", async ({ page }) => {
  await nav(page, "Settings");
  await expect(page.getByText("chase_statement.csv")).toBeVisible();
  await expect(page.getByText(/9.*of.*9.*entries still in the ledger/)).toBeVisible();

  await page.getByText("undo import", { exact: true }).click();
  expect((await executed(page)).some((q) => q.startsWith("DELETE"))).toBe(false);
  await page.getByText(/delete 9 entries\?/).click();

  const writes = await executed(page);
  const txDelete = writes.indexOf("DELETE FROM transactions WHERE upload_id = $1");
  const upDelete = writes.indexOf("DELETE FROM uploads WHERE id = $1");
  expect(txDelete).toBeGreaterThanOrEqual(0);
  expect(upDelete).toBeGreaterThan(txDelete); // children first
});
