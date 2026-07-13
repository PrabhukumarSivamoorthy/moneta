import { test, expect, nav, executed } from "./support/helpers";

// ---------------------------------------------------------------------------
// Budgets: apply-forward (rest of year / entire year) and the budgeted tier
// allocation shown in the tier-target cards.
//
// Stub budgets: Housing $1,900 (need) + Groceries $520 (need) = $2,420 need;
// Dining $320 + Subscriptions $90 (comfortable) = $410; Shopping $250 (luxury).
// Total $3,080 → shares 78.6 / 13.3 / 8.1.
// ---------------------------------------------------------------------------

/** Upsert-copy statements issued by applyBudgetsToMonths (one per month). */
const isApplyCopy = (q: string) =>
  q.includes("INSERT INTO budgets") && q.includes("SELECT category_id");

test("Budgets: tier cards show the budgeted allocation vs targets", async ({ page }) => {
  await nav(page, "Budgets");

  await expect(page.getByTestId("tier-budgeted-need")).toHaveText("78.6%");
  await expect(page.getByTestId("tier-budgeted-comfortable")).toHaveText("13.3%");
  await expect(page.getByTestId("tier-budgeted-luxury")).toHaveText("8.1%");

  // All three are >5pt off the 50/30/20 targets → danger styling.
  for (const tier of ["need", "comfortable", "luxury"]) {
    await expect(page.getByTestId(`tier-budgeted-${tier}`)).toHaveClass(/text-danger/);
  }

  // Dollar figures per tier, per month (month scope).
  await expect(page.getByText("$2,420.00/mo")).toBeVisible();
  await expect(page.getByText("$410.00/mo")).toBeVisible();
  await expect(page.getByText("$250.00/mo")).toBeVisible();

  await expect(page.getByText(/Budgeted mix shows how your budget amounts/)).toBeVisible();
});

test("Budgets: apply to entire year writes 11 months and undo restores them", async ({ page }) => {
  await nav(page, "Budgets");

  await page.getByTestId("apply-entire-year").click();

  // One upsert-copy per non-current month of the year.
  await expect
    .poll(async () => (await executed(page)).filter(isApplyCopy).length)
    .toBe(11);
  await expect(page.getByTestId("apply-note")).toContainText("(11 months)");

  await page.getByTestId("apply-undo").click();

  // Undo deletes the target months' rows and re-inserts the snapshot.
  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("DELETE FROM budgets WHERE month IN")))
    .toBe(true);
  await expect
    .poll(async () =>
      (await executed(page)).some((q) => q.includes("INSERT INTO budgets") && q.includes("VALUES")),
    )
    .toBe(true);
  await expect(page.getByTestId("apply-note")).toHaveCount(0);
});

test("Budgets: apply to rest of year targets only the remaining months", async ({ page }) => {
  await nav(page, "Budgets");

  // Era-proof: the stub runs at the real current date.
  const remaining = 12 - (new Date().getMonth() + 1);
  const btn = page.getByTestId("apply-rest-of-year");

  if (remaining === 0) {
    // December: nothing left to apply to.
    await expect(btn).toBeDisabled();
    return;
  }

  await btn.click();
  await expect
    .poll(async () => (await executed(page)).filter(isApplyCopy).length)
    .toBe(remaining);
  await expect(page.getByTestId("apply-note")).toContainText(
    `(${remaining} month${remaining === 1 ? "" : "s"})`,
  );
});

test("Budgets: apply buttons are disabled outside month scope", async ({ page }) => {
  await nav(page, "Budgets");
  await page.getByText("WEEK", { exact: true }).click();

  await expect(page.getByTestId("apply-rest-of-year")).toBeDisabled();
  await expect(page.getByTestId("apply-entire-year")).toBeDisabled();
});
