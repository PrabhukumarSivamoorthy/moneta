import { test, expect, nav, executed, aiCalls } from "./support/helpers";

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

test("Transactions: ledger renders known rows with amounts", async ({ page }) => {
  await nav(page, "Transactions");

  const sushi = page.getByTestId("tx-row").filter({ hasText: "Sushi Kashiba" });
  await expect(sushi).toBeVisible();
  await expect(sushi).toContainText("-$386.42"); // formatCents(-38642)

  const camber = page.getByTestId("tx-row").filter({ hasText: "Camber Prop Mgmt" });
  await expect(camber).toBeVisible();
  await expect(camber).toContainText("-$1,800.00"); // formatCents(-180000)
});

test("Transactions: Luxury tier filter narrows to luxury rows", async ({ page }) => {
  await nav(page, "Transactions");
  await expect(page.getByTestId("tx-row").filter({ hasText: "Whole Foods" })).toBeVisible();

  // The tier filter is the only select carrying the "untiered" option.
  const tierSelect = page.locator("select").filter({ has: page.locator('option[value="untiered"]') });
  await tierSelect.selectOption("luxury");

  // Uniqlo (Shopping default luxury) and Zelle Maya Lunch (Dining with a
  // luxury tier_override) survive; the need-tier Whole Foods row is gone.
  await expect(page.getByTestId("tx-row").filter({ hasText: "Uniqlo" })).toBeVisible();
  await expect(page.getByTestId("tx-row").filter({ hasText: "Zelle Maya Lunch" })).toBeVisible();
  await expect(page.getByTestId("tx-row").filter({ hasText: "Whole Foods" })).toHaveCount(0);
});

test("Transactions: inline recategorize offers a rule and writes it", async ({ page }) => {
  await nav(page, "Transactions");

  const netflixRow = page.getByTestId("tx-row").filter({ hasText: "Netflix.com" });
  await netflixRow.locator("select").selectOption({ label: "Subscriptions" });

  // Correction banner appears; persisting it issues an INSERT INTO rules.
  await expect(page.getByText(/Always file/)).toBeVisible();
  await expect(page.getByText(/under\s+Subscriptions/)).toBeVisible();

  await page.getByRole("button", { name: "Create rule" }).click();

  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("INSERT INTO rules")))
    .toBe(true);
  // Creating the rule immediately files matching uncategorized entries.
  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("UPDATE transactions SET category_id")))
    .toBe(true);
});

test("Transactions: AI suggestions accept and keep the request private", async ({ page }) => {
  await nav(page, "Transactions");

  await page.getByRole("button", { name: "Suggest categories (AI)" }).click();

  // A "→ Subscriptions" chip lands on both uncategorized rows.
  await expect(page.getByText("→ Subscriptions")).toHaveCount(2);
  const accepts = page.locator('span[title="Accept suggestion"]');
  await expect(accepts).toHaveCount(2);

  // Privacy: the request carries merchant names but no dates and no account.
  const calls = await aiCalls(page);
  expect(calls.length).toBeGreaterThan(0);
  const body = calls[calls.length - 1];
  expect(body).toContain("Netflix.com");
  expect(body).toContain("Spotify USA");
  expect(body).not.toMatch(/20\d\d-\d\d-\d\d/);
  expect(body).not.toContain("Chase Checking");

  // Accepting one suggestion updates that transaction's category.
  await accepts.first().click();
  await expect
    .poll(async () => (await executed(page)).some((q) => q.startsWith("UPDATE transactions SET category_id")))
    .toBe(true);
});

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

const budgetRow = "div[class*=\"grid-cols-[44px\"]";

test("Budgets: spend, over-budget, totals and tier targets", async ({ page }) => {
  await nav(page, "Budgets");

  // Housing: $1,800.00 spent against a $1,900.00 budget (input shows 1900.00).
  const housing = page.locator(budgetRow, { hasText: "Housing" });
  await expect(housing).toContainText("$1,800.00");
  await expect(housing.locator("input")).toHaveValue("1900.00");

  // Dining is over budget: spend $501.12 (38642+9620+1850, incl. the
  // luxury-override Zelle row which still counts as Dining) vs $320.00 budget,
  // so LEFT = -$181.12.
  const dining = page.locator(budgetRow, { hasText: "Dining" });
  await expect(dining).toContainText("$501.12");
  await expect(dining).toContainText("-$181.12");

  await expect(page.locator(budgetRow, { hasText: "TOTAL" })).toBeVisible();

  // Tier targets 50 / 30 / 20 with actual percentages.
  const targetInputs = page.locator('input[class*="text-[16px]"]');
  await expect(targetInputs).toHaveCount(3);
  await expect(targetInputs.nth(0)).toHaveValue("50");
  await expect(targetInputs.nth(1)).toHaveValue("30");
  await expect(targetInputs.nth(2)).toHaveValue("20");
  await expect(page.getByText("actual").first()).toBeVisible();
});

test("Budgets: copy button enabled in month, prorated in week", async ({ page }) => {
  await nav(page, "Budgets");

  const copy = page.getByRole("button", { name: "Copy last month's budgets" });
  await expect(copy).toBeEnabled();
  await expect(page.getByText("BUDGET /MO")).toBeVisible();

  // Switch the global period bar to WEEK.
  await page.getByText("WEEK", { exact: true }).click();

  await expect(copy).toBeDisabled();
  await expect(page.getByText("PRORATED", { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

test("Dashboard: MIX view shows tier cards vs targets", async ({ page }) => {
  await nav(page, "Dashboard");

  await expect(page.getByText("TIER MIX — SPEND VS TARGET")).toBeVisible();
  // "target 50%" also appears in the tier-trend legend, so scope to the first.
  await expect(page.getByText("target 50%").first()).toBeVisible();
  await expect(page.getByText("target 30%")).toBeVisible();
  await expect(page.getByText("target 20%")).toBeVisible();

  // Actual shares derived from the stub: need 73.1 / comfortable 18.2 / luxury 8.7.
  await expect(page.getByText("73.1%")).toBeVisible();
  await expect(page.getByText("18.2%")).toBeVisible();
  await expect(page.getByText("8.7%")).toBeVisible();
});

test("Dashboard: BREAKDOWN alerts count and category expand", async ({ page }) => {
  await nav(page, "Dashboard");
  await page.getByText("BREAKDOWN", { exact: true }).click();

  await expect(page.getByText("SPENT VS PLANNED")).toBeVisible();
  // Alerts = categories at/over 80% of budget: Housing, Dining, Shopping.
  await expect(page.getByText("Alerts (3)")).toBeVisible();

  // Expand the Dining row to see its 3 entries.
  await page.locator('div[title="Show Dining transactions"]').click();
  await expect(page.getByText("3 entries")).toBeVisible();
  await expect(page.getByText("Sushi Kashiba")).toBeVisible();
});
