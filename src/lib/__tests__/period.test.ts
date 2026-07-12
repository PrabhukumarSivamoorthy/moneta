import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  monthsInRange,
  prorateBudget,
  resolvePeriod,
} from "../period";

const TODAY = "2026-07-11"; // a Saturday

describe("date helpers", () => {
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29"); // leap year
  });

  it("daysBetween is inclusive", () => {
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(1);
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(31);
  });
});

describe("resolvePeriod — month", () => {
  it("resolves the current month with day-of pace", () => {
    const p = resolvePeriod({ scope: "month", offset: 0 }, TODAY);
    expect(p.start).toBe("2026-07-01");
    expect(p.end).toBe("2026-07-31");
    expect(p.label).toBe("July 2026");
    expect(p.sub).toBe("day 11 of 31");
    expect(p.buckets).toHaveLength(31);
    expect(p.buckets[0]).toEqual({ start: "2026-07-01", end: "2026-07-01", label: "1" });
    expect(p.elapsedFraction).toBeCloseTo(11 / 31);
  });

  it("steps back across the year boundary", () => {
    const p = resolvePeriod({ scope: "month", offset: -7 }, TODAY);
    expect(p.label).toBe("December 2025");
    expect(p.sub).toBe("complete");
    expect(p.elapsedFraction).toBe(1);
  });

  it("marks future months upcoming", () => {
    const p = resolvePeriod({ scope: "month", offset: 2 }, TODAY);
    expect(p.label).toBe("September 2026");
    expect(p.sub).toBe("upcoming");
    expect(p.elapsedFraction).toBe(0);
  });
});

describe("resolvePeriod — week", () => {
  it("resolves the current Monday-start week", () => {
    const p = resolvePeriod({ scope: "week", offset: 0 }, TODAY);
    expect(p.start).toBe("2026-07-06"); // Monday
    expect(p.end).toBe("2026-07-12"); // Sunday
    expect(p.label).toBe("Week of Jul 6–12, 2026");
    expect(p.sub).toBe("current week");
    expect(p.buckets.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(p.elapsedFraction).toBeCloseTo(6 / 7); // Saturday
  });

  it("labels cross-month weeks with both months", () => {
    const p = resolvePeriod({ scope: "week", offset: -2 }, TODAY);
    expect(p.start).toBe("2026-06-22");
    expect(p.label).toBe("Week of Jun 22–28, 2026");
    const q = resolvePeriod({ scope: "week", offset: -1 }, TODAY);
    expect(q.start).toBe("2026-06-29");
    expect(q.label).toBe("Week of Jun 29–Jul 5, 2026");
  });
});

describe("resolvePeriod — year", () => {
  it("resolves the current year with monthly buckets", () => {
    const p = resolvePeriod({ scope: "year", offset: 0 }, TODAY);
    expect(p.start).toBe("2026-01-01");
    expect(p.end).toBe("2026-12-31");
    expect(p.label).toBe("2026");
    expect(p.sub).toBe("through Jul 11");
    expect(p.buckets).toHaveLength(12);
    expect(p.buckets[1]).toEqual({ start: "2026-02-01", end: "2026-02-28", label: "Feb" });
    expect(p.elapsedFraction).toBeCloseTo(192 / 365);
  });
});

describe("resolvePeriod — custom", () => {
  it("uses daily buckets for short ranges", () => {
    const p = resolvePeriod(
      { scope: "custom", offset: 0, customStart: "2026-07-01", customEnd: "2026-07-10" },
      TODAY,
    );
    expect(p.sub).toBe("custom range · 10 days");
    expect(p.buckets).toHaveLength(10);
  });

  it("uses weekly buckets for medium ranges", () => {
    const p = resolvePeriod(
      { scope: "custom", offset: 0, customStart: "2026-01-04", customEnd: "2026-02-20" },
      TODAY,
    );
    expect(p.label).toBe("Jan 4 – Feb 20, 2026");
    expect(p.sub).toBe("custom range · 48 days");
    expect(p.buckets[0].label).toBe("W1");
    expect(p.buckets).toHaveLength(7);
    expect(p.buckets[6].end).toBe("2026-02-20");
  });

  it("uses monthly buckets for long ranges", () => {
    const p = resolvePeriod(
      { scope: "custom", offset: 0, customStart: "2025-01-01", customEnd: "2025-12-31" },
      TODAY,
    );
    expect(p.buckets).toHaveLength(12);
    expect(p.buckets[0].label).toBe("Jan 25");
  });
});

describe("monthsInRange / prorateBudget", () => {
  it("computes per-month overlaps", () => {
    const months = monthsInRange("2026-01-04", "2026-02-20");
    expect(months).toEqual([
      { month: "2026-01", start: "2026-01-04", end: "2026-01-31", overlapDays: 28, daysInMonth: 31 },
      { month: "2026-02", start: "2026-02-01", end: "2026-02-20", overlapDays: 20, daysInMonth: 28 },
    ]);
  });

  it("prorates a constant monthly budget by day share", () => {
    // Week fully inside July: 52000 × 7/31
    expect(prorateBudget("2026-07-06", "2026-07-12", () => 52000)).toBe(Math.round(52000 * (7 / 31)));
  });

  it("sums full months exactly (year = 12 monthly budgets)", () => {
    const total = prorateBudget("2026-01-01", "2026-12-31", () => 10000);
    expect(total).toBe(120000);
  });

  it("respects per-month budget edits across the boundary", () => {
    const budgets: Record<string, number> = { "2026-06": 30000, "2026-07": 62000 };
    const total = prorateBudget("2026-06-29", "2026-07-05", (m) => budgets[m] ?? 0);
    expect(total).toBe(Math.round(30000 * (2 / 30) + 62000 * (5 / 31)));
  });
});
