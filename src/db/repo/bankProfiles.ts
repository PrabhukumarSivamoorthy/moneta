import { getDb } from "../client";
import type {
  BankProfileSpec,
  ColumnMap,
  DateFormat,
  SignConvention,
} from "../../lib/csv/types";

export interface BankProfile extends BankProfileSpec {
  id: number;
  name: string;
}

interface Row {
  id: number;
  name: string;
  delimiter: string;
  date_format: string;
  column_map_json: string;
  sign_convention: string;
}

function fromRow(r: Row): BankProfile {
  return {
    id: r.id,
    name: r.name,
    delimiter: r.delimiter,
    dateFormat: r.date_format as DateFormat,
    columnMap: JSON.parse(r.column_map_json) as ColumnMap,
    signConvention: r.sign_convention as SignConvention,
  };
}

export async function listBankProfiles(): Promise<BankProfile[]> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    "SELECT id, name, delimiter, date_format, column_map_json, sign_convention FROM bank_profiles ORDER BY name",
  );
  return rows.map(fromRow);
}

export async function createBankProfile(
  name: string,
  spec: BankProfileSpec,
): Promise<BankProfile> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO bank_profiles (name, delimiter, date_format, column_map_json, sign_convention) VALUES ($1, $2, $3, $4, $5)",
    [name, spec.delimiter, spec.dateFormat, JSON.stringify(spec.columnMap), spec.signConvention],
  );
  return { id: res.lastInsertId as number, name, ...spec };
}

export async function updateBankProfile(
  id: number,
  name: string,
  spec: BankProfileSpec,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE bank_profiles SET name = $1, delimiter = $2, date_format = $3, column_map_json = $4, sign_convention = $5 WHERE id = $6",
    [name, spec.delimiter, spec.dateFormat, JSON.stringify(spec.columnMap), spec.signConvention, id],
  );
}
