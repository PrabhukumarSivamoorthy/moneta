/**
 * Password-based encryption for backups. WebCrypto only (no dependencies):
 * PBKDF2-SHA-256 (600k iterations, random 16-byte salt) derives an
 * AES-256-GCM key (random 12-byte IV). GCM is authenticated, so a wrong
 * password or a tampered file fails loudly instead of decrypting garbage.
 *
 * The envelope is itself JSON, so the restore picker can open either kind
 * of file and detect which it got.
 */

export interface EncryptedEnvelope {
  app: "moneta";
  format: "encrypted-backup";
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
}

const ITERATIONS = 600_000;

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt plaintext into an envelope JSON string. */
export async function encryptText(password: string, plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope: EncryptedEnvelope = {
    app: "moneta",
    format: "encrypted-backup",
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: toB64(salt) },
    iv: toB64(iv),
    ciphertext: toB64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope, null, 2);
}

/** True when the JSON string is an encrypted-backup envelope. */
export function isEncryptedEnvelope(json: string): boolean {
  try {
    const e = JSON.parse(json) as Partial<EncryptedEnvelope>;
    return e?.app === "moneta" && e?.format === "encrypted-backup";
  } catch {
    return false;
  }
}

/** Decrypt an envelope back to plaintext. Throws readable errors. */
export async function decryptText(password: string, json: string): Promise<string> {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(json) as EncryptedEnvelope;
  } catch {
    throw new Error("Not an encrypted backup file.");
  }
  if (envelope.format !== "encrypted-backup") throw new Error("Not an encrypted backup file.");
  if (envelope.version !== 1) throw new Error(`Encrypted backup version ${String(envelope.version)} is not supported.`);
  const key = await deriveKey(password, fromB64(envelope.kdf.salt), envelope.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(envelope.iv) as BufferSource },
      key,
      fromB64(envelope.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong password (or the file is corrupted).");
  }
}
