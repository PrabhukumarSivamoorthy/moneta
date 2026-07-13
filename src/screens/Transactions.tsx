import { useCallback, useEffect, useMemo, useState } from "react";
import { useResolvedPeriod } from "../state/period";
import { formatCents } from "../lib/money";
import { effectiveTier, TIER_LABELS, TIERS, type Tier } from "../lib/tier";
import { listAccounts, type Account } from "../db/repo/accounts";
import { listCategories, type Category } from "../db/repo/categories";
import { createRule, listRules } from "../db/repo/rules";
import { applyRules } from "../lib/rules";
import { getAllSettings } from "../db/repo/settings";
import {
  deleteTransactions,
  queryTransactions,
  setTierOverride,
  setTransactionCategory,
  setTransactionsCategory,
  type TxRow,
} from "../db/repo/transactions";
import { suggestCategories } from "../lib/ai";
import { getApiKey } from "../platform/apiKey";

type SortKey = "date" | "amount" | "merchant";
type TierFilter = "all" | Tier | "untiered";

const selectCls =
  "bg-transparent border-0 border-b border-ink/40 px-0.5 py-[6px] text-[12.5px] text-ink cursor-pointer font-serif focus:border-accent";

/** One grid template shared by the frozen column-header row and every
 * ledger row, so the columns stay aligned (design renders rows as grids —
 * that is what lets the whole header block be position:sticky). */
const ROW_GRID =
  "grid grid-cols-[34px_96px_1fr_150px_200px_140px_110px_44px] items-center gap-2.5";

/** Offer shown after a manual recategorization: persist it as a rule. */
interface RuleOffer {
  merchantNormalized: string;
  categoryId: number;
  categoryName: string;
}

