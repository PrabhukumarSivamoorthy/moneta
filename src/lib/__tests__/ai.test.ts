import { describe, expect, it } from "vitest";
import { AI_MODEL, buildCategorizeRequest, parseCategorizeResponse } from "../ai";

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
