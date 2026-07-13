import { useCallback, useEffect, useState } from "react";
import { TIER_LABELS, TIERS, type Tier } from "../lib/tier";
import { TIER_FILL } from "../components/charts";
import type { MatchType } from "../lib/rules";
import { accountStats, setAccountBalance, type AccountStats } from "../db/repo/accounts";
import { centsToDecimalString, parseAmountToCents } from "../lib/money";
import { listCategories, updateCategory, type Category } from "../db/repo/categories";
import { createRule, deleteRule, listRules, type Rule } from "../db/repo/rules";
import { getAllSettings, setSetting } from "../db/repo/settings";
import { deleteUpload, listUploads, type UploadStats } from "../db/repo/uploads";
import { getApiKey, setApiKey } from "../platform/apiKey";
import { gatherBackupData, restoreBackup, wipeAllData } from "../db/backup";
import { buildBackup, buildTransactionsCsv, parseBackup, type ParsedBackup } from "../lib/export";
import { queryTransactions } from "../db/repo/transactions";
import { exportTextFile, importTextFile } from "../platform/exportFile";

const section =
  "font-courier text-[10.5px] tracking-[0.2em] text-ink-mute border-t border-rule pt-3 mb-3 flex items-center justify-between";
const note = "text-[11.5px] italic text-ink-faint mb-3";
const selectCls =
  "cursor-pointer border-0 border-b border-ink/30 bg-transparent px-0.5 py-1 font-serif text-[12.5px] text-ink focus:border-accent";
const ghostBtn =
  "cursor-pointer border border-accent/50 bg-transparent px-3 py-1.5 font-courier text-[11px] text-accent hover:bg-accent/[0.08]";

