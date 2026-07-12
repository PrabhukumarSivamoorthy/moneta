/**
 * AI categorization assist. Strictly opt-in; the request contains ONLY the
 * transaction id, merchant string, and amount — never dates, account names,
 * or balances. Responses are suggestions that pass through review; nothing
 * here writes to the ledger.
 *
 * Strict JSON is enforced by forcing a tool call with a schema whose
 * category values are an enum of the user's actual categories.
 */

export const AI_MODEL = "claude-haiku-4-5";
export const AI_BATCH_SIZE = 50;

export interface AiItem {
  id: number;
  merchant: string;
  amountCents: number;
}

/** Build one Messages-API request body. Pure, so tests can assert exactly
 * what leaves the machine. */
export function buildCategorizeRequest(
  items: readonly AiItem[],
  categories: readonly string[],
): Record<string, unknown> {
  // Copy field-by-field: whatever else a caller's row object carries must
  // never reach the wire.
  const lines = items.map((i) => ({
    id: i.id,
    merchant: i.merchant,
    amount: i.amountCents,
  }));
  return {
    model: AI_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content:
          "Assign each bank transaction to the best-fitting category from the allowed list, judging by the merchant name. Amounts are integer cents; negative means money spent. Omit a transaction if no category fits.\n\n" +
          `Transactions: ${JSON.stringify(lines)}`,
      },
    ],
    tools: [
      {
        name: "categorize",
        description: "Report the category assignment for each transaction.",
        input_schema: {
          type: "object",
          properties: {
            assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  category: { type: "string", enum: [...categories] },
                },
                required: ["id", "category"],
              },
            },
          },
          required: ["assignments"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "categorize" },
  };
}

/** Extract id → category from a Messages-API response, dropping anything
 * that isn't a known transaction id or a known category. */
export function parseCategorizeResponse(
  body: unknown,
  validIds: ReadonlySet<number>,
  validCategories: ReadonlySet<string>,
): Map<number, string> {
  const out = new Map<number, string>();
  const content = (body as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    const b = block as { type?: string; name?: string; input?: { assignments?: unknown[] } };
    if (b.type !== "tool_use" || b.name !== "categorize") continue;
    for (const a of b.input?.assignments ?? []) {
      const { id, category } = a as { id?: unknown; category?: unknown };
      if (typeof id === "number" && typeof category === "string" && validIds.has(id) && validCategories.has(category)) {
        out.set(id, category);
      }
    }
  }
  return out;
}

// ---------- PDF statement extraction ----------
//
// Unlike categorization (merchant + amount only), extraction sends the
// STATEMENT DOCUMENT ITSELF to the API. Callers must obtain explicit
// per-file consent before invoking extractStatementPdf — the Upload screen
// shows a consent dialog naming the file every single time.

import { parseDate } from "./csv/parse";
import type { ParseResult } from "./csv/types";

/** Build the extraction request: PDF as a document block plus a forced
 * tool whose schema pins the row shape. */
export function buildExtractRequest(pdfBase64: string): Record<string, unknown> {
  return {
    model: AI_MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          {
            type: "text",
            text: "Extract every transaction row from this bank statement. Dates as YYYY-MM-DD; amounts as signed integer cents with negative = money out of the account. Skip running-balance columns, summaries, and headers.",
          },
        ],
      },
    ],
    tools: [
      {
        name: "extract_rows",
        description: "Report every transaction found in the statement.",
        input_schema: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string", description: "YYYY-MM-DD" },
                  description: { type: "string" },
                  amount_cents: { type: "integer", description: "negative = money out" },
                },
                required: ["date", "description", "amount_cents"],
              },
            },
          },
          required: ["rows"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_rows" },
  };
}

/** Validate extracted rows into the same ParseResult shape the CSV parser
 * produces, so review/dedup/commit are identical for both paths. Invalid
 * rows land in the error list — never silently dropped. */
export function parseExtractResponse(body: unknown): ParseResult {
  const result: ParseResult = { rows: [], errors: [] };
  const content = (body as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) {
    result.errors.push({ line: 1, reason: "Malformed extraction response", raw: "" });
    return result;
  }
  let line = 0;
  for (const block of content) {
    const b = block as { type?: string; name?: string; input?: { rows?: unknown[] } };
    if (b.type !== "tool_use" || b.name !== "extract_rows") continue;
    for (const raw of b.input?.rows ?? []) {
      line++;
      const r = raw as { date?: unknown; description?: unknown; amount_cents?: unknown };
      const rawStr = JSON.stringify(raw);
      const date = typeof r.date === "string" ? parseDate(r.date, "YYYY-MM-DD") : null;
      if (!date) {
        result.errors.push({ line, reason: `Unparseable date "${String(r.date)}"`, raw: rawStr });
        continue;
      }
      if (typeof r.description !== "string" || !r.description.trim()) {
        result.errors.push({ line, reason: "Empty description", raw: rawStr });
        continue;
      }
      if (typeof r.amount_cents !== "number" || !Number.isSafeInteger(r.amount_cents)) {
        result.errors.push({ line, reason: `Unparseable amount "${String(r.amount_cents)}"`, raw: rawStr });
        continue;
      }
      result.rows.push({ line, date, amountCents: r.amount_cents, merchantRaw: r.description.trim() });
    }
  }
  return result;
}

/** Send the PDF for extraction. Call ONLY after explicit per-file consent. */
export async function extractStatementPdf(apiKey: string, pdfBase64: string): Promise<ParseResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(buildExtractRequest(pdfBase64)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  return parseExtractResponse(await res.json());
}

/** Batch all items through the API. Suggestions only — the caller shows
 * them for review and the user accepts or rejects each one. */
export async function suggestCategories(
  apiKey: string,
  items: readonly AiItem[],
  categories: readonly string[],
): Promise<Map<number, string>> {
  const validIds = new Set(items.map((i) => i.id));
  const validCategories = new Set(categories);
  const out = new Map<number, string>();
  for (let start = 0; start < items.length; start += AI_BATCH_SIZE) {
    const batch = items.slice(start, start + AI_BATCH_SIZE);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(buildCategorizeRequest(batch, categories)),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 200)}`);
    }
    for (const [id, cat] of parseCategorizeResponse(await res.json(), validIds, validCategories)) {
      out.set(id, cat);
    }
  }
  return out;
}
