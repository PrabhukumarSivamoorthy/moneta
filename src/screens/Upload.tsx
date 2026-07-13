import { useEffect, useMemo, useRef, useState } from "react";
import { parseStatement } from "../lib/csv/parse";
import { normalizeMerchant } from "../lib/csv/normalize";
import { flagDuplicates, type DedupFlags } from "../lib/dedup";
import type { BankProfileSpec, ParseResult } from "../lib/csv/types";
import { formatCents } from "../lib/money";
import {
  createAccount,
  listAccounts,
  type Account,
} from "../db/repo/accounts";
import {
  createBankProfile,
  listBankProfiles,
  updateBankProfile,
  type BankProfile,
} from "../db/repo/bankProfiles";
import { createUpload } from "../db/repo/uploads";
import { existingHashes, insertImported } from "../db/repo/transactions";
import { listRules } from "../db/repo/rules";
import { applyRules } from "../lib/rules";
import { extractStatementPdf } from "../lib/ai";
import { getApiKey } from "../platform/apiKey";

type Step = "a" | "b" | "c";

interface LoadedFile {
  name: string;
  text: string;
}

interface PendingPdf {
  name: string;
  sizeBytes: number;
  base64: string;
}

/** PDF imports still need an uploads.bank_profile_id row; a stub profile
 * named "PDF import" is created on first use. */
const PDF_PROFILE_NAME = "PDF import";

interface ReviewRow {
  line: number;
  date: string;
  amountCents: number;
  merchantRaw: string;
  merchantNormalized: string;
  flags: DedupFlags;
  include: boolean;
}

interface CommitSummary {
  filename: string;
  inserted: number;
  skippedDuplicates: number;
  failedRows: number;
  autoCategorized: number;
}

const EMPTY_SPEC: BankProfileSpec = {
  delimiter: ",",
  dateFormat: "YYYY-MM-DD",
  columnMap: { date: "Date", description: "Description", amount: "Amount" },
  signConvention: "debits_negative",
};

const label =
  "font-courier text-[10.5px] tracking-[0.2em] text-ink-mute mb-3.5 border-t border-rule pt-3";
const fieldLabel = "text-[12px] text-ink-mute italic";
const selectCls =
  "w-full bg-transparent border-0 border-b border-ink/40 px-0.5 py-[7px] text-[13px] text-ink cursor-pointer font-serif focus:border-accent";
const inputCls =
  "w-full bg-transparent border-0 border-b border-ink/40 px-0.5 py-[7px] text-[13px] text-ink font-serif focus:border-accent";
const primaryBtn =
  "bg-accent text-paper border-0 px-5 py-[11px] font-courier text-[12.5px] font-bold cursor-pointer hover:bg-accent/90 disabled:bg-ink/15 disabled:text-ink-mute disabled:cursor-default";