export default function Settings() {
  const [accounts, setAccounts] = useState<AccountStats[]>([]);
  const [uploads, setUploads] = useState<UploadStats[]>([]);
  const [armedUndo, setArmedUndo] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addingRule, setAddingRule] = useState(false);
  const [ruleMatcher, setRuleMatcher] = useState("");
  const [ruleType, setRuleType] = useState<MatchType>("contains");
  const [ruleCat, setRuleCat] = useState<number | "">("");

  const [exportNote, setExportNote] = useState<string | null>(null);
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const [wipeText, setWipeText] = useState("");
  /** A parsed backup awaiting the user's replace-everything confirmation. */
  const [pendingRestore, setPendingRestore] = useState<{ file: string; backup: ParsedBackup } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const aiEnabled = settings.ai_assist_enabled === "1";

  const load = useCallback(async () => {
    try {
      const [accts, ups, cats, rls, stgs] = await Promise.all([
        accountStats(),
        listUploads(),
        listCategories(),
        listRules(),
        getAllSettings(),
      ]);
      setAccounts(accts);
      setUploads(ups);
      setCategories(cats);
      setRules(rls);
      setSettings(stgs);
      try {
        setKey((await getApiKey()) ?? "");
      } catch {
        // Key commands are unavailable outside the Tauri shell (browser dev).
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSetting = async (k: string, v: string) => {
    try {
      await setSetting(k, v);
      setSettings((s) => ({ ...s, [k]: v }));
    } catch (e) {
      setError(String(e));
    }
  };

  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? `#${id}`;

  return (
    <div className="max-w-[820px]">
      <div className="mb-6 text-[20px] font-semibold">Settings</div>

      {error && (
        <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Database error: {error}
        </div>
      )}

      {/* Accounts */}
      <div className={section}>ACCOUNTS</div>
      <div className="mb-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3.5 border-b border-[rgba(74,108,88,0.28)] py-2">
            <div className="flex-1">
              <div className="text-[13.5px] font-medium">{a.name}</div>
              <div className="mt-0.5 text-[11px] italic text-ink-faint">
                {a.type} · <span className="font-mono not-italic">{a.lastDate ?? "no entries"}</span> ·{" "}
                {a.entryCount} entries
                {a.balanceAsOf && (
                  <>
                    {" "}
                    · balance as of <span className="font-mono not-italic">{a.balanceAsOf}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-baseline gap-1" title="Statement balance, entered by hand — shown on the Overview screen">
              <span className="font-mono text-[11px] text-ink-faint">$</span>
              <input
                className="w-24 border-0 border-b border-ink/30 bg-transparent px-0.5 py-1 text-right font-mono text-[12px] text-ink focus:border-accent"
                defaultValue={a.balanceCents !== 0 ? centsToDecimalString(a.balanceCents) : ""}
                placeholder="0.00"
                onBlur={async (e) => {
                  const cents = parseAmountToCents(e.target.value || "0");
                  if (cents === null || cents === a.balanceCents) return;
                  try {
                    const d = new Date();
                    await setAccountBalance(
                      a.id,
                      cents,
                      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                    );
                    await load();
                  } catch (err) {
                    setError(String(err));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="py-2 text-[12px] italic text-ink-faint">No accounts yet — create one on the Upload screen.</div>
        )}
      </div>
      <div className="mb-8 text-[11px] italic text-ink-faint">
        Balances feed the Overview screen; for credit cards enter the amount owed as a positive number.
      </div>

      {/* Import history */}
      <div className={section}>IMPORT HISTORY</div>
      <div className={note}>
        Undoing an import deletes every entry it brought in — the file itself is untouched, so you can re-import it
        (with a fixed profile) any time.
      </div>
      <div className="mb-8">
        {uploads.map((u) => (
          <div key={u.id} className="flex items-center gap-3.5 border-b border-[rgba(74,108,88,0.28)] py-2">
            <div className="flex-1">
              <div className="font-mono text-[12.5px]">{u.filename}</div>
              <div className="mt-0.5 text-[11px] italic text-ink-faint">
                {u.account_name} · imported <span className="font-mono not-italic">{u.imported_at.slice(0, 10)}</span> ·{" "}
                <span className="font-mono not-italic">{u.remaining}</span> of{" "}
                <span className="font-mono not-italic">{u.row_count}</span> entries still in the ledger
              </div>
            </div>
            {armedUndo === u.id ? (
              <span className="whitespace-nowrap font-courier text-[11px]">
                <span
                  className="cursor-pointer font-bold text-danger underline"
                  onClick={async () => {
                    try {
                      await deleteUpload(u.id);
                      setArmedUndo(null);
                      await load();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  delete {u.remaining} entries?
                </span>{" "}
                <span className="cursor-pointer text-ink-mute underline" onClick={() => setArmedUndo(null)}>
                  cancel
                </span>
              </span>
            ) : (
              <span
                className="cursor-pointer font-courier text-[11px] text-ink-mute underline hover:text-danger"
                onClick={() => setArmedUndo(u.id)}
              >
                undo import
              </span>
            )}
          </div>
        ))}
        {uploads.length === 0 && <div className="py-2 text-[12px] italic text-ink-faint">No imports yet.</div>}
      </div>

      {/* Categories — default tier */}
      <div className={section}>CATEGORIES — DEFAULT TIER</div>
      <div className={note}>
        New transactions inherit the category's tier; individual entries can be overridden in the ledger.
      </div>
      <div className="mb-8 grid grid-cols-2 gap-x-11">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2.5 border-b border-[rgba(74,108,88,0.28)] py-[7px]">
            <span
              className="inline-flex h-[11px] w-[11px] flex-none items-center justify-center rounded-full border-[1.5px] border-accent"
              style={{ background: TIER_FILL[c.defaultTier] }}
            />
            <span className="flex-1 text-[13px]">{c.name}</span>
            <select
              className={selectCls}
              value={c.defaultTier}
              onChange={async (e) => {
                try {
                  await updateCategory(c.id, c.name, e.target.value as Tier);
                  await load();
                } catch (err) {
                  setError(String(err));
                }
              }}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Rules */}
      <div className={section}>
        RULES
        <button className={ghostBtn} onClick={() => setAddingRule(true)}>
          Add rule
        </button>
      </div>
      <div className={note}>Rules run top-down at import; the first match wins.</div>
      {addingRule && (
        <div className="mb-3 flex flex-wrap items-end gap-3 border-[1.5px] border-dashed border-accent/50 bg-accent/[0.04] px-4 py-3">
          <select className={selectCls} value={ruleType} onChange={(e) => setRuleType(e.target.value as MatchType)}>
            <option value="contains">contains</option>
            <option value="prefix">starts with</option>
            <option value="regex">regex</option>
          </select>
          <input
            className="w-56 border-0 border-b border-ink/40 bg-transparent px-0.5 py-1 font-mono text-[12px] text-ink focus:border-accent"
            placeholder="merchant text…"
            value={ruleMatcher}
            onChange={(e) => setRuleMatcher(e.target.value)}
          />
          <span className="text-[12px] italic text-ink-mute">→</span>
          <select
            className={selectCls}
            value={ruleCat}
            onChange={(e) => setRuleCat(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="cursor-pointer border-0 bg-ink px-3.5 py-1.5 font-courier text-[11px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
            disabled={!ruleMatcher.trim() || ruleCat === ""}
            onClick={async () => {
              try {
                await createRule(ruleMatcher.trim(), ruleType, ruleCat as number, "manual");
                setRuleMatcher("");
                setRuleCat("");
                setAddingRule(false);
                await load();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Add
          </button>
          <span className="cursor-pointer font-courier text-[11px] text-ink-mute underline" onClick={() => setAddingRule(false)}>
            cancel
          </span>
        </div>
      )}
      <div className="mb-8">
        <div className="grid grid-cols-[36px_90px_1fr_150px_60px] gap-3 border-b border-ink py-1.5 font-courier text-[10px] tracking-[0.14em] text-ink-mute">
          <span>#</span>
          <span>MATCH</span>
          <span>PATTERN</span>
          <span>SET CATEGORY</span>
          <span />
        </div>
        {rules.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[36px_90px_1fr_150px_60px] items-center gap-3 border-b border-[rgba(74,108,88,0.28)] py-[7px] hover:bg-ink/[0.035]">
            <span className="font-mono text-[11px] text-ink-faint">{i + 1}</span>
            <span className="font-courier text-[10px] tracking-[0.06em] text-ink-mute">{r.matchType.toUpperCase()}</span>
            <span className="w-fit border border-ink/10 bg-ink/5 px-2 py-0.5 font-mono text-[11.5px]">{r.matcher}</span>
            <span className="text-[12.5px] text-ink-mute">{catName(r.categoryId)}</span>
            <span
              className="cursor-pointer text-right font-courier text-[11px] text-ink-mute underline hover:text-danger"
              onClick={async () => {
                try {
                  await deleteRule(r.id);
                  await load();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              delete
            </span>
          </div>
        ))}
        {rules.length === 0 && (
          <div className="py-2 text-[12px] italic text-ink-faint">
            No rules yet — they're created here or when you recategorize a transaction.
          </div>
        )}
      </div>

      {/* Formats */}
      <div className={section}>FORMATS</div>
      <div className="mb-8 grid grid-cols-2 gap-11">
        <div className="grid grid-cols-[100px_1fr] items-center gap-2.5">
          <span className="text-[12px] italic text-ink-mute">Currency</span>
          <select className={selectCls} value={settings.currency ?? "USD"} onChange={(e) => void saveSetting("currency", e.target.value)}>
            <option value="USD">USD — $</option>
            <option value="EUR">EUR — €</option>
            <option value="GBP">GBP — £</option>
          </select>
        </div>
        <div className="grid grid-cols-[100px_1fr] items-center gap-2.5">
          <span className="text-[12px] italic text-ink-mute">Date format</span>
          <select
            className={`${selectCls} font-mono text-[12px]`}
            value={settings.date_format ?? "YYYY-MM-DD"}
            onChange={(e) => void saveSetting("date_format", e.target.value)}
          >
            <option value="YYYY-MM-DD">2026-07-11 (ISO)</option>
            <option value="MM/DD/YYYY">07/11/2026</option>
          </select>
        </div>
      </div>

      {/* AI assist */}
      <div className={section}>
        AI CATEGORIZATION ASSIST
        <div
          onClick={() => void saveSetting("ai_assist_enabled", aiEnabled ? "0" : "1")}
          className="relative h-[18px] w-[34px] cursor-pointer border border-accent"
          style={{ background: aiEnabled ? "rgba(47,93,69,0.15)" : "transparent" }}
          title={aiEnabled ? "Turn AI assist off" : "Turn AI assist on"}
        >
          <div
            className="absolute top-[2px] h-3 w-3 transition-[left]"
            style={{ left: aiEnabled ? 18 : 2, background: aiEnabled ? "#2F5D45" : "rgba(31,38,30,0.35)" }}
          />
        </div>
      </div>
      <div className={note}>
        Only the merchant name and amount are sent — never dates, accounts, or balances. Suggestions always pass your
        review before anything enters the ledger. Off by default.
      </div>
      {aiEnabled && (
        <div className="mb-2 grid grid-cols-[100px_340px_auto] items-center gap-2.5">
          <span className="text-[12px] italic text-ink-mute">API key</span>
          <input
            type="password"
            className="border-0 border-b border-ink/40 bg-transparent px-0.5 py-1 font-mono text-[12px] text-ink focus:border-accent"
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setKeySaved(false);
            }}
          />
          <button
            className={ghostBtn}
            onClick={async () => {
              try {
                await setApiKey(key.trim());
                setKeySaved(true);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {keySaved ? "✓ saved" : "Save key"}
          </button>
        </div>
      )}
      {aiEnabled && (
        <div className="mb-8 text-[11px] italic text-ink-faint">
          Stored in a local file on this Mac (never in the ledger database, never in exports).
        </div>
      )}

      {/* Backup & export */}
      <div className={section}>BACKUP &amp; EXPORT</div>
      <div className={note}>
        Everything lives in one local file. Exports include all transactions, budgets, tiers, and rules — never the
        API key.
      </div>
      <div className="mb-2 flex gap-2.5">
        <button
          className="cursor-pointer border border-ink/40 bg-transparent px-3.5 py-2 font-courier text-[11.5px] text-ink hover:bg-ink/[0.06]"
          onClick={async () => {
            try {
              const data = await gatherBackupData();
              const path = await exportTextFile(
                `moneta-backup-${new Date().toISOString().slice(0, 10)}.json`,
                buildBackup({ exportedAt: new Date().toISOString(), ...data }),
              );
              setExportNote(path ? `✓ backup saved to ${path}` : null);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Export JSON backup
        </button>
        <button
          className="cursor-pointer border border-ink/40 bg-transparent px-3.5 py-2 font-courier text-[11.5px] text-ink hover:bg-ink/[0.06]"
          onClick={async () => {
            try {
              const rows = await queryTransactions({ start: "0000-01-01", end: "9999-12-31", sortKey: "date", sortDir: "asc" });
              const path = await exportTextFile(
                `moneta-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
                buildTransactionsCsv(rows),
              );
              setExportNote(path ? `✓ ${rows.length} transactions saved to ${path}` : null);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Export transactions CSV
        </button>
        <button
          className="cursor-pointer border border-ink/40 bg-transparent px-3.5 py-2 font-courier text-[11.5px] text-ink hover:bg-ink/[0.06]"
          onClick={async () => {
            try {
              const picked = await importTextFile("Moneta backup", ["json"]);
              if (!picked) return;
              const backup = parseBackup(picked.contents); // throws a readable reason
              setPendingRestore({ file: picked.path, backup });
              setExportNote(null);
              setError(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Restore from backup…
        </button>
      </div>
      {pendingRestore && (
        <div className="mb-4 border-[1.5px] border-dashed border-danger/50 bg-danger/[0.04] px-4 py-3.5">
          <div className="mb-2 font-courier text-[10px] tracking-[0.15em] text-danger">
            RESTORE REPLACES EVERYTHING CURRENTLY IN THE LEDGER
          </div>
          <div className="mb-1 font-mono text-[12px]">{pendingRestore.file}</div>
          <div className="mb-3 text-[12px] italic text-ink-mute">
            Backup from {pendingRestore.backup.exportedAt.slice(0, 10)} ·{" "}
            <span className="font-mono not-italic">{pendingRestore.backup.data.transactions.length}</span> transactions ·{" "}
            <span className="font-mono not-italic">{pendingRestore.backup.data.accounts.length}</span> accounts ·{" "}
            <span className="font-mono not-italic">{pendingRestore.backup.data.rules.length}</span> rules ·{" "}
            <span className="font-mono not-italic">{pendingRestore.backup.data.budgets.length}</span> budget rows ·{" "}
            <span className="font-mono not-italic">{pendingRestore.backup.data.goals.length}</span> goals
          </div>
          <div className="flex items-center gap-3">
            <button
              className="cursor-pointer border-0 bg-danger px-3.5 py-2 font-courier text-[11.5px] font-bold text-paper hover:bg-danger/85 disabled:bg-ink/15 disabled:text-ink-mute"
              disabled={restoring}
              onClick={async () => {
                setRestoring(true);
                try {
                  await restoreBackup(pendingRestore.backup);
                  setPendingRestore(null);
                  setExportNote(`✓ ledger restored from ${pendingRestore.file}`);
                  await load();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setRestoring(false);
                }
              }}
            >
              {restoring ? "Restoring…" : "Replace ledger with this backup"}
            </button>
            <span
              className="cursor-pointer font-courier text-[11px] text-ink-mute underline"
              onClick={() => setPendingRestore(null)}
            >
              cancel — nothing was changed
            </span>
          </div>
        </div>
      )}
      {exportNote && <div className="mb-8 font-courier text-[11px] text-accent">{exportNote}</div>}
      {!exportNote && <div className="mb-8" />}

      {/* Danger zone */}
      <div className="border-l-[3px] border-danger bg-danger/5 px-4 py-3.5">
        <div className="mb-2 font-courier text-[10.5px] tracking-[0.2em] text-danger">DANGER ZONE</div>
        <div className="mb-3 text-[12px] italic text-ink-mute">
          Deletes every transaction, budget, rule, goal, and profile from this Mac. There is no cloud copy to restore
          from — export a backup first.
        </div>
        {!wipeConfirm ? (
          <button
            className="cursor-pointer border border-danger/60 bg-transparent px-3.5 py-2 font-courier text-[11.5px] text-danger hover:bg-danger/10"
            onClick={() => setWipeConfirm(true)}
          >
            Wipe all data…
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12px] italic text-ink-mute">
              Type <span className="font-mono not-italic text-danger">WIPE</span> to confirm:
            </span>
            <input
              className="w-24 border-0 border-b border-danger/60 bg-transparent px-0.5 py-1 font-mono text-[12px] text-ink focus:border-danger"
              value={wipeText}
              onChange={(e) => setWipeText(e.target.value)}
            />
            <button
              className="cursor-pointer border-0 bg-danger px-3.5 py-2 font-courier text-[11.5px] font-bold text-paper hover:bg-danger/85 disabled:bg-ink/15 disabled:text-ink-mute"
              disabled={wipeText !== "WIPE"}
              onClick={async () => {
                try {
                  await wipeAllData();
                  setWipeConfirm(false);
                  setWipeText("");
                  setExportNote(null);
                  await load();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Erase everything
            </button>
            <span
              className="cursor-pointer font-courier text-[11px] text-ink-mute underline"
              onClick={() => {
                setWipeConfirm(false);
                setWipeText("");
              }}
            >
              cancel
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
