/**
 * Lent & borrowed bookkeeping. Entries are the transactions filed under the
 * "Lent & borrowed" system category; the counterparty is extracted from the
 * normalized merchant, and balances are all-time.
 *
 * Sign convention: money you sent (negative amount) means the person owes
 * you, so a person's balance = −Σ amounts. Positive balance = owed to you,
 * negative = you owe.
 */

export interface LendingEntry {
  date: string;
  amountCents: number;
  merchantNormalized: string;
  accountName: string;
}

export interface PersonLedger {
  person: string;
  /** Positive = they owe you, negative = you owe them. */
  balanceCents: number;
  entries: LendingEntry[];
}

/** "Zelle Payment To Sam K" → "Sam K"; ATM/cash entries group under "Cash". */
export function extractPerson(merchantNormalized: string): string {
  const m = merchantNormalized.trim();
  if (/\batm\b|cash/i.test(m) && !/zelle|venmo|paypal/i.test(m)) return "Cash";
  const transfer = /^(?:zelle|venmo|paypal|cash app)?\s*(?:payment)?\s*(?:to|from)\s+(.+)$/i.exec(
    m.replace(/^(zelle|venmo|paypal|cash app)\s+/i, "$1 "),
  );
  if (transfer) return transfer[1].trim();
  // "Zelle Payment To Sam K" without leading anchor match:
  const inner = /(?:to|from)\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)*)$/i.exec(m);
  if (inner) return inner[1].trim();
  return m;
}

export function groupByPerson(entries: readonly LendingEntry[]): PersonLedger[] {
  const byPerson = new Map<string, LendingEntry[]>();
  for (const e of entries) {
    const person = extractPerson(e.merchantNormalized);
    const list = byPerson.get(person) ?? [];
    list.push(e);
    byPerson.set(person, list);
  }
  return [...byPerson.entries()]
    .map(([person, list]) => ({
      person,
      balanceCents: -list.reduce((a, e) => a + e.amountCents, 0),
      entries: [...list].sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents));
}