export default function Transactions() {
  const period = useResolvedPeriod();
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<number | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<number | "all" | "uncategorized">("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<number | "">("");
  const [ruleOffer, setRuleOffer] = useState<RuleOffer | null>(null);

  /** Two-click delete: first click arms the row, second deletes. */
  const [armedDelete, setArmedDelete] = useState<number | null>(null);
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(false);
  /** AI suggestions under review: transaction id → suggested categoryId. */
  const [suggestions, setSuggestions] = useState<Map<number, number>>(new Map());
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [txs, accts, cats, settings] = await Promise.all([
        queryTransactions({
          start: period.start,
          end: period.end,
          accountId: accountFilter === "all" ? null : accountFilter,
          categoryId: typeof categoryFilter === "number" ? categoryFilter : null,
          search,
          sortKey,
          sortDir,
        }),
        listAccounts(),
        listCategories(false, true), // system categories included: filing under them is how Lent/Investing/Income work
        getAllSettings(),
      ]);
      setRows(txs);
      setAccounts(accts);
      setCategories(cats);
      setAiEnabled(settings.ai_assist_enabled === "1");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [period.start, period.end, accountFilter, categoryFilter, search, sortKey, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  const spendingCategories = useMemo(() => categories.filter((c) => !c.isSystem), [categories]);
  const systemCategories = useMemo(() => categories.filter((c) => c.isSystem), [categories]);

  /** Tier + uncategorized filtering happens here, on effective tier.
   * System-category rows carry no tier. */
  const visible = useMemo(() => {
    if (!rows) return null;
    return rows.filter((r) => {
      if (categoryFilter === "uncategorized" && r.categoryId !== null) return false;
      if (tierFilter === "all") return true;
      const tier = r.categoryIsSystem ? null : effectiveTier(r.tierOverride, r.categoryDefaultTier);
      return tierFilter === "untiered" ? tier === null : tier === tierFilter;
    });
  }, [rows, tierFilter, categoryFilter]);

  const uncategorizedCount = useMemo(
    () => rows?.filter((r) => r.categoryId === null).length ?? 0,
    [rows],
  );

  const totals = useMemo(() => {
    if (!visible) return { out: 0, in: 0 };
    let out = 0;
    let inn = 0;
    for (const r of visible) {
      if (r.amountCents < 0) out += r.amountCents;
      else inn += r.amountCents;
    }
    return { out, in: inn };
  }, [visible]);

  const [applyNote, setApplyNote] = useState<string | null>(null);

  /** Run the rules engine over every uncategorized row in the period and
   * file the matches (source 'rule') — same engine imports use, so a rule
   * created today also cleans up history. */
  const runApplyRules = async () => {
    try {
      const rules = await listRules();
      const uncategorized = (rows ?? []).filter((r) => r.categoryId === null);
      const byCategory = new Map<number, number[]>();
      for (const r of uncategorized) {
        const catId = applyRules(rules, r.merchantNormalized);
        if (catId !== null) byCategory.set(catId, [...(byCategory.get(catId) ?? []), r.id]);
      }
      let filed = 0;
      for (const [catId, ids] of byCategory) {
        await setTransactionsCategory(ids, catId, "rule");
        filed += ids.length;
      }
      setApplyNote(
        filed > 0
          ? `✓ ${filed} ${filed === 1 ? "entry" : "entries"} filed by your rules`
          : "no rules matched the uncategorized entries",
      );
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  /** Batch all uncategorized rows through the AI. Results are suggestions
   * only — each needs an explicit accept below. */
  const runSuggest = async () => {
    setSuggesting(true);
    try {
      const key = await getApiKey();
      if (!key) {
        setError("AI assist is on but no API key is saved — add one in Settings.");
        return;
      }
      const uncategorized = (rows ?? []).filter((r) => r.categoryId === null);
      const byName = new Map(categories.map((c) => [c.name, c.id]));
      const result = await suggestCategories(
        key,
        uncategorized.map((r) => ({ id: r.id, merchant: r.merchantNormalized, amountCents: r.amountCents })),
        categories.map((c) => c.name),
      );
      const next = new Map<number, number>();
      for (const [id, catName] of result) {
        const catId = byName.get(catName);
        if (catId !== undefined) next.set(id, catId);
      }
      setSuggestions(next);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const acceptSuggestion = async (id: number, categoryId: number) => {
    try {
      await setTransactionCategory(id, categoryId, "ai");
      setSuggestions((s) => {
        const next = new Map(s);
        next.delete(id);
        return next;
      });
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const recategorize = async (row: TxRow, categoryId: number | null) => {
    try {
      await setTransactionCategory(row.id, categoryId, "manual");
      if (categoryId !== null) {
        const cat = categories.find((c) => c.id === categoryId);
        if (cat) {
          setRuleOffer({
            merchantNormalized: row.merchantNormalized,
            categoryId,
            categoryName: cat.name,
          });
        }
      }
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const sortHeader = (key: SortKey, label: string, extra = "") => (
    <span
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
          setSortKey(key);
          setSortDir(key === "merchant" ? "asc" : "desc");
        }
      }}
      className={`cursor-pointer select-none font-courier text-[10px] tracking-[0.2em] text-ink-mute hover:text-ink ${extra}`}
    >
      {label}
      {sortKey === key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </span>
  );

  return (
    <div>
      {/* Frozen while ledger rows scroll (design: sticky header block from
          title through the column-header row). */}
      <div className="sticky top-0 z-20 bg-paper pt-0.5">
      <div className="mb-1 flex items-baseline gap-4">
        <div className="text-[20px] font-semibold">Transactions</div>
        {uncategorizedCount > 0 && (
          <span
            className="cursor-pointer border border-accent/50 px-2 py-0.5 font-courier text-[10.5px] text-accent hover:bg-accent/10"
            onClick={() => setCategoryFilter("uncategorized")}
          >
            {uncategorizedCount} UNCATEGORIZED
          </span>
        )}
        {uncategorizedCount > 0 && (
          <button
            className="cursor-pointer border border-accent/50 bg-transparent px-2.5 py-1 font-courier text-[10.5px] text-accent hover:bg-accent/10"
            onClick={() => void runApplyRules()}
            title="Run your rules over the uncategorized entries in this period"
          >
            Apply rules
          </button>
        )}
        {applyNote && <span className="font-courier text-[10.5px] text-ink-mute">{applyNote}</span>}
        {aiEnabled && uncategorizedCount > 0 && (
          <button
            className="cursor-pointer border-0 bg-ink px-2.5 py-1 font-courier text-[10.5px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
            disabled={suggesting}
            onClick={() => void runSuggest()}
            title="Sends only merchant names and amounts; suggestions still need your approval"
          >
            {suggesting ? "Asking…" : "Suggest categories (AI)"}
          </button>
        )}
      </div>
      <div className="mb-5 text-[12.5px] italic text-ink-mute">
        {formatCents(totals.out)} out · {formatCents(totals.in)} in, within {period.label.toLowerCase()}
      </div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex items-end gap-5 border-b border-rule pb-3">
        <input
          className="w-64 border-0 border-b border-ink/40 bg-transparent px-0.5 py-[6px] font-serif text-[13px] italic text-ink placeholder:text-ink-faint focus:border-accent"
          placeholder="Search merchants…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={selectCls}
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={categoryFilter}
          onChange={(e) => {
            const v = e.target.value;
            setCategoryFilter(v === "all" || v === "uncategorized" ? v : Number(v));
          }}
        >
          <option value="all">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          <optgroup label="Spending">
            {spendingCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="System">
            {systemCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
        <select className={selectCls} value={tierFilter} onChange={(e) => setTierFilter(e.target.value as TierFilter)}>
          <option value="all">All tiers</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
          <option value="untiered">No tier (uncategorized)</option>
        </select>
      </div>

      {/* AI suggestions under review */}
      {suggestions.size > 0 && (
        <div className="mb-4 flex items-center gap-3 border border-accent/50 bg-accent/5 px-4 py-2.5">
          <span className="font-courier text-[9.5px] tracking-[0.12em] text-accent">AI SUGGESTIONS</span>
          <span className="text-[13px]">
            {suggestions.size} suggestion{suggestions.size === 1 ? "" : "s"} below — accept each with ✓, or
          </span>
          <button
            className="cursor-pointer border-0 bg-accent px-3 py-1.5 font-courier text-[11px] font-bold text-paper hover:bg-accent/90"
            onClick={async () => {
              for (const [id, catId] of [...suggestions]) {
                await acceptSuggestion(id, catId);
              }
            }}
          >
            Accept all
          </button>
          <span className="cursor-pointer font-courier text-[11px] text-ink-mute underline" onClick={() => setSuggestions(new Map())}>
            dismiss all
          </span>
        </div>
      )}

      {/* Rule offer after a manual correction */}
      {ruleOffer && (
        <div className="mb-4 flex items-center gap-3 border border-accent/50 bg-accent/5 px-4 py-2.5">
          <span className="text-[13px]">
            Always file <span className="font-medium">“{ruleOffer.merchantNormalized}”</span> under{" "}
            <span className="font-medium">{ruleOffer.categoryName}</span>?
          </span>
          <button
            className="cursor-pointer border-0 bg-accent px-3 py-1.5 font-courier text-[11px] font-bold text-paper hover:bg-accent/90"
            onClick={async () => {
              try {
                await createRule(ruleOffer.merchantNormalized, "contains", ruleOffer.categoryId, "correction");
                setRuleOffer(null);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Create rule
          </button>
          <span
            className="cursor-pointer font-courier text-[11px] text-ink-mute underline"
            onClick={() => setRuleOffer(null)}
          >
            just this one
          </span>
        </div>
      )}

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 border border-rule bg-ink/[0.03] px-4 py-2.5">
          <span className="font-courier text-[11px] tracking-[0.08em]">
            {selected.size} SELECTED
          </span>
          <select
            className={selectCls}
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">Set category…</option>
            <optgroup label="Spending">
              {spendingCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="System">
              {systemCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            className="cursor-pointer border-0 bg-accent px-3 py-1.5 font-courier text-[11px] font-bold text-paper hover:bg-accent/90 disabled:bg-ink/15 disabled:text-ink-mute"
            disabled={bulkCategory === ""}
            onClick={async () => {
              try {
                await setTransactionsCategory([...selected], bulkCategory as number, "manual");
                setSelected(new Set());
                setBulkCategory("");
                await load();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Apply
          </button>
          <button
            className={`cursor-pointer border px-3 py-1.5 font-courier text-[11px] ${
              bulkDeleteArmed
                ? "border-0 bg-danger font-bold text-paper hover:bg-danger/85"
                : "border-danger/50 bg-transparent text-danger hover:bg-danger/10"
            }`}
            onClick={async () => {
              if (!bulkDeleteArmed) {
                setBulkDeleteArmed(true);
                return;
              }
              try {
                await deleteTransactions([...selected]);
                setSelected(new Set());
                setBulkDeleteArmed(false);
                await load();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {bulkDeleteArmed ? `Really delete ${selected.size}?` : `Delete ${selected.size}…`}
          </button>
          <span
            className="cursor-pointer font-courier text-[11px] text-ink-mute underline"
            onClick={() => {
              setSelected(new Set());
              setBulkDeleteArmed(false);
            }}
          >
            clear selection
          </span>
        </div>
      )}

      {/* Column headers — frozen together with the block above */}
      {visible !== null && visible.length > 0 && (
        <div className={`${ROW_GRID} border-b border-rule px-1 py-2`}>
          <span>
            <input
              type="checkbox"
              className="accent-[#2F5D45]"
              checked={visible.length > 0 && visible.every((r) => selected.has(r.id))}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())
              }
            />
          </span>
          {sortHeader("date", "DATE")}
          {sortHeader("merchant", "MERCHANT")}
          <span className="font-courier text-[10px] tracking-[0.2em] text-ink-mute">ACCOUNT</span>
          <span className="font-courier text-[10px] tracking-[0.2em] text-ink-mute">CATEGORY</span>
          <span className="font-courier text-[10px] tracking-[0.2em] text-ink-mute">TIER</span>
          {sortHeader("amount", "AMOUNT", "text-right")}
          <span />
        </div>
      )}
      </div>

      {/* Ledger rows — scroll beneath the frozen block */}
      {visible === null ? (
        <div className="pt-3 text-[13px] italic text-ink-mute">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="mt-3 border border-dashed border-rule px-6 py-10 text-center text-[13px] italic text-ink-mute">
          No transactions in this period{search || accountFilter !== "all" || categoryFilter !== "all" || tierFilter !== "all" ? " matching the filters" : ""}.
        </div>
      ) : (
        <div>
          {visible.map((r) => {
            const tier = effectiveTier(r.tierOverride, r.categoryDefaultTier);
            return (
              <div key={r.id} data-testid="tx-row" className={`${ROW_GRID} border-b border-rule-soft px-1 py-1.5 hover:bg-ink/[0.025]`}>
                <span>
                  <input
                    type="checkbox"
                    className="accent-[#2F5D45]"
                    checked={selected.has(r.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                  />
                </span>
                <span className="font-mono text-[12px]">{r.date}</span>
                <span>
                  <div className="text-[13px]">{r.merchantNormalized}</div>
                  <div className="font-mono text-[10px] text-ink-faint">{r.merchantRaw}</div>
                </span>
                <span className="text-[12px] text-ink-soft">{r.accountName}</span>
                <span>
                    <select
                      className={`${selectCls} ${r.categoryId === null ? "border-accent/60 italic text-accent" : ""}`}
                      value={r.categoryId ?? ""}
                      onChange={(e) => void recategorize(r, e.target.value === "" ? null : Number(e.target.value))}
                    >
                      <option value="">— uncategorized —</option>
                      <optgroup label="Spending">
                        {spendingCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="System">
                        {systemCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {r.uploadId === null && (
                      <span className="ml-1.5 border border-ink/20 px-1 py-px font-courier text-[8.5px] tracking-[0.1em] text-ink-mute" title="Recorded by hand, not imported">
                        MANUAL
                      </span>
                    )}
                    {r.categorizationSource === "rule" && r.categoryId !== null && (
                      <span className="ml-1.5 font-courier text-[9px] tracking-[0.08em] text-ink-faint" title="Categorized by a rule">
                        RULE
                      </span>
                    )}
                    {r.categorizationSource === "ai" && r.categoryId !== null && (
                      <span className="ml-1.5 font-courier text-[9px] tracking-[0.08em] text-ink-faint" title="Categorized by AI assist (you accepted the suggestion)">
                        AI
                      </span>
                    )}
                    {r.categoryId === null && suggestions.has(r.id) && (
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className="border border-accent/50 bg-accent/5 px-1.5 py-0.5 font-courier text-[10px] text-accent">
                          → {categories.find((c) => c.id === suggestions.get(r.id))?.name}
                        </span>
                        <span
                          className="cursor-pointer font-courier text-[11px] font-bold text-accent hover:text-ink"
                          title="Accept suggestion"
                          onClick={() => void acceptSuggestion(r.id, suggestions.get(r.id)!)}
                        >
                          ✓
                        </span>
                        <span
                          className="cursor-pointer font-courier text-[11px] text-ink-mute hover:text-danger"
                          title="Reject suggestion"
                          onClick={() =>
                            setSuggestions((s) => {
                              const next = new Map(s);
                              next.delete(r.id);
                              return next;
                            })
                          }
                        >
                          ✗
                        </span>
                      </span>
                    )}
                  </span>
                  <span>
                    {r.categoryId === null || r.categoryIsSystem ? (
                      <span className="font-courier text-[10px] text-ink-faint" title={r.categoryIsSystem ? "System categories carry no tier" : undefined}>
                        —
                      </span>
                    ) : (
                      <select
                        className={`${selectCls} ${r.tierOverride ? "font-medium text-accent" : ""}`}
                        title={r.tierOverride ? "Tier override set on this transaction" : "Category default tier"}
                        value={r.tierOverride ?? ""}
                        onChange={async (e) => {
                          try {
                            await setTierOverride(r.id, e.target.value === "" ? null : (e.target.value as Tier));
                            await load();
                          } catch (err) {
                            setError(String(err));
                          }
                        }}
                      >
                        <option value="">{tier ? `${TIER_LABELS[tier]} (default)` : "—"}</option>
                        {TIERS.map((t) => (
                          <option key={t} value={t}>
                            {TIER_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                  <span className={`text-right font-mono text-[12.5px] ${r.amountCents > 0 ? "text-accent" : ""}`}>
                    {formatCents(r.amountCents)}
                  </span>
                  <span className="text-right">
                    {armedDelete === r.id ? (
                      <span className="whitespace-nowrap font-courier text-[10px]">
                        <span
                          className="cursor-pointer font-bold text-danger underline"
                          title="Yes, delete this entry"
                          onClick={async () => {
                            try {
                              await deleteTransactions([r.id]);
                              setArmedDelete(null);
                              await load();
                            } catch (e) {
                              setError(String(e));
                            }
                          }}
                        >
                          delete?
                        </span>{" "}
                        <span className="cursor-pointer text-ink-mute underline" onClick={() => setArmedDelete(null)}>
                          no
                        </span>
                      </span>
                    ) : (
                      <span
                        className="cursor-pointer font-courier text-[12px] text-ink-faint hover:text-danger"
                        title="Delete this entry"
                        onClick={() => setArmedDelete(r.id)}
                      >
                        ×
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
