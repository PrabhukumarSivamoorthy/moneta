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
import { createAccount, listAccounts } from "../db/repo/accounts";
import { createBankProfile, listBankProfiles } from "../db/repo/bankProfiles";
import { createUpload } from "../db/repo/uploads";
import {
  countTransactions,
  existingHashes,
  insertImported,
} from "../db/repo/transactions";

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
      })),
    );
  }
  const after = await countTransactions();
  log(`transactions before=${before} after=${after}`);
  log("RESULT", { inserted: after - before, skipped, errors: parsed.errors.length });
}
