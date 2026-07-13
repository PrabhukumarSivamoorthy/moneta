/**
 * Encrypted backup round-trip through the real UI: export with a password
 * (AES-256-GCM envelope, no plaintext leakage), then restore that same
 * envelope — wrong password rejected, right password reaches the preview.
 */
import { test, expect, nav, written, executed } from "./support/helpers";

test("password export produces an envelope and restores only with the right password", async ({ page }) => {
  test.setTimeout(60_000); // PBKDF2 runs three times in this test

  await nav(page, "Settings");

  // Export with a password.
  await page.getByPlaceholder("optional — empty = plain backup").fill("hunter2-but-long");
  await page.getByRole("button", { name: "Export JSON backup" }).click();
  await expect(page.getByText(/✓ encrypted backup saved to/)).toBeVisible();

  const [file] = await written(page);
  const envelope = JSON.parse(file.contents);
  expect(envelope.format).toBe("encrypted-backup");
  expect(envelope.kdf.name).toBe("PBKDF2");
  // Nothing readable leaks: no table names, no merchants, no amounts.
  expect(file.contents).not.toContain("transactions");
  expect(file.contents).not.toContain("Chase Checking");
  expect(file.contents).not.toContain("Whole Foods");

  // Serve that envelope back through the restore picker.
  await page.evaluate((c) => {
    (window as unknown as { __backupFile: string }).__backupFile = c;
  }, file.contents);
  await page.getByRole("button", { name: "Restore from backup…" }).click();
  await expect(page.getByText("ENCRYPTED BACKUP")).toBeVisible();

  // Wrong password: readable error, nothing written.
  await page.getByPlaceholder("backup password").fill("wrong");
  await page.getByRole("button", { name: "Decrypt" }).click();
  await expect(page.getByText(/Wrong password/)).toBeVisible();
  expect((await executed(page)).some((q) => q.startsWith("DELETE"))).toBe(false);

  // Right password: decrypts into the normal replace-everything preview.
  await page.getByPlaceholder("backup password").fill("hunter2-but-long");
  await page.getByRole("button", { name: "Decrypt" }).click();
  await expect(page.getByText("RESTORE REPLACES EVERYTHING CURRENTLY IN THE LEDGER")).toBeVisible();

  await page.getByRole("button", { name: "Replace ledger with this backup" }).click();
  await expect(page.getByText(/ledger restored from/)).toBeVisible();
  const writes = await executed(page);
  expect(writes.some((q) => q.startsWith("INSERT INTO transactions"))).toBe(true);
});
