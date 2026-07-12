/**
 * Period math for the app-wide period filter: boundaries, labels, buckets,
 * and budget proration. Pure functions over ISO date strings — "today" is
 * always passed in so everything stays deterministic and testable.
 *
 * Conventions: all ranges are inclusive [start, end]; weeks start Monday.
 */

export type PeriodScope = "week" | "month" | "year" | "custom";

export interface PeriodSelection {
  scope: PeriodScope;
  /** Steps back (negative) or forward (positive) from the current period. */
  offset: number;
  /** Only for scope === "custom". */
  customStart?: string | null;
  customEnd?: string | null;
}

export interface Bucket {
  start: string;
  end: string;
  label: string;
}

export interface ResolvedPeriod {
  scope: PeriodScope;
  /** ISO date, inclusive. */
  start: string;
  end: string;
  label: string;
  sub: string;
  buckets: Bucket[];
  /** Fraction of the period elapsed as of `today` (1 for past periods),
   * for pace lines against budgets. */
  elapsedFraction: number;
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// --- civil date helpers (no timezones: dates are day counts) ---

/** Days since epoch for an ISO date. */
function toDayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function fromDayNumber(n: number): string {
  const d = new Date(n * 86400000);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(start: string, end: string): number {
  return toDayNumber(end) - toDayNumber(start) + 1;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function isoOf(y: number, m1: number, d: number): string {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 0 = Monday … 6 = Sunday. */
function weekday(iso: string): number {
  const { y, m, d } = parts(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function fmtShort(iso: string): string {
  const { m, d } = parts(iso);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

// --- resolution ---

export function resolvePeriod(sel: PeriodSelection, today: string): ResolvedPeriod {
  const t = parts(today);

  if (sel.scope === "month") {
    const am = t.y * 12 + (t.m - 1) + sel.offset;
    const y = Math.floor(am / 12);
    const m1 = (am % 12) + 1;
    const dim = daysInMonth(y, m1);
    const start = isoOf(y, m1, 1);
    const end = isoOf(y, m1, dim);
    const current = y === t.y && m1 === t.m;
    const past = end < today;
    const buckets: Bucket[] = [];
    for (let d = 1; d <= dim; d++) {
      const iso = isoOf(y, m1, d);
      buckets.push({ start: iso, end: iso, label: String(d) });
    }
    return {
      scope: "month",
      start,
      end,
      label: `${MONTHS_LONG[m1 - 1]} ${y}`,
      sub: current ? `day ${t.d} of ${dim}` : past ? "complete" : "upcoming",
      buckets,
      elapsedFraction: past ? 1 : current ? t.d / dim : 0,
    };
  }

  if (sel.scope === "week") {
    const monday = addDays(today, -weekday(today) + sel.offset * 7);
    const sunday = addDays(monday, 6);
    const current = sel.offset === 0;
    const past = sunday < today;
    const sameMonth = parts(monday).m === parts(sunday).m;
    const endLabel = sameMonth ? String(parts(sunday).d) : fmtShort(sunday);
    const buckets: Bucket[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(monday, i);
      buckets.push({ start: iso, end: iso, label: DAYS_SHORT[i] });
    }
    return {
      scope: "week",
      start: monday,
      end: sunday,
      label: `Week of ${fmtShort(monday)}–${endLabel}, ${parts(sunday).y}`,
      sub: current ? "current week" : past ? "complete" : "upcoming",
      buckets,
      elapsedFraction: past ? 1 : current ? (weekday(today) + 1) / 7 : 0,
    };
  }

  if (sel.scope === "year") {
    const y = t.y + sel.offset;
    const start = isoOf(y, 1, 1);
    const end = isoOf(y, 12, 31);
    const current = y === t.y;
    const past = y < t.y;
    const buckets: Bucket[] = [];
    for (let m1 = 1; m1 <= 12; m1++) {
      buckets.push({
        start: isoOf(y, m1, 1),
        end: isoOf(y, m1, daysInMonth(y, m1)),
        label: MONTHS_SHORT[m1 - 1],
      });
    }
    const dayOfYear = daysBetween(start, today);
    const yearDays = daysBetween(start, end);
    return {
      scope: "year",
      start,
      end,
      label: String(y),
      sub: current ? `through ${fmtShort(today)}` : past ? "complete" : "upcoming",
      buckets,
      elapsedFraction: past ? 1 : current ? dayOfYear / yearDays : 0,
    };
  }

  // custom
  const start = sel.customStart ?? today;
  const end = sel.customEnd && sel.customEnd >= start ? sel.customEnd : start;
  const total = daysBetween(start, end);
  return {
    scope: "custom",
    start,
    end,
    label: `${fmtShort(start)} – ${fmtShort(end)}, ${parts(end).y}`,
    sub: `custom range · ${total} day${total === 1 ? "" : "s"}`,
    buckets: customBuckets(start, end),
    elapsedFraction:
      end < today ? 1 : start > today ? 0 : daysBetween(start, today) / total,
  };
}

/** Custom scope bucketing adapts to range length: ≤31 days daily,
 * ≤182 days weekly, else monthly. */
function customBuckets(start: string, end: string): Bucket[] {
  const total = daysBetween(start, end);
  const buckets: Bucket[] = [];
  if (total <= 31) {
    for (let i = 0; i < total; i++) {
      const iso = addDays(start, i);
      buckets.push({ start: iso, end: iso, label: fmtShort(iso) });
    }
  } else if (total <= 182) {
    let s = start;
    let w = 1;
    while (s <= end) {
      const e = addDays(s, 6) <= end ? addDays(s, 6) : end;
      buckets.push({ start: s, end: e, label: `W${w}` });
      s = addDays(e, 1);
      w++;
    }
  } else {
    for (const m of monthsInRange(start, end)) {
      const [y, mm] = m.month.split("-").map(Number);
      buckets.push({
        start: m.start,
        end: m.end,
        label: `${MONTHS_SHORT[mm - 1]} ${String(y).slice(2)}`,
      });
    }
  }
  return buckets;
}

export interface MonthOverlap {
  /** 'YYYY-MM' */
  month: string;
  /** Overlap of the period with this month, inclusive ISO dates. */
  start: string;
  end: string;
  overlapDays: number;
  daysInMonth: number;
}

/**
 * The calendar months a period touches, with per-month overlap. Budgets are
 * defined monthly, so the prorated budget for any period is
 *   Σ budget(month) × overlapDays / daysInMonth
 * — for a full year that reduces to the sum of the 12 monthly budgets.
 */
export function monthsInRange(start: string, end: string): MonthOverlap[] {
  const out: MonthOverlap[] = [];
  let { y, m } = parts(start);
  for (;;) {
    const dim = daysInMonth(y, m);
    const mStart = isoOf(y, m, 1);
    const mEnd = isoOf(y, m, dim);
    const s = mStart > start ? mStart : start;
    const e = mEnd < end ? mEnd : end;
    if (s > e) break;
    out.push({
      month: `${y}-${String(m).padStart(2, "0")}`,
      start: s,
      end: e,
      overlapDays: daysBetween(s, e),
      daysInMonth: dim,
    });
    if (mEnd >= end) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Prorated budget in cents for a period, given a per-month budget lookup
 * ('YYYY-MM' → cents). Rounded to whole cents at the end.
 */
export function prorateBudget(
  start: string,
  end: string,
  budgetForMonth: (month: string) => number,
): number {
  let total = 0;
  for (const m of monthsInRange(start, end)) {
    total += budgetForMonth(m.month) * (m.overlapDays / m.daysInMonth);
  }
  return Math.round(total);
}
