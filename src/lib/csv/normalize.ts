/**
 * Merchant normalization: strip common payment-processor prefixes,
 * reference/store numbers, and phone numbers; collapse whitespace;
 * title-case. The raw string is always stored alongside the normalized one.
 */

/** Processor / channel prefixes that carry no merchant identity. */
const PREFIXES: RegExp[] = [
  /^SQ \*/i, // Square
  /^TST\* ?/i, // Toast
  /^PAYPAL \*/i,
  /^PP\* ?/i,
  /^POS (?:DEBIT|PURCHASE) /i,
  /^(?:DEBIT|CREDIT) CARD PURCHASE /i,
  /^CHECKCARD /i,
  /^ACH (?:DEBIT|CREDIT) /i,
];

/** Words kept fully uppercase when title-casing. */
const KEEP_UPPER = new Set(["USA", "ATM", "LLC", "INC", "US", "NW", "NE", "SW", "SE"]);

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => {
      const upper = w.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      if (/^\d/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** True for tokens that are reference noise rather than merchant identity. */
function isReferenceToken(t: string): boolean {
  if (/^#\d+$/.test(t)) return true; // store numbers: #130
  if (/^\d{4,}$/.test(t)) return true; // long digit runs: 00234, 10233
  // Mixed alphanumeric reference codes like RT4Y82ZL3 — must contain both
  // letters and digits so real words and street numbers survive.
  if (/^[A-Za-z0-9]{6,}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t)) return true;
  return false;
}

export function normalizeMerchant(raw: string): string {
  let s = raw.trim();

  for (const p of PREFIXES) s = s.replace(p, "");
  s = s.replace(/\*/g, " "); // processor separators: AMZN Mktp US*RT4Y82ZL3
  s = s.replace(/\b\d{3}-\d{3}-\d{4}\b/g, " "); // phone numbers

  const cleaned = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !isReferenceToken(t))
    .join(" ");

  if (!cleaned) return titleCase(raw.trim().replace(/\s+/g, " "));
  return titleCase(cleaned);
}
