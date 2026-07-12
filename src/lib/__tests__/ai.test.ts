import { describe, expect, it } from "vitest";
import {
  AI_MODEL,
  buildCategorizeRequest,
  buildExtractRequest,
  parseCategorizeResponse,
  parseExtractResponse,
} from "../ai";

describe("buildCategorizeRequest", () => {
  it("sends ONLY id, merchant, and amount — extra row fields never leak", () => {
    const leakyRow = {
      id: 7,
      merchant: "Netflix.com",
      amountCents: -1549,
      // Fields that must never reach the wire:
      date: "2026-07-09",
      accountName: "Chase Checking",
      dedupHash: "abc123",
    };
    const body = JSON.stringify(buildCategorizeRequest([leakyRow], ["Subscriptions"]));
    expect(body).toContain("Netflix.com");
    expect(body).not.toContain("2026-07-09");
    expect(body).not.toContain("Chase Checking");
    expect(body).not.toContain("abc123");
  });

  it("forces the categorize tool with the user's categories as an enum", () => {
    const req = buildCategorizeRequest([{ id: 1, merchant: "M", amountCents: -1 }], ["Dining", "Travel"]) as {
      model: string;
      tool_choice: { type: string; name: string };
      tools: { input_schema: { properties: { assignments: { items: { properties: { category: { enum: string[] } } } } } } }[];
    };
    expect(req.model).toBe(AI_MODEL);
    expect(req.tool_choice).toEqual({ type: "tool", name: "categorize" });
    expect(req.tools[0].input_schema.properties.assignments.items.properties.category.enum).toEqual(["Dining", "Travel"]);
  });
});

describe("parseCategorizeResponse", () => {
  const response = {
    content: [
      { type: "text", text: "thinking…" },
      {
        type: "tool_use",
        name: "categorize",
        input: {
          assignments: [
            { id: 1, category: "Dining" },
            { id: 2, category: "Nonsense Category" }, // invalid category
            { id: 999, category: "Dining" }, // unknown id
            { id: "3", category: "Dining" }, // wrong type
          ],
        },
      },
    ],
  };

  it("keeps only known ids with known categories", () => {
    const map = parseCategorizeResponse(response, new Set([1, 2, 3]), new Set(["Dining", "Travel"]));
    expect([...map.entries()]).toEqual([[1, "Dining"]]);
  });

  it("returns empty on malformed bodies without throwing", () => {
    expect(parseCategorizeResponse(null, new Set(), new Set()).size).toBe(0);
    expect(parseCategorizeResponse({ content: "nope" }, new Set(), new Set()).size).toBe(0);
  });
});

describe("PDF extraction", () => {
  it("builds a document block with a forced extract_rows tool", () => {
    const req = buildExtractRequest("QkFTRTY0") as {
      messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[];
      tool_choice: { name: string };
    };
    expect(req.messages[0].content[0].type).toBe("document");
    expect(req.messages[0].content[0].source?.media_type).toBe("application/pdf");
    expect(req.messages[0].content[0].source?.data).toBe("QkFTRTY0");
    expect(req.tool_choice.name).toBe("extract_rows");
  });

  it("validates rows into the CSV ParseResult shape, keeping bad rows as errors", () => {
    const result = parseExtractResponse({
      content: [
        {
          type: "tool_use",
          name: "extract_rows",
          input: {
            rows: [
              { date: "2026-07-11", description: "WHOLEFDS #10233", amount_cents: -8427 },
              { date: "not-a-date", description: "BAD", amount_cents: -1 },
              { date: "2026-07-05", description: "", amount_cents: -1 },
              { date: "2026-07-05", description: "FLOAT", amount_cents: 12.5 },
            ],
          },
        },
      ],
    });
    expect(result.rows).toEqual([{ line: 1, date: "2026-07-11", amountCents: -8427, merchantRaw: "WHOLEFDS #10233" }]);
    expect(result.errors.map((e) => e.reason)).toEqual([
      'Unparseable date "not-a-date"',
      "Empty description",
      'Unparseable amount "12.5"',
    ]);
  });

  it("reports malformed bodies as an error, never throwing", () => {
    expect(parseExtractResponse(null).errors[0].reason).toBe("Malformed extraction response");
  });
});
