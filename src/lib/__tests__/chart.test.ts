import { describe, expect, it } from "vitest";
import {
  bucketIndex,
  categorySpendByBucket,
  spendByBucket,
  tierShareByBucket,
  tierShareChange,
  tierSpendByBucket,
  topMerchants,
  type DatedSpendRow,
} from "../chart";
import type { Bucket } from "../period";

const BUCKETS: Bucket[] = [
  { start: "2026-07-06", end: "2026-07-06", label: "Mon" },
  { start: "2026-07-07", end: "2026-07-07", label: "Tue" },
  { start: "2026-07-08", end: "2026-07-09", label: "W" },
];

const row = (
  date: string,
  amountCents: number,
  categoryId: number | null = 1,
  defaultTier: DatedSpendRow["categoryDefaultTier"] = "need",
  tierOverride: DatedSpendRow["tierOverride"] = null,
): DatedSpendRow => ({
  date,
  amountCents,
  categoryId,
  categoryDefaultTier: categoryId === null ? null : defaultTier,
  tierOverride,
});

describe("bucketIndex", () => {
  it("finds containing bucket including multi-day buckets", () => {
    expect(bucketIndex(BUCKETS, "2026-07-06")).toBe(0);
    expect(bucketIndex(BUCKETS, "2026-07-09")).toBe(2);
    expect(bucketIndex(BUCKETS, "2026-07-10")).toBe(-1);
  });
});

describe("spendByBucket / categorySpendByBucket", () => {
  it("sums outflows per bucket, ignoring inflows and out-of-range dates", () => {
    const rows = [
      row("2026-07-06", -1000),
      row("2026-07-06", -500),
      row("2026-07-08", -200),
      row("2026-07-09", -300),
      row("2026-07-07", 5000), // inflow
      row("2026-07-20", -999), // outside
    ];
    expect(spendByBucket(rows, BUCKETS)).toEqual([1500, 0, 500]);
  });

  it("filters by category", () => {
    const rows = [row("2026-07-06", -1000, 1), row("2026-07-06", -700, 2)];
    expect(categorySpendByBucket(rows, BUCKETS, 2)).toEqual([700, 0, 0]);
  });
});

describe("tier buckets", () => {
  it("splits spend by effective tier and excludes uncategorized", () => {
    const rows = [
      row("2026-07-06", -1000, 1, "need"),
      row("2026-07-06", -1000, 2, "comfortable"),
      row("2026-07-06", -2000, 3, "need", "luxury"), // override wins
      row("2026-07-06", -999, null),
    ];
    const per = tierSpendByBucket(rows, BUCKETS);
    expect(per[0]).toEqual({ need: 1000, comfortable: 1000, luxury: 2000 });
  });

  it("computes shares with null for empty buckets", () => {
    const per = tierSpendByBucket([row("2026-07-06", -3000, 1, "need"), row("2026-07-06", -1000, 2, "luxury")], BUCKETS);
    expect(tierShareByBucket(per, "need")).toEqual([75, null, null]);
    expect(tierShareByBucket(per, "luxury")).toEqual([25, null, null]);
  });

  it("reports share change between first and last non-empty buckets", () => {
    const rows = [
      row("2026-07-06", -8000, 1, "need"),
      row("2026-07-06", -2000, 2, "luxury"),
      row("2026-07-09", -5000, 1, "need"),
      row("2026-07-09", -5000, 2, "luxury"),
    ];
    const per = tierSpendByBucket(rows, BUCKETS);
    expect(tierShareChange(per, "luxury")).toEqual({ firstPct: 20, lastPct: 50, deltaPt: 30 });
    expect(tierShareChange(per.slice(0, 1), "luxury")).toBeNull();
  });
});

describe("topMerchants", () => {
  it("ranks by spend within a category with a limit", () => {
    const rows = [
      { ...row("2026-07-06", -1000, 3), merchantNormalized: "Chipotle" },
      { ...row("2026-07-07", -2500, 3), merchantNormalized: "Sushi Kashiba" },
      { ...row("2026-07-08", -400, 3), merchantNormalized: "Chipotle" },
      { ...row("2026-07-08", -9999, 1), merchantNormalized: "Whole Foods" }, // other cat
    ];
    expect(topMerchants(rows, 3, 2)).toEqual([
      { name: "Sushi Kashiba", cents: 2500 },
      { name: "Chipotle", cents: 1400 },
    ]);
  });
});
