/**
 * Money is always stored and computed as integer cents.
 * Parsing and formatting go through strings — never float arithmetic —
 * so amounts like "8.20" cannot drift to 819 or 821.
 */

/**
 * Parse a user- or CSV-supplied decimal amount into integer cents.
 * Accepts optional leading sign, thousands separators, and up to two
 * decimal places ("-1,234.5" → -123450).
 * Returns null for anything that does not parse cleanly.
 */
export function parseAmountToCents(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, "");
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return sign === "-" ? -cents : cents;
}

/** The currency every formatCents call renders in. Set once at app start
 * from the settings table and again when the user changes the setting —
 * so the option actually changes what the screens show. */
let displayCurrency = "USD";

export function setDisplayCurrency(code: string): void {
  displayCurrency = code;
}

/** Format integer cents as a currency string, e.g. 123456 → "$1,234.56". */
export function formatCents(cents: number, currency = displayCurrency): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number(`${whole}.${frac}`));
  return negative ? `-${formatted}` : formatted;
}

/** Plain decimal string without currency symbol, e.g. -8450 → "-84.50". */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
