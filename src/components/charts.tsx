/**
 * Shared Recharts pieces in the ledger's visual language: square grid in
 * faded green, mono tick labels, dashed ink reference lines, paper-surface
 * tooltips. Colors follow the design reference's tier ramp — a single green
 * hue stepped by opacity (tiers are ordinal), never a rainbow.
 */
import type { ReactNode } from "react";

export const INK = "#1F261E";
export const GREEN = "#2F5D45";
export const GRID_STROKE = "rgba(74,108,88,0.20)";
export const AXIS_STROKE = "rgba(31,38,30,0.35)";

export const TIER_FILL = {
  need: "#2F5D45",
  comfortable: "rgba(47,93,69,0.42)",
  luxury: "rgba(47,93,69,0.16)",
} as const;
export const LUXURY_STROKE = "rgba(47,93,69,0.4)";

export const STATUS = { ok: "#2F5D45", warn: "#9C6F1F", over: "#B3362C" } as const;

/** Identity for the category multiline chart: fixed order, color + dash
 * pattern together so no series is color-alone. */
export const LINE_SERIES: { stroke: string; dash?: string }[] = [
  { stroke: GREEN },
  { stroke: INK },
  { stroke: GREEN, dash: "6 3" },
  { stroke: INK, dash: "6 3" },
  { stroke: "#65705F", dash: "2 2" },
];

export const tickStyle = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 9,
  fill: "#8B9384",
} as const;

export function ChartFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="border border-[rgba(74,108,88,0.3)] p-2"
      style={{
        backgroundImage:
          "linear-gradient(rgba(74,108,88,0.14) 1px,transparent 1px),linear-gradient(90deg,rgba(74,108,88,0.14) 1px,transparent 1px)",
        backgroundSize: "16px 16px",
      }}
    >
      {children}
    </div>
  );
}

export interface TooltipEntry {
  name?: string;
  value?: number | string;
  dataKey?: string | number;
  color?: string;
}

/** Paper-surface tooltip; caller provides row formatting. Recharts injects
 * active/payload/label at render time (its v3 prop types omit them). */
export function PaperTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: unknown;
  format: (payload: TooltipEntry[], label: unknown) => ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="border border-rule bg-paper-side px-3 py-2 font-mono text-[11px] leading-relaxed shadow-sm">
      {format(payload, label)}
    </div>
  );
}
