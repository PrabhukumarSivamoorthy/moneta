/**
 * Dev-only import smoke test, excluded from production builds by the
 * import.meta.env.DEV guard at the call site. Run with:
 *
 *   VITE_E2E=1 npm run tauri dev
 *
 * It drives the exact same code path as the Upload screen (parse →
 * normalize → dedup → commit) against the real SQLite database, logging
 * results to the webview console. Running it twice proves dedup: the second
 * run must skip every row.
 */
import { parseStatement } from "../lib/csv/parse";
import { normalizeMerchant } from "../lib/csv/normalize";
import { flagDuplicates } from "../lib/dedup";
import { applyRules } from "../lib/rules";
import { createAccount, listAccounts } from "../db/repo/accounts";
import { createBankProfile, listBankProfiles } from "../db/repo/bankProfiles";
import { listCategories } from "../db/repo/categories";
import { createRule, listRules } from "../db/repo/rules";
import { createUpload } from "../db/repo/uploads";
import {
  countTransactions,
  existingHashes,
  insertImported,
  queryTransactions,
} from "../db/repo/transactions";
import { budgetsForMonths, copyBudgets, setBudget } from "../db/repo/budgets";

const FIXTURE_CSV = `Transaction Date,Description,Amount
07/11/2026,WHOLEFDS #10233 SEATTLE WA,-84.27
07/10/2026,SHELL OIL 5744221 SEATTLE,-48.60
07/09/2026,SQ *BLUE BOTTLE COFFEE,-6.75
07/08/2026,"SMITH, JOHN ZELLE PAYMENT",-40.00
07/05/2026,ACME CORP DIRECT DEP PAYROLL,4250.00
07/11/2026,WHOLEFDS #10233 SEATTLE WA,-84.27
bad-date,BROKEN ROW,-1.00
07/01/2026,MISSING AMOUNT,`;

export async function runE2eImport(): Promise<void> {
  const log = (...args: unknown[]) => console.log("[e2e-import]", ...args);

  let account = (await listAccounts()).find((a) => a.name === "E2E Checking");
  account ??= await createAccount("E2E Checking", "checking");

  let profile = (await listBankProfiles()).find((p) => p.name === "E2E Chase");
  profile ??= await createBankProfile("E2E Chase", {
    delimiter: ",",
    dateFormat: "MM/DD/YYYY",
    columnMap: { date: "Transaction Date", description: "Description", amount: "Amount" },
    signConvention: "debits_negative",
  });

  // A correction-style rule so the import exercises the rules engine:
  // anything containing "wholefds" files under Groceries.
  const groceries = (await listCategories()).find((c) => c.name === "Groceries");
  if (groceries && !(await listRules()).some((r) => r.matcher === "wholefds")) {
    await createRule("wholefds", "contains", groceries.id, "correction");
  }
  const rules = await listRules();

  const before = await countTransactions();
  const parsed = parseStatement(FIXTURE_CSV, profile);
  log(`parsed rows=${parsed.rows.length} errors=${parsed.errors.length}`);
  parsed.errors.forEach((e) => log(`  error line ${e.line}: ${e.reason}`));

  const normalized = parsed.rows.map((r) => ({
    ...r,
    merchantNormalized: normalizeMerchant(r.merchantRaw),
  }));
  const flags = await flagDuplicates(
    normalized,
    account.id,
    await existingHashes(account.id),
  );
  const included = normalized
    .map((r, i) => ({ ...r, flags: flags[i] }))
    .filter((r) => !r.flags.duplicateOfDb && !r.flags.duplicateInFile);
  const skipped = normalized.length - included.length;
  log(`including=${included.length} skippedDuplicates=${skipped}`);

  if (included.length > 0) {
    const uploadId = await createUpload(
      account.id,
      profile.id,
      "e2e-fixture.csv",
      included.length,
    );
    await insertImported(
      uploadId,
      account.id,
      included.map((r) => ({
        date: r.date,
        amountCents: r.amountCents,
        merchantRaw: r.merchantRaw,
        merchantNormalized: r.merchantNormalized,
        dedupHash: r.flags.hash,
        categoryId: applyRules(rules, r.merchantNormalized),
      })),
    );
  }
  const after = await countTransactions();
  log(`transactions before=${before} after=${after}`);

  // Read back through the period-scoped query to verify rule categorization.
  const rows = await queryTransactions({ start: "2026-07-01", end: "2026-07-31" });
  const ruled = rows.filter((r) => r.categorizationSource === "rule");
  ruled.forEach((r) => log(`  rule-categorized: ${r.merchantNormalized} → ${r.categoryName}`));
  // Budgets repo round-trip: set June, copy June → July, read both back.
  if (groceries) {
    await setBudget(groceries.id, "2026-06", 52000);
    await setBudget(groceries.id, "2026-06", 54000); // upsert overwrites
    const copiedCount = await copyBudgets("2026-06", "2026-07");
    const budgetRows = await budgetsForMonths(["2026-06", "2026-07"]);
    log(
      `budgets: copied=${copiedCount} rows=${budgetRows
        .map((b) => `${b.month}=$${b.amountCents / 100}`)
        .join(", ")}`,
    );
  }

  log("RESULT", {
    inserted: after - before,
    skipped,
    errors: parsed.errors.length,
    ruleCategorized: ruled.length,
  });
}
