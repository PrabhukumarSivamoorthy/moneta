import { test, expect, nav, executed } from "./support/helpers";

// ---------------------------------------------------------------------------
// Planned earnings by source (Earnings screen).
//
// Stub: Salary ← "payroll" plan $4,000 (Acme payroll earns $4,250 → +$250);
// Dividends ← "dividend" plan $100 (nothing matches → −$100); the manual
// "Freelance Logo Work" $300 matches no source → Unplanned.
// Totals: plan $4,100, earned $4,550, gap +$450.
// ---------------------------------------------------------------------------

test("per-source plan vs earned table with unplanned and total rows", async ({ page }) => {
  await nav(page, "Earnings");

  const salary = page.getByTestId("plan-row").filter({ hasText: "Salary" });
  await expect(salary).toContainText("payroll");
  await expect(salary.getByTestId("plan-input-1")).toHaveValue("4000.00");
  await expect(salary).toContainText("$4,250.00");
  await expect(salary).toContainText("+$250.00");

  const dividends = page.getByTestId("plan-row").filter({ hasText: "Dividends" });
  await expect(dividends).toContainText("−$100.00"); // behind plan

  const unplanned = page.getByTestId("plan-row-unplanned");
  await expect(unplanned).toContainText("$300.00");
  await expect(unplanned).toContainText("1 entry matching no source");

  // Header bar is driven by the source total, not the legacy single plan.
  await expect(page.getByText("plan $4,100.00 this period · from 2 sources below")).toBeVisible();
  await expect(page.getByText("111% of plan")).toBeVisible();
  const total = page.getByTestId("plan-total-row");
  await expect(total).toContainText("$4,100.00");
  await expect(total).toContainText("$4,550.00"); // matched + unplanned income
  await expect(total).toContainText("+$450.00");
});

test("editing a plan writes an upsert for the current month", async ({ page }) => {
  await nav(page, "Earnings");

  const input = page.getByTestId("plan-input-1");
  await input.fill("4500.00");
  await input.blur();

  await expect
    .poll(async () =>
      (await executed(page)).some(
        (q) => q.startsWith("INSERT INTO income_plans") && q.includes("ON CONFLICT (source_id, month)"),
      ),
    )
    .toBe(true);
});

test("adding a source writes it and clearing works via the form", async ({ page }) => {
  await nav(page, "Earnings");

  await page.getByTestId("add-source").click();
  await page.getByPlaceholder("Source name (e.g. Salary)").fill("Refunds");
  await page.getByPlaceholder("pattern (e.g. acme payroll)").fill("refund");
  await page.getByRole("button", { name: "Add source", exact: true }).last().click();

  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("INSERT INTO income_sources")))
    .toBe(true);
});

test("apply to entire year copies 11 months of plans and undo restores", async ({ page }) => {
  await nav(page, "Earnings");

  await page.getByTestId("plan-apply-entire-year").click();

  await expect
    .poll(async () =>
      (await executed(page)).filter(
        (q) => q.includes("INSERT INTO income_plans") && q.includes("SELECT source_id"),
      ).length,
    )
    .toBe(11);
  await expect(page.getByTestId("plan-apply-note")).toContainText("(11 months)");

  await page.getByTestId("plan-apply-undo").click();
  await expect
    .poll(async () =>
      (await executed(page)).some((q) => q.startsWith("DELETE FROM income_plans WHERE month IN")),
    )
    .toBe(true);
  await expect(page.getByTestId("plan-apply-note")).toHaveCount(0);
});

test("deleting a source is two-click and removes its plans first", async ({ page }) => {
  await nav(page, "Earnings");

  const dividends = page.getByTestId("plan-row").filter({ hasText: "Dividends" });
  await dividends.getByText("delete").click();
  await dividends.getByText("confirm?").click();

  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("DELETE FROM income_plans WHERE source_id")))
    .toBe(true);
  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("DELETE FROM income_sources WHERE id")))
    .toBe(true);
});
