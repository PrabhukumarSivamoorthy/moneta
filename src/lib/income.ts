/** Income source-type classification for the Earnings screen. */

export type IncomeType = "Payroll" | "Dividends & interest" | "Other";

export function classifyIncome(merchantNormalized: string): IncomeType {
  const m = merchantNormalized.toLowerCase();
  if (/payroll|salary|direct dep|paycheck/.test(m)) return "Payroll";
  if (/dividend|interest|div\b|yield/.test(m)) return "Dividends & interest";
  return "Other";
}
