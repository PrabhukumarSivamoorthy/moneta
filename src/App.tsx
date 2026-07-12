import { useState, type ReactNode } from "react";
import { PeriodProvider, usePeriod, type PeriodScope } from "./state/period";
import Overview from "./screens/Overview";
import Dashboard from "./screens/Dashboard";
import Earnings from "./screens/Earnings";
import Transactions from "./screens/Transactions";
import Upload from "./screens/Upload";
import Budgets from "./screens/Budgets";
import Trends from "./screens/Trends";
import LentBorrowed from "./screens/LentBorrowed";
import GoalsLoans from "./screens/GoalsLoans";
import Recurring from "./screens/Recurring";
import Transfers from "./screens/Transfers";
import Settings from "./screens/Settings";

type ScreenId =
  | "overview"
  | "dashboard"
  | "earnings"
  | "transactions"
  | "upload"
  | "budgets"
  | "trends"
  | "lent"
  | "goals"
  | "recurring"
  | "transfers"
  | "settings";

interface NavEntry {
  id: ScreenId;
  label: string;
  glyph: string;
  screen: ReactNode;
  /** Screens without a period bar (design: upload, settings, goals, lent). */
  periodBar: boolean;
}

const NAV_MAIN: NavEntry[] = [
  { id: "overview", label: "Overview", glyph: "◈", screen: <Overview />, periodBar: false },
  { id: "dashboard", label: "Dashboard", glyph: "▤", screen: <Dashboard />, periodBar: true },
  { id: "earnings", label: "Earnings", glyph: "¤", screen: <Earnings />, periodBar: true },
  { id: "transactions", label: "Transactions", glyph: "≡", screen: <Transactions />, periodBar: true },
  { id: "budgets", label: "Budgets", glyph: "◪", screen: <Budgets />, periodBar: true },
  { id: "trends", label: "Trends", glyph: "∿", screen: <Trends />, periodBar: true },
  { id: "lent", label: "Lent & borrowed", glyph: "⇄", screen: <LentBorrowed />, periodBar: false },
  { id: "goals", label: "Goals & loans", glyph: "⚑", screen: <GoalsLoans />, periodBar: false },
  { id: "recurring", label: "Recurring", glyph: "↻", screen: <Recurring />, periodBar: true },
  { id: "transfers", label: "Transfers & investing", glyph: "⇌", screen: <Transfers />, periodBar: true },
];

const NAV_BOTTOM: NavEntry[] = [
  { id: "upload", label: "Upload", glyph: "↥", screen: <Upload />, periodBar: false },
  { id: "settings", label: "Settings", glyph: "⚙", screen: <Settings />, periodBar: false },
];

const ALL_NAV = [...NAV_MAIN, ...NAV_BOTTOM];

const SCOPE_TABS: { scope: PeriodScope; label: string }[] = [
  { scope: "week", label: "WEEK" },
  { scope: "month", label: "MONTH" },
  { scope: "year", label: "YEAR" },
  { scope: "custom", label: "CUSTOM" },
];

function NavItem({
  entry,
  active,
  expanded,
  onClick,
}: {
  entry: NavEntry;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={entry.label}
      className={`flex cursor-pointer items-center gap-[11px] border-l-[3px] hover:bg-ink/5 ${
        expanded ? "px-[19px] py-[9px]" : "justify-center px-0 py-[9px]"
      } ${
        active
          ? "border-accent bg-ink/[0.06] font-medium text-ink"
          : "border-transparent text-ink-soft"
      }`}
    >
      <span className="font-courier text-[13px]">{entry.glyph}</span>
      {expanded && (
        <span className="flex-1 whitespace-nowrap text-[13.5px]">
          {entry.label}
        </span>
      )}
    </div>
  );
}

/**
 * Placeholder period label until src/lib/period.ts (Phase 2) provides real
 * boundary math. Month scope only; other scopes show the scope name.
 */
