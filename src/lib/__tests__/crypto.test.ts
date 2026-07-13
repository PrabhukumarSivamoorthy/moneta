import { describe, expect, it } from "vitest";
import { decryptText, encryptText, isEncryptedEnvelope } from "../crypto";

// PBKDF2 at 600k iterations is deliberately slow.
const TIMEOUT = 30_000;

describe("backup encryption", () => {
  it("round-trips plaintext and detects the envelope", { timeout: TIMEOUT }, async () => {
    const secret = JSON.stringify({ app: "moneta", data: { transactions: [{ merchant: "Whole Foods" }] } });
    const envelope = await encryptText("correct horse battery", secret);

    expect(isEncryptedEnvelope(envelope)).toBe(true);
    expect(isEncryptedEnvelope(secret)).toBe(false);
    // No plaintext leaks into the envelope.
    expect(envelope).not.toContain("Whole Foods");
    expect(envelope).not.toContain("transactions");

    expect(await decryptText("correct horse battery", envelope)).toBe(secret);
  });

  it("rejects a wrong password with a readable error", { timeout: TIMEOUT }, async () => {
    const envelope = await encryptText("right", "secret");
    await expect(decryptText("wrong", envelope)).rejects.toThrow(/Wrong password/);
  });

  it("rejects a tampered ciphertext (GCM authentication)", { timeout: TIMEOUT }, async () => {
    const envelope = JSON.parse(await encryptText("pw", "secret"));
    const bytes = atob(envelope.ciphertext);
    const flipped = String.fromCharCode(bytes.charCodeAt(0) ^ 0xff) + bytes.slice(1);
    envelope.ciphertext = btoa(flipped);
    await expect(decryptText("pw", JSON.stringify(envelope))).rejects.toThrow(/Wrong password|corrupted/);
  });

  it("uses fresh salt and IV every time", { timeout: TIMEOUT }, async () => {
    const a = JSON.parse(await encryptText("pw", "same"));
    const b = JSON.parse(await encryptText("pw", "same"));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
