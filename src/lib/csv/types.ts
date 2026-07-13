/**
 * A bank profile's mapping from CSV columns to transaction fields.
 * Either `amount` (single signed column) or the `debit`/`credit` pair
 * (two unsigned columns) must be set.
 */
export interface ColumnMap {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
}

// MM/DD/YY covers 2-digit-year statements like Discover ("5/2/25"); the
// year expands to 20YY.
export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "MM/DD/YY" | "DD.MM.YYYY";

/** How the bank represents money leaving the account in the amount column. */
export type SignConvention = "debits_negative" | "debits_positive";

/** The parsing-relevant fields of a bank profile (mirrors bank_profiles). */
export interface BankProfileSpec {
  delimiter: string;
  dateFormat: DateFormat;
  columnMap: ColumnMap;
  signConvention: SignConvention;
}

/** One successfully parsed statement row. Amounts follow the app convention:
 * negative = money out, positive = money in. */
export interface ParsedRow {
  /** 1-based line number in the source file, for error reporting and review. */
  line: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  amountCents: number;
  merchantRaw: string;
}

/** A row that failed to parse. Never silently dropped. */
export interface ParseError {
  line: number;
  reason: string;
  /** The raw line content, so the user can see what failed. */
  raw: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
}