function periodLabel(scope: PeriodScope, offset: number): string {
  if (scope === "month") {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (scope === "year") return String(new Date().getFullYear() + offset);
  return scope === "week" ? "Week view" : "Custom range";
}

function PeriodBar() {
  const { period, dispatch } = usePeriod();
  return (
    <div className="flex flex-none items-center gap-4 border-b border-rule bg-paper px-9 py-3">
      <div className="flex gap-[2px]">
        {SCOPE_TABS.map((t) => (
          <div
            key={t.scope}
            onClick={() => dispatch({ type: "setScope", scope: t.scope })}
            className={`cursor-pointer border-b-2 px-[11px] py-[5px] font-courier text-[11.5px] tracking-[0.06em] hover:text-ink ${
              period.scope === t.scope
                ? "border-accent font-bold text-ink"
                : "border-transparent text-ink-mute"
            }`}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="h-5 w-px bg-ink/20" />
      <div className="flex gap-[6px]">
        <button
          onClick={() => dispatch({ type: "step", direction: -1 })}
          title="Previous period"
          className="h-[26px] w-[26px] cursor-pointer border border-ink/35 bg-transparent p-0 text-[11px] text-ink hover:bg-ink/[0.07]"
        >
          ◀
        </button>
        <button
          onClick={() => dispatch({ type: "step", direction: 1 })}
          title="Next period"
          className="h-[26px] w-[26px] cursor-pointer border border-ink/35 bg-transparent p-0 text-[11px] text-ink hover:bg-ink/[0.07]"
        >
          ▶
        </button>
      </div>
      <span className="text-[16px] font-semibold italic">
        {periodLabel(period.scope, period.offset)}
      </span>
      <div className="flex-1" />
    </div>
  );
}

function Shell() {
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [expanded, setExpanded] = useState(true);
  const active = ALL_NAV.find((n) => n.id === screen)!;

  return (
    <div className="flex h-screen min-w-[1280px] overflow-hidden">
      {/* Sidebar */}
      <div
        className="flex flex-none flex-col overflow-hidden border-r border-rule bg-paper-side transition-[width] duration-150"
        style={{ width: expanded ? 232 : 58 }}
      >
        <div
          className={`flex items-start p-[18px] ${expanded ? "" : "justify-center"}`}
        >
          {expanded && (
            <div className="flex-1">
              <div className="font-courier text-[15px] font-bold tracking-[0.24em]">
                MONETA
              </div>
              <div className="mt-1 font-courier text-[10px] tracking-[0.08em] text-ink-soft">
                ledger № 1 · local file
              </div>
            </div>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Collapse sidebar" : "Expand sidebar"}
            className="h-6 w-6 flex-none cursor-pointer border border-ink/30 bg-transparent p-0 font-courier text-[12px] text-ink hover:bg-ink/[0.07]"
          >
            {expanded ? "«" : "»"}
          </button>
        </div>
        <div className="mx-3 mb-[10px] h-px bg-ink/[0.18]" />
        <div className="flex flex-col">
          {NAV_MAIN.map((n) => (
            <NavItem
              key={n.id}
              entry={n}
              active={screen === n.id}
              expanded={expanded}
              onClick={() => setScreen(n.id)}
            />
          ))}
        </div>
        <div className="flex-1" />
        <div className="mx-3 my-[10px] h-px bg-ink/[0.18]" />
        <div className="mb-2 flex flex-col">
          {NAV_BOTTOM.map((n) => (
            <NavItem
              key={n.id}
              entry={n}
              active={screen === n.id}
              expanded={expanded}
              onClick={() => setScreen(n.id)}
            />
          ))}
        </div>
        {expanded && (
          <div className="border-t border-rule-soft px-[22px] py-4">
            <div className="whitespace-nowrap text-[11px] italic leading-[1.65] text-ink-soft">
              All entries stay on this Mac.
            </div>
          </div>
        )}
      </div>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {active.periodBar && <PeriodBar />}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="relative mx-auto max-w-[1180px] px-11 pb-[70px] pl-[58px] pt-[30px]">
            {active.screen}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <PeriodProvider>
      <Shell />
    </PeriodProvider>
  );
}
