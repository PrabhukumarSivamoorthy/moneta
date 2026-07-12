import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

/**
 * App-wide period filter. Every read query (totals, tables, charts, tier mix)
 * scopes to this. Boundary/bucket/proration math lives in src/lib/period.ts
 * (Phase 2); this store only holds the selection.
 */
export type PeriodScope = "week" | "month" | "year" | "custom";

export interface PeriodState {
  scope: PeriodScope;
  /** Steps back (negative) or forward (positive) from the current period. */
  offset: number;
  /** Only set when scope === "custom". ISO dates. */
  customStart: string | null;
  customEnd: string | null;
}

export type PeriodAction =
  | { type: "setScope"; scope: PeriodScope }
  | { type: "step"; direction: -1 | 1 }
  | { type: "setCustomRange"; start: string; end: string };

const initialState: PeriodState = {
  scope: "month",
  offset: 0,
  customStart: null,
  customEnd: null,
};

function reducer(state: PeriodState, action: PeriodAction): PeriodState {
  switch (action.type) {
    case "setScope":
      return { ...state, scope: action.scope, offset: 0 };
    case "step":
      return { ...state, offset: state.offset + action.direction };
    case "setCustomRange":
      return {
        ...state,
        scope: "custom",
        offset: 0,
        customStart: action.start,
        customEnd: action.end,
      };
  }
}

const PeriodContext = createContext<{
  period: PeriodState;
  dispatch: Dispatch<PeriodAction>;
} | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, dispatch] = useReducer(reducer, initialState);
  return (
    <PeriodContext.Provider value={{ period, dispatch }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod must be used within PeriodProvider");
  return ctx;
}
