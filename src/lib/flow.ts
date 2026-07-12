/**
 * Money-flow (Sankey) data for a period: where money came from and where it
 * went. Sources: income (and savings, when spending exceeded income).
 * Destinations: spend by tier, uncategorized spend, investing net, lent
 * net, and whatever was kept. Card payments are excluded — both sides of a
 * payment cancel out.
 */
import { effectiveTier } from "./tier";
import { TIER_LABELS } from "./tier";
import type { TxRow } from "../db/repo/transactions";

export interface FlowNode {
  name: string;
}

export interface FlowLink {
  source: number;
  target: number;
  value: number; // cents
}

export interface FlowData {
  nodes: FlowNode[];
  links: FlowLink[];
}

export function buildMoneyFlow(rows: readonly TxRow[]): FlowData | null {
  let income = 0;
  const tierSpend = { need: 0, comfortable: 0, luxury: 0 };
  let uncategorized = 0;
  let investingNet = 0; // positive = money moved out to brokerages
  let lentNet = 0; // positive = money lent out

  for (const r of rows) {
    if (r.categoryIsSystem) {
      if (r.categoryName === "Income" && r.amountCents > 0) income += r.amountCents;
      else if (r.categoryName === "Investing transfer") investingNet += -r.amountCents;
      else if (r.categoryName === "Lent & borrowed") lentNet += -r.amountCents;
      // Card payment: both sides cancel — ignored.
      continue;
    }
    if (r.amountCents >= 0) continue;
    const tier = effectiveTier(r.tierOverride, r.categoryDefaultTier);
    if (tier === null) uncategorized += -r.amountCents;
    else tierSpend[tier] += -r.amountCents;
  }

  const outflows: { name: string; value: number }[] = [
    { name: TIER_LABELS.need, value: tierSpend.need },
    { name: TIER_LABELS.comfortable, value: tierSpend.comfortable },
    { name: TIER_LABELS.luxury, value: tierSpend.luxury },
    { name: "Uncategorized", value: uncategorized },
    { name: "Investing", value: Math.max(0, investingNet) },
    { name: "Lent out", value: Math.max(0, lentNet) },
  ].filter((o) => o.value > 0);

  const inflows: { name: string; value: number }[] = [{ name: "Income", value: income }];
  if (investingNet < 0) inflows.push({ name: "From investing", value: -investingNet });
  if (lentNet < 0) inflows.push({ name: "Repaid to you", value: -lentNet });

  const totalOut = outflows.reduce((a, o) => a + o.value, 0);
  const totalIn = inflows.filter((i) => i.value > 0).reduce((a, i) => a + i.value, 0);
  if (totalIn === 0 && totalOut === 0) return null;

  const kept = totalIn - totalOut;
  if (kept > 0) outflows.push({ name: "Kept", value: kept });
  else if (kept < 0) inflows.push({ name: "From savings", value: -kept });

  const activeIn = inflows.filter((i) => i.value > 0);
  const nodes: FlowNode[] = [...activeIn.map((i) => ({ name: i.name })), { name: "This period" }, ...outflows.map((o) => ({ name: o.name }))];
  const hub = activeIn.length;
  const links: FlowLink[] = [
    ...activeIn.map((i, idx) => ({ source: idx, target: hub, value: i.value })),
    ...outflows.map((o, idx) => ({ source: hub, target: hub + 1 + idx, value: o.value })),
  ];
  return { nodes, links };
}
