/**
 * Frozen headers (design update): on Transactions the title/filters/column
 * headers stay pinned while ledger rows scroll; on Upload the title + step
 * indicator stay pinned over the review list.
 *
 * Note: the content wrapper has 30px top padding, so the sticky block
 * travels that far and then PINS at the scroll container's top edge — the
 * assertions check the pinned position, and that it holds as scrolling
 * continues.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, nav } from "./support/helpers";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Scroll the app's main scroll container and return {scrollTop, top}. */
async function scrollMain(page: import("@playwright/test").Page, to: number) {
  return page.evaluate((y) => {
    const scroller = document.querySelector(".overflow-y-auto") as HTMLElement;
    scroller.scrollTop = y;
    return { scrollTop: scroller.scrollTop, top: scroller.getBoundingClientRect().top };
  }, to);
}

test("Transactions header block pins at the container top while rows scroll", async ({ page }) => {
  // Short viewport so the ledger must scroll.
  await page.setViewportSize({ width: 1440, height: 480 });
  await nav(page, "Transactions");

  const headerCell = page.getByText("MERCHANT", { exact: true });
  await expect(headerCell).toBeVisible();
  const firstRow = page.getByTestId("tx-row").first();
  const firstRowBefore = await firstRow.boundingBox();

  const mid = await scrollMain(page, 4000);
  expect(mid.scrollTop).toBeGreaterThan(100); // the list really scrolled

  // Header still visible, pinned within the header block at the container's
  // top region (the block holds title + filters + column headers).
  await expect(headerCell).toBeVisible();
  const pinned = await headerCell.boundingBox();
  const container = mid.top;
  expect(pinned!.y).toBeGreaterThanOrEqual(container - 2);
  expect(pinned!.y).toBeLessThan(container + 300); // inside the frozen block, not scrolled away

  // Scrolling further must not move the pinned header.
  await scrollMain(page, 999999);
  const pinned2 = await headerCell.boundingBox();
  expect(Math.abs(pinned2!.y - pinned!.y)).toBeLessThan(2);

  // …while the first row scrolled up (or fully out of view).
  const firstRowAfter = await firstRow.boundingBox();
  expect(firstRowAfter === null || firstRowAfter.y < firstRowBefore!.y).toBe(true);
});

test("Upload step indicator pins while the review list scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await nav(page, "Upload");
  await page.locator('input[type="file"]').setInputFiles(path.join(HERE, "fixtures", "chase_sample.csv"));
  await page.getByRole("button", { name: "Review 5 rows" }).click();
  await expect(page.getByText("4 of 5 rows will be added")).toBeVisible();

  const steps = page.getByText("REVIEW ROWS", { exact: true });
  await expect(steps).toBeVisible();
  const dateHeader = page.getByText("DATE", { exact: true });
  await expect(dateHeader).toBeVisible();

  const mid = await scrollMain(page, 4000);
  expect(mid.scrollTop).toBeGreaterThan(50);

  await expect(steps).toBeVisible();
  const pinned = await steps.boundingBox();
  expect(pinned!.y).toBeGreaterThanOrEqual(mid.top - 2);
  expect(pinned!.y).toBeLessThan(mid.top + 200);

  // The review column headers (DATE / MERCHANT / AMOUNT) freeze too.
  await expect(dateHeader).toBeVisible();
  const dateBox = await dateHeader.boundingBox();
  expect(dateBox!.y).toBeGreaterThanOrEqual(mid.top - 2);
  expect(dateBox!.y).toBeLessThan(mid.top + 300);

  await scrollMain(page, 999999);
  const pinned2 = await steps.boundingBox();
  expect(Math.abs(pinned2!.y - pinned!.y)).toBeLessThan(2);
  const dateBox2 = await dateHeader.boundingBox();
  expect(Math.abs(dateBox2!.y - dateBox!.y)).toBeLessThan(2);
});
