import { describe, expect, it } from "vitest";
import { dedupHash, flagDuplicates } from "../dedup";

describe("dedupHash", () => {
  it("produces a stable 64-char hex sha256", async () => {
    const h = await dedupHash(1, "2026-07-11", -8427, "Wholefds Seattle Wa");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await dedupHash(1, "2026-07-11", -8427, "Wholefds Seattle Wa")).toBe(h);
  });

  it("changes when any component changes", async () => {
    const base = await dedupHash(1, "2026-07-11", -8427, "M");
    expect(await dedupHash(2, "2026-07-11", -8427, "M")).not.toBe(base);
    expect(await dedupHash(1, "2026-07-12", -8427, "M")).not.toBe(base);
    expect(await dedupHash(1, "2026-07-11", -8428, "M")).not.toBe(base);
    expect(await dedupHash(1, "2026-07-11", -8427, "N")).not.toBe(base);
  });
});

describe("flagDuplicates", () => {
  const row = (date: string, amountCents: number, merchantNormalized = "Shop") => ({
    date,
    amountCents,
    merchantNormalized,
  });

  it("flags matches against existing ledger hashes", async () => {
    const existing = new Set([await dedupHash(1, "2026-07-01", -1000, "Shop")]);
    const flags = await flagDuplicates(
      [row("2026-07-01", -1000), row("2026-07-02", -1000)],
      1,
      existing,
    );
    expect(flags[0].duplicateOfDb).toBe(true);
    expect(flags[1].duplicateOfDb).toBe(false);
  });

  it("flags later duplicates within the same file, not the first occurrence", async () => {
    const flags = await flagDuplicates(
      [row("2026-07-01", -1000), row("2026-07-01", -1000), row("2026-07-01", -1000)],
      1,
      new Set(),
    );
    expect(flags.map((f) => f.duplicateInFile)).toEqual([false, true, true]);
  });

  it("keys duplicates to the account", async () => {
    const existing = new Set([await dedupHash(1, "2026-07-01", -1000, "Shop")]);
    const flags = await flagDuplicates([row("2026-07-01", -1000)], 2, existing);
    expect(flags[0].duplicateOfDb).toBe(false);
  });
});
