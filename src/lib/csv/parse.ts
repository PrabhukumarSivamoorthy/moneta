import { parseAmountToCents } from "../money";
import type {
  BankProfileSpec,
  DateFormat,
  ParsedRow,
  ParseError,
  ParseResult,
} from "./types";

/**
 * Minimal RFC-4180 CSV reader: quoted fields, escaped quotes (""),
 * newlines inside quotes, configurable delimiter. Returns rows of fields;
 * blank lines are skipped.
 */
export function readCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip rows that are entirely empty (blank lines).
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

const DATE_PATTERNS: Record<DateFormat, RegExp> = {
  "YYYY-MM-DD": /^(\d{4})-(\d{2})-(\d{2})$/,
  "MM/DD/YYYY": /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  "MM/DD/YY": /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
  "DD.MM.YYYY": /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
};

/** Parse a date string in the given format to ISO YYYY-MM-DD, or null. */
export function parseDate(value: string, format: DateFormat): string | null {
  const m = DATE_PATTERNS[format].exec(value.trim());
  if (!m) return null;
  let y: number, mo: number, d: number;
  switch (format) {
    case "YYYY-MM-DD":
      [y, mo, d] = [+m[1], +m[2], +m[3]];
      break;
    case "MM/DD/YYYY":
      [y, mo, d] = [+m[3], +m[1], +m[2]];
      break;
    case "MM/DD/YY":
      [y, mo, d] = [2000 + +m[3], +m[1], +m[2]];
      break;
    case "DD.MM.YYYY":
      [y, mo, d] = [+m[3], +m[2], +m[1]];
      break;
  }
  if (mo < 1 || mo > 12) return null;
  const daysInMonth = new Date(y, mo, 0).getDate();
  if (d < 1 || d > daysInMonth) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse a statement file using a bank profile: locate the mapped columns in
 * the header row, then convert each data row to a ParsedRow. Rows that fail
 * go to the error list with a reason — never silently dropped.
 *
 * Amount normalization to the app convention (negative = money out):
 * - Single amount column, debits_negative: taken as-is.
 * - Single amount column, debits_positive: sign flipped.
 * - Debit/credit pair: debit → negative, credit → positive, regardless of
 *   sign convention; a row with values in both columns is an error.
 */
export function parseStatement(
  text: string,
  spec: BankProfileSpec,
): ParseResult {
  const raw = readCsv(text, spec.delimiter);
  if (raw.length === 0) {
    return { rows: [], errors: [{ line: 1, reason: "File is empty", raw: "" }] };
  }

  const header = raw[0].map((h) => h.trim());
  const col = (name: string) =>
    header.findIndex((h) => h.toLowerCase() === name.trim().toLowerCase());

  const map = spec.columnMap;
  const dateIdx = col(map.date);
  const descIdx = col(map.description);
  const missing: string[] = [];
  if (dateIdx < 0) missing.push(map.date);
  if (descIdx < 0) missing.push(map.description);

  const twoColumn = !map.amount;
  let amountIdx = -1;
  let debitIdx = -1;
  let creditIdx = -1;
  if (twoColumn) {
    debitIdx = map.debit ? col(map.debit) : -1;
    creditIdx = map.credit ? col(map.credit) : -1;
    if (debitIdx < 0) missing.push(map.debit ?? "(debit column unset)");
    if (creditIdx < 0) missing.push(map.credit ?? "(credit column unset)");
  } else {
    amountIdx = col(map.amount!);
    if (amountIdx < 0) missing.push(map.amount!);
  }

  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          reason: `Missing column(s) in header: ${missing.join(", ")}`,
          raw: raw[0].join(spec.delimiter),
        },
      ],
    };
  }

  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    const line = r + 1;
    const rawLine = cells.join(spec.delimiter);
    const fail = (reason: string) => errors.push({ line, reason, raw: rawLine });

    // Ignore rows with no content at all (blank lines, or spacer/trailer
    // rows that are just delimiters like ",,,,") — silently, not as errors.
    if (cells.every((c) => c.trim() === "")) continue;

    const dateStr = cells[dateIdx] ?? "";
    const date = parseDate(dateStr, spec.dateFormat);
    if (!date) {
      fail(`Unparseable date "${dateStr}" (expected ${spec.dateFormat})`);
      continue;
    }

    const merchantRaw = (cells[descIdx] ?? "").trim();
    if (!merchantRaw) {
      fail("Empty description");
      continue;
    }

    let amountCents: number;
    if (twoColumn) {
      const debitStr = (cells[debitIdx] ?? "").trim();
      const creditStr = (cells[creditIdx] ?? "").trim();
      if (debitStr && creditStr) {
        fail("Both debit and credit have values");
        continue;
      }
      if (!debitStr && !creditStr) {
        fail("Neither debit nor credit has a value");
        continue;
      }
      const cents = parseAmountToCents(debitStr || creditStr);
      if (cents === null) {
        fail(`Unparseable amount "${debitStr || creditStr}"`);
        continue;
      }
      amountCents = debitStr ? -Math.abs(cents) : Math.abs(cents);
    } else {
      const amountStr = (cells[amountIdx] ?? "").trim();
      const cents = parseAmountToCents(amountStr);
      if (cents === null) {
        fail(`Unparseable amount "${amountStr}"`);
        continue;
      }
      amountCents = spec.signConvention === "debits_positive" ? -cents : cents;
    }

    rows.push({ line, date, amountCents, merchantRaw });
  }

  return { rows, errors };
}