const ghostBtn =
  "bg-transparent text-ink border border-ink/35 px-5 py-[10px] font-courier text-[12.5px] cursor-pointer hover:bg-ink/[0.07]";

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; num: string; label: string }[] = [
    { id: "a", num: "01", label: "CHOOSE & MAP" },
    { id: "b", num: "02", label: "REVIEW ROWS" },
    { id: "c", num: "03", label: "CONFIRM" },
  ];
  return (
    <div className="flex items-center gap-3.5 pb-4">
      {steps.map((s, i) => {
        const active = s.id === step;
        return (
          <div key={s.id} className="flex items-center gap-3.5">
            <div
              className={`flex items-center gap-2 border-b-2 pb-1 ${
                active ? "border-accent" : "border-transparent"
              }`}
            >
              <span
                className={`font-courier text-[11px] font-bold ${
                  active ? "text-accent" : "text-ink-faint"
                }`}
              >
                {s.num}
              </span>
              <span
                className={`font-courier text-[12px] tracking-[0.08em] ${
                  active ? "font-bold text-ink" : "text-ink-mute"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className="text-[11px] text-ink-faint">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Editor for creating or editing a bank profile's mapping. */
function ProfileEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: { name: string; spec: BankProfileSpec } | null;
  onSave: (name: string, spec: BankProfileSpec) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [spec, setSpec] = useState<BankProfileSpec>(initial?.spec ?? EMPTY_SPEC);
  const [saving, setSaving] = useState(false);
  const twoColumn = spec.columnMap.amount === undefined;

  const setMap = (patch: Partial<BankProfileSpec["columnMap"]>) =>
    setSpec((s) => ({ ...s, columnMap: { ...s.columnMap, ...patch } }));

  return (
    <div className="mt-4 border border-rule bg-ink/[0.02] p-4">
      <div className="mb-3 font-courier text-[10.5px] tracking-[0.2em] text-ink-mute">
        {initial ? "EDIT PROFILE" : "NEW PROFILE"}
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
          <span className={fieldLabel}>Profile name</span>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chase Checking"
          />
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
          <span className={fieldLabel}>Delimiter</span>
          <select
            className={selectCls}
            value={spec.delimiter}
            onChange={(e) => setSpec((s) => ({ ...s, delimiter: e.target.value }))}
          >
            <option value=",">Comma ( , )</option>
            <option value=";">Semicolon ( ; )</option>
            <option value="	">Tab</option>
          </select>
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
          <span className={fieldLabel}>Date format</span>
          <select
            className={selectCls}
            value={spec.dateFormat}
            onChange={(e) =>
              setSpec((s) => ({ ...s, dateFormat: e.target.value as BankProfileSpec["dateFormat"] }))
            }
          >
            <option>YYYY-MM-DD</option>
            <option>MM/DD/YYYY</option>
            <option>DD.MM.YYYY</option>
          </select>
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
          <span className={fieldLabel}>Date column</span>
          <input className={inputCls} value={spec.columnMap.date} onChange={(e) => setMap({ date: e.target.value })} />
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
          <span className={fieldLabel}>Description</span>
          <input
            className={inputCls}
            value={spec.columnMap.description}
            onChange={(e) => setMap({ description: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
          <span className={fieldLabel}>Amount</span>
          <select
            className={selectCls}
            value={twoColumn ? "pair" : "single"}
            onChange={(e) =>
              e.target.value === "pair"
                ? setSpec((s) => ({
                    ...s,
                    columnMap: { date: s.columnMap.date, description: s.columnMap.description, debit: s.columnMap.debit ?? "Debit", credit: s.columnMap.credit ?? "Credit" },
                  }))
                : setSpec((s) => ({
                    ...s,
                    columnMap: { date: s.columnMap.date, description: s.columnMap.description, amount: "Amount" },
                  }))
            }
          >
            <option value="single">Single amount column</option>
            <option value="pair">Debit / Credit (two columns)</option>
          </select>
        </div>
        {twoColumn ? (
          <>
            <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
              <span className={fieldLabel}>Debit column</span>
              <input className={inputCls} value={spec.columnMap.debit ?? ""} onChange={(e) => setMap({ debit: e.target.value })} />
            </div>
            <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
              <span className={fieldLabel}>Credit column</span>
              <input className={inputCls} value={spec.columnMap.credit ?? ""} onChange={(e) => setMap({ credit: e.target.value })} />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
            <span className={fieldLabel}>Amount column</span>
            <input className={inputCls} value={spec.columnMap.amount ?? ""} onChange={(e) => setMap({ amount: e.target.value })} />
          </div>
        )}
        <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
          <span className={fieldLabel}>Debits are</span>
          <div className="flex gap-2">
            {(["debits_negative", "debits_positive"] as const).map((c) => (
              <span
                key={c}
                onClick={() => setSpec((s) => ({ ...s, signConvention: c }))}
                className={`cursor-pointer border px-2.5 py-1 font-courier text-[11px] ${
                  spec.signConvention === c
                    ? "border-accent font-bold text-accent"
                    : "border-ink/25 text-ink-mute hover:border-ink/50"
                }`}
              >
                {c === "debits_negative" ? "Negative" : "Positive"}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className={ghostBtn} onClick={onCancel}>
          Cancel
        </button>
        <button
          className={primaryBtn}
          disabled={!name.trim() || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(name.trim(), spec);
            } finally {
              setSaving(false);
            }
          }}
        >
          Save profile
        </button>
      </div>
    </div>
  );
}

export default function Upload() {
  const [step, setStep] = useState<Step>("a");
  const [dbError, setDbError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [profiles, setProfiles] = useState<BankProfile[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [editingProfile, setEditingProfile] = useState<"new" | "edit" | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("checking");

  const [file, setFile] = useState<LoadedFile | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** PDF awaiting per-file consent — nothing is sent until confirmed. */
  const [pendingPdf, setPendingPdf] = useState<PendingPdf | null>(null);
  const [pdfParsed, setPdfParsed] = useState<ParseResult | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const [reviewRows, setReviewRows] = useState<ReviewRow[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState<CommitSummary | null>(null);

  const refresh = async () => {
    try {
      const [a, p] = await Promise.all([listAccounts(), listBankProfiles()]);
      setAccounts(a);
      setProfiles(p);
      setAccountId((id) => id ?? a[0]?.id ?? null);
      setProfileId((id) => id ?? p[0]?.id ?? null);
      setDbError(null);
    } catch (e) {
      setDbError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const profile = profiles.find((p) => p.id === profileId) ?? null;

  /** Parse eagerly whenever file + profile are both present. */
  const csvParsed: ParseResult | null = useMemo(() => {
    if (!file || !profile) return null;
    return parseStatement(file.text, profile);
  }, [file, profile]);

  const parsed = pdfParsed ?? csvParsed;
  const sourceName = pdfName ?? file?.name ?? null;

  const loadFile = async (f: File) => {
    if (/\.pdf$/i.test(f.name)) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      setPendingPdf({ name: f.name, sizeBytes: buf.length, base64: btoa(bin) });
      setFile(null);
      setPdfParsed(null);
      setPdfName(null);
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    setPdfParsed(null);
    setPdfName(null);
    setPendingPdf(null);
  };

  /** Runs ONLY from the consent dialog's confirm button. */
  const extractPdf = async () => {
    if (!pendingPdf) return;
    setExtracting(true);
    try {
      const key = await getApiKey();
      if (!key) {
        setDbError("PDF extraction needs an Anthropic API key — add one in Settings → AI categorization assist.");
        return;
      }
      const result = await extractStatementPdf(key, pendingPdf.base64);
      setPdfParsed(result);
      setPdfName(pendingPdf.name);
      setPendingPdf(null);
      setDbError(null);
    } catch (e) {
      setDbError(String(e));
    } finally {
      setExtracting(false);
    }
  };

  const ensurePdfProfileId = async (): Promise<number> => {
    const existing = profiles.find((p) => p.name === PDF_PROFILE_NAME);
    if (existing) return existing.id;
    const created = await createBankProfile(PDF_PROFILE_NAME, {
      delimiter: ",",
      dateFormat: "YYYY-MM-DD",
      columnMap: { date: "Date", description: "Description", amount: "Amount" },
      signConvention: "debits_negative",
    });
    return created.id;
  };

  const toReview = async () => {
    if (!parsed || accountId === null) return;
    const normalized = parsed.rows.map((r) => ({
      ...r,
      merchantNormalized: normalizeMerchant(r.merchantRaw),
    }));
    let existing: Set<string>;
    try {
      existing = await existingHashes(accountId);
    } catch (e) {
      setDbError(String(e));
      return;
    }
    const flags = await flagDuplicates(normalized, accountId, existing);
    setReviewRows(
      normalized.map((r, i) => ({
        ...r,
        flags: flags[i],
        include: !flags[i].duplicateOfDb && !flags[i].duplicateInFile,
      })),
    );
    setStep("b");
  };

  const commit = async () => {
    if (!reviewRows || !sourceName || accountId === null) return;
    if (pdfParsed === null && profileId === null) return;
    setCommitting(true);
    try {
      const included = reviewRows.filter((r) => r.include);
      const rules = await listRules();
      const rows = included.map((r) => ({
        date: r.date,
        amountCents: r.amountCents,
        merchantRaw: r.merchantRaw,
        merchantNormalized: r.merchantNormalized,
        dedupHash: r.flags.hash,
        categoryId: applyRules(rules, r.merchantNormalized),
      }));
      const uploadProfileId = pdfParsed !== null ? await ensurePdfProfileId() : profileId!;
      const uploadId = await createUpload(accountId, uploadProfileId, sourceName, included.length);
      await insertImported(uploadId, accountId, rows);
      setSummary({
        filename: sourceName,
        inserted: included.length,
        skippedDuplicates: reviewRows.filter((r) => !r.include).length,
        failedRows: parsed?.errors.length ?? 0,
        autoCategorized: rows.filter((r) => r.categoryId != null).length,
      });
      setStep("c");
    } catch (e) {
      setDbError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPendingPdf(null);
    setPdfParsed(null);
    setPdfName(null);
    setReviewRows(null);
    setSummary(null);
    setStep("a");
  };

  return (
    <div>
      {/* Frozen while the review list scrolls (design: sticky header block). */}
      <div className="sticky top-0 z-20 border-b border-[rgba(31,38,30,0.18)] bg-paper pt-0.5">
        <div className="mb-1 text-[20px] font-semibold">Upload &amp; review</div>
        <div className="mb-5 text-[12.5px] italic text-ink-mute">
          Nothing enters the ledger until you confirm in step 3.
        </div>

        {dbError && (
          <div className="mb-5 border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
            Database error: {dbError}
          </div>
        )}

        <StepIndicator step={step} />
      </div>
      <div className="h-6" />

      {step === "a" && (
        <>
          <div className="grid grid-cols-2 gap-11">
            {/* Statement file */}
            <div>
              <div className={label}>STATEMENT FILE</div>
              {pendingPdf ? (
                <div className="border-[1.5px] border-dashed border-danger/50 bg-danger/[0.04] px-4 py-4">
                  <div className="mb-2 font-courier text-[10px] tracking-[0.15em] text-danger">
                    PDF EXTRACTION — SENDS THE STATEMENT TO ANTHROPIC
                  </div>
                  <div className="mb-1 font-mono text-[12.5px]">
                    {pendingPdf.name} · {(pendingPdf.sizeBytes / 1024).toFixed(0)} KB
                  </div>
                  <div className="mb-3 text-[12px] italic leading-[1.6] text-ink-mute">
                    Reading a PDF needs the model to see it: the full document — every transaction, name, and number on
                    it — will be sent once to api.anthropic.com for extraction. Nothing is sent until you confirm, and
                    the extracted rows still pass your review before entering the ledger.
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void extractPdf()}
                      disabled={extracting}
                      className="cursor-pointer border-0 bg-ink px-3.5 py-2 font-courier text-[11px] font-bold text-paper hover:bg-accent disabled:bg-ink/15 disabled:text-ink-mute"
                    >
                      {extracting ? "Extracting…" : "Send & extract"}
                    </button>
                    <span
                      onClick={() => setPendingPdf(null)}
                      className="cursor-pointer font-courier text-[11px] text-ink-mute underline hover:text-ink"
                    >
                      cancel — nothing was sent
                    </span>
                  </div>
                </div>
              ) : !file && !pdfParsed ? (
                <div
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f) void loadFile(f);
                  }}
                  className={`cursor-pointer border-[1.5px] border-dashed border-accent/55 px-6 py-11 text-center ${
                    dragOver ? "bg-accent/10" : "bg-accent/[0.03] hover:bg-accent/[0.08]"
                  }`}
                >
                  <div className="mb-2.5 font-courier text-[11px] tracking-[0.15em] text-accent">.CSV · .PDF</div>
                  <div className="mb-1 text-[14px] font-medium">Drop a statement here</div>
                  <div className="text-[12px] italic text-ink-mute">
                    or click to browse — CSV parses locally; PDF asks before anything is sent for extraction
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,text/csv,.pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void loadFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              ) : (
                <div className="border border-accent/50 bg-accent/5 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="border border-accent/50 px-1.5 py-0.5 font-courier text-[10px] text-accent">
                      {pdfParsed ? "PDF" : "CSV"}
                    </span>
                    <div className="flex-1">
                      <div className="font-mono text-[12.5px]">{sourceName}</div>
                      <div className="mt-0.5 text-[11.5px] italic text-ink-mute">
                        {parsed ? (
                          <>
                            <span className="font-mono not-italic">{parsed.rows.length}</span> rows{" "}
                            {pdfParsed ? "extracted" : "parsed"} ·{" "}
                            <span className="font-mono not-italic">{parsed.errors.length}</span> rows failed
                          </>
                        ) : (
                          "select a profile to parse"
                        )}
                      </div>
                    </div>
                    <span
                      onClick={() => {
                        setFile(null);
                        setPdfParsed(null);
                        setPdfName(null);
                      }}
                      className="cursor-pointer font-courier text-[11px] text-ink-mute underline hover:text-danger"
                    >
                      remove
                    </span>
                  </div>
                </div>
              )}
              {parsed && parsed.errors.length > 0 && parsed.rows.length === 0 && (
                <div className="mt-3 border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
                  {parsed.errors[0].reason}
                </div>
              )}
            </div>

            {/* Account + bank profile */}
            <div>
              <div className={label}>ACCOUNT</div>
              <select
                className={selectCls}
                value={accountId ?? "new"}
                onChange={(e) => {
                  if (e.target.value === "new") setAddingAccount(true);
                  else setAccountId(Number(e.target.value));
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.type}
                  </option>
                ))}
                <option value="new">Create new account…</option>
              </select>
              {(addingAccount || accounts.length === 0) && (
                <div className="mt-3 flex items-end gap-2">
                  <input
                    className={inputCls}
                    placeholder="Account name"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                  />
                  <select className={selectCls} value={newAccountType} onChange={(e) => setNewAccountType(e.target.value)}>
                    <option value="checking">checking</option>
                    <option value="credit card">credit card</option>
                    <option value="savings">savings</option>
                    <option value="brokerage">brokerage</option>
                  </select>
                  <button
                    className={primaryBtn}
                    disabled={!newAccountName.trim()}
                    onClick={async () => {
                      try {
                        const a = await createAccount(newAccountName.trim(), newAccountType);
                        setNewAccountName("");
                        setAddingAccount(false);
                        await refresh();
                        setAccountId(a.id);
                      } catch (e) {
                        setDbError(String(e));
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
              )}

              <div className={`${label} mt-6`}>BANK PROFILE</div>
              <select
                className={selectCls}
                value={editingProfile === "new" ? "new" : (profileId ?? "new")}
                onChange={(e) => {
                  if (e.target.value === "new") setEditingProfile("new");
                  else {
                    setProfileId(Number(e.target.value));
                    setEditingProfile(null);
                  }
                }}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · saved profile
                  </option>
                ))}
                <option value="new">Create new profile…</option>
              </select>
              {profile && editingProfile === null && (
                <div className="mt-3 text-[12px] italic text-ink-mute">
                  {profile.dateFormat} · {profile.columnMap.amount ? `amount “${profile.columnMap.amount}”` : "debit/credit pair"} ·{" "}
                  {profile.signConvention === "debits_negative" ? "debits negative" : "debits positive"}{" "}
                  <span
                    className="cursor-pointer font-courier not-italic text-accent underline"
                    onClick={() => setEditingProfile("edit")}
                  >
                    edit
                  </span>
                </div>
              )}
              {(editingProfile !== null || profiles.length === 0) && (
                <ProfileEditor
                  initial={editingProfile === "edit" && profile ? { name: profile.name, spec: profile } : null}
                  onCancel={() => setEditingProfile(null)}
                  onSave={async (name, spec) => {
                    try {
                      if (editingProfile === "edit" && profile) {
                        await updateBankProfile(profile.id, name, spec);
                      } else {
                        const p = await createBankProfile(name, spec);
                        setProfileId(p.id);
                      }
                      setEditingProfile(null);
                      await refresh();
                    } catch (e) {
                      setDbError(String(e));
                    }
                  }}
                />
              )}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              className={primaryBtn}
              disabled={!parsed || parsed.rows.length === 0 || accountId === null}
              onClick={() => void toReview()}
            >
              {parsed && parsed.rows.length > 0 ? `Review ${parsed.rows.length} rows` : "Review rows"}
            </button>
          </div>
        </>
      )}

      {step === "b" && reviewRows && (
        <>
          <div className="mb-4 flex items-baseline gap-4">
            <span className="text-[14px]">
              <span className="font-mono">{reviewRows.filter((r) => r.include).length}</span> of{" "}
              <span className="font-mono">{reviewRows.length}</span> rows will be added
            </span>
            {reviewRows.some((r) => r.flags.duplicateOfDb || r.flags.duplicateInFile) && (
              <span className="text-[12px] italic text-ink-mute">
                duplicates are unchecked by default — tick a row to include it anyway
              </span>
            )}
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-rule">
                {["", "DATE", "MERCHANT", "AMOUNT", ""].map((h, i) => (
                  <th key={i} className="py-2 pr-4 text-left font-courier text-[10px] font-normal tracking-[0.2em] text-ink-mute">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviewRows.map((r, i) => {
                const dup = r.flags.duplicateOfDb || r.flags.duplicateInFile;
                return (
                  <tr key={r.line} className={`border-b border-rule-soft ${dup && !r.include ? "opacity-45" : ""}`}>
                    <td className="w-8 py-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        className="accent-[#2F5D45]"
                        onChange={(e) =>
                          setReviewRows((rows) =>
                            rows!.map((row, j) => (j === i ? { ...row, include: e.target.checked } : row)),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{r.date}</td>
                    <td className="py-2 pr-4">
                      <div className="text-[13px]">{r.merchantNormalized}</div>
                      <div className="font-mono text-[10.5px] text-ink-faint">{r.merchantRaw}</div>
                    </td>
                    <td className={`py-2 pr-4 text-right font-mono text-[12.5px] ${r.amountCents > 0 ? "text-accent" : ""}`}>
                      {formatCents(r.amountCents)}
                    </td>
                    <td className="py-2 text-right">
                      {r.flags.duplicateOfDb && (
                        <span className="border border-danger/40 px-1.5 py-0.5 font-courier text-[9.5px] tracking-[0.08em] text-danger">
                          IN LEDGER
                        </span>
                      )}
                      {r.flags.duplicateInFile && (
                        <span className="ml-1 border border-danger/40 px-1.5 py-0.5 font-courier text-[9.5px] tracking-[0.08em] text-danger">
                          DUP IN FILE
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {parsed && parsed.errors.length > 0 && (
            <div className="mt-6">
              <div className={label}>FAILED ROWS · NOT IMPORTED</div>
              {parsed.errors.map((e) => (
                <div key={e.line} className="flex gap-3 border-b border-rule-soft py-1.5 text-[12px]">
                  <span className="w-14 font-mono text-ink-faint">line {e.line}</span>
                  <span className="text-danger">{e.reason}</span>
                  <span className="flex-1 truncate font-mono text-[11px] text-ink-faint">{e.raw}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button className={ghostBtn} onClick={() => setStep("a")}>
              ← Back
            </button>
            <button
              className={primaryBtn}
              disabled={committing || reviewRows.every((r) => !r.include)}
              onClick={() => void commit()}
            >
              {committing ? "Adding…" : `Add ${reviewRows.filter((r) => r.include).length} entries to ledger`}
            </button>
          </div>
        </>
      )}

      {step === "c" && summary && (
        <div className="max-w-lg">
          <div className="border border-accent/50 bg-accent/5 px-6 py-6">
            <div className="mb-3 font-courier text-[11px] tracking-[0.2em] text-accent">IMPORT COMPLETE</div>
            <div className="mb-4 font-mono text-[13px]">{summary.filename}</div>
            <div className="flex flex-col gap-1.5 text-[13.5px]">
              <div>
                <span className="font-mono">{summary.inserted}</span> entries added to the ledger
              </div>
              <div className="text-ink-mute">
                <span className="font-mono">{summary.autoCategorized}</span> auto-categorized by your rules
              </div>
              <div className="text-ink-mute">
                <span className="font-mono">{summary.skippedDuplicates}</span> duplicates skipped
              </div>
              <div className="text-ink-mute">
                <span className="font-mono">{summary.failedRows}</span> rows failed to parse
              </div>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <button className={primaryBtn} onClick={reset}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
