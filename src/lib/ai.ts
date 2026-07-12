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
