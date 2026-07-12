/**
 * Browser-side Tauri IPC stub for E2E tests. Injected via
 * page.addInitScript({ path }) BEFORE the app loads, it emulates the SQL
 * plugin, the API-key commands, the save dialog, and the Anthropic API, so
 * every screen runs its real code path against a deterministic dataset.
 *
 * All dates are generated relative to "today" so the suite never rots:
 * current-month days 1–11 (safe in every month) plus trailing-month history
 * for recurring detection and the forecast.
 *
 * Captures for assertions:
 *   window.__executed  — every SQL write (query strings)
 *   window.__written   — files written via write_text_file
 *   window.__aiCalls   — request bodies sent to the stubbed Anthropic API
 */
(() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const iso = (yy, mm0, dd) =>
    `${yy}-${String(mm0 + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  /** Day `dd` of the month `off` months from now (dd must be ≤ 28). */
  const day = (off, dd) => {
    const am = y * 12 + m + off;
    return iso(Math.floor(am / 12), am % 12, dd);
  };
  const CUR_MONTH = day(0, 1).slice(0, 7);

  const CATS = [
    { id: 1, name: "Housing", parent_id: null, default_tier: "need", is_archived: 0, is_system: 0 },
    { id: 2, name: "Groceries", parent_id: null, default_tier: "need", is_archived: 0, is_system: 0 },
    { id: 3, name: "Dining", parent_id: null, default_tier: "comfortable", is_archived: 0, is_system: 0 },
    { id: 4, name: "Shopping", parent_id: null, default_tier: "luxury", is_archived: 0, is_system: 0 },
    { id: 5, name: "Subscriptions", parent_id: null, default_tier: "comfortable", is_archived: 0, is_system: 0 },
    { id: 11, name: "Income", parent_id: null, default_tier: "comfortable", is_archived: 0, is_system: 1 },
    { id: 12, name: "Lent & borrowed", parent_id: null, default_tier: "comfortable", is_archived: 0, is_system: 1 },
    { id: 13, name: "Investing transfer", parent_id: null, default_tier: "comfortable", is_archived: 0, is_system: 1 },
    { id: 14, name: "Card payment", parent_id: null, default_tier: "comfortable", is_archived: 0, is_system: 1 },
  ];
  const catById = Object.fromEntries(CATS.map((c) => [c.id, c]));

  let nextId = 1;
  const tx = (date, cents, merch, catId, opts = {}) => ({
    id: nextId++,
    date,
    amount_cents: cents,
    merchant_raw: (opts.raw ?? merch).toUpperCase(),
    merchant_normalized: merch,
    account_id: opts.account ?? 1,
    account_name: opts.accountName ?? "Chase Checking",
    category_id: catId,
    category_name: catId ? catById[catId].name : null,
    category_default_tier: catId ? catById[catId].default_tier : null,
    category_is_system: catId ? catById[catId].is_system : 0,
    categorization_source: opts.source ?? (catId ? "rule" : "none"),
    tier_override: opts.tierOverride ?? null,
    upload_id: opts.manual ? null : 1,
  });

  const TXS = [
    // Current month spending across tiers (days 1–11 exist in every month).
    tx(day(0, 1), -180000, "Camber Prop Mgmt", 1),
    tx(day(0, 2), -8427, "Whole Foods", 2),
    tx(day(0, 3), -5793, "Trader Joe S", 2),
    tx(day(0, 8), -38642, "Sushi Kashiba", 3, { source: "manual" }),
    tx(day(0, 4), -9620, "Bar Melusine", 3),
    tx(day(0, 6), -21397, "Uniqlo", 4),
    tx(day(0, 10), -1850, "Zelle Maya Lunch", 3, { tierOverride: "luxury" }),
    // Uncategorized spend (AI suggestion targets).
    tx(day(0, 9), -1549, "Netflix.com", null),
    tx(day(0, 5), -1199, "Spotify USA", null),
    // Income, lending, investing, card payment (system categories).
    tx(day(0, 5), 425000, "Acme Corp Direct Dep Payroll", 11),
    tx(day(0, 6), 30000, "Freelance Logo Work", 11, { manual: true, source: "manual" }),
    tx(day(0, 8), -25000, "Zelle Payment To Sam K", 12),
    tx(day(0, 10), 10000, "Zelle Payment From Sam K", 12),
    tx(day(-1, 15), 50000, "Zelle Payment From Dad", 12),
    tx(day(0, 1), -50000, "Robinhood Deposit", 13),
    tx(day(0, 7), 120000, "Etrade Withdrawal", 13),
    tx(day(0, 6), -128440, "Amex Epayment Ach Pmt", 14),
    // Recurring history: Netflix + Spotify, three trailing months each.
    tx(day(-1, 9), -1549, "Netflix.com", 5, { source: "manual" }),
    tx(day(-2, 9), -1549, "Netflix.com", 5, { source: "manual" }),
    tx(day(-3, 9), -1549, "Netflix.com", 5, { source: "manual" }),
    tx(day(-1, 5), -1199, "Spotify USA", 5, { source: "manual" }),
    tx(day(-2, 5), -1199, "Spotify USA", 5, { source: "manual" }),
    tx(day(-3, 5), -1199, "Spotify USA", 5, { source: "manual" }),
    // Forecast history: income + bulk spend in the three trailing months.
    tx(day(-1, 5), 425000, "Acme Corp Direct Dep Payroll", 11),
    tx(day(-2, 5), 425000, "Acme Corp Direct Dep Payroll", 11),
    tx(day(-3, 5), 425000, "Acme Corp Direct Dep Payroll", 11),
    tx(day(-1, 15), -250000, "Misc Spend", 2),
    tx(day(-2, 15), -250000, "Misc Spend", 2),
    tx(day(-3, 15), -250000, "Misc Spend", 2),
  ];

  const ACCOUNTS = [
    { id: 1, name: "Chase Checking", type: "checking", balance_cents: 842000, balance_as_of: day(0, 10) },
    { id: 2, name: "E*TRADE", type: "brokerage", balance_cents: 2450000, balance_as_of: day(0, 1) },
    { id: 3, name: "Amex Gold", type: "credit card", balance_cents: 128440, balance_as_of: day(0, 10) },
  ];

  const BUDGETS = [
    { category_id: 1, month: CUR_MONTH, amount_cents: 190000 }, // Housing 94.7% → warn
    { category_id: 2, month: CUR_MONTH, amount_cents: 52000 }, // Groceries ~27% → ok
    { category_id: 3, month: CUR_MONTH, amount_cents: 32000 }, // Dining over → over
    { category_id: 4, month: CUR_MONTH, amount_cents: 25000 }, // Shopping ~86% → warn
    { category_id: 5, month: CUR_MONTH, amount_cents: 9000 },
  ];

  const RULES = [
    { id: 1, matcher: "whole foods", match_type: "contains", category_id: 2, priority: 10, created_from: "correction" },
  ];

  const SETTINGS = [
    { key: "tier_target_need", value: "50" },
    { key: "tier_target_comfortable", value: "30" },
    { key: "tier_target_luxury", value: "20" },
    { key: "currency", value: "USD" },
    { key: "date_format", value: "YYYY-MM-DD" },
    { key: "ai_assist_enabled", value: "1" },
    { key: "income_plan_cents", value: "430000" },
    { key: "recurring_stopped", value: "[]" },
  ];

  const GOALS = [
    { id: 1, name: "Japan trip", target_cents: 200000, target_month: day(6, 1).slice(0, 7), saved_cents: 120000 },
  ];

  const PROFILES = [
    {
      id: 1,
      name: "Chase Checking CSV",
      delimiter: ",",
      date_format: "MM/DD/YYYY",
      column_map_json: JSON.stringify({ date: "Transaction Date", description: "Description", amount: "Amount" }),
      sign_convention: "debits_negative",
    },
  ];

  window.__executed = [];
  window.__written = [];
  window.__aiCalls = [];

  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: async (cmd, args) => {
      if (cmd === "get_api_key") return "sk-ant-e2e-stub";
      if (cmd === "set_api_key") return null;
      if (cmd === "plugin:dialog|save")
        return "/tmp/e2e/" + ((args.options && args.options.defaultPath) || "file.txt");
      if (cmd === "write_text_file") {
        window.__written.push({ path: args.path, contents: args.contents });
        return null;
      }
      if (cmd === "plugin:sql|load") return "sqlite:moneta.db";
      if (cmd === "plugin:sql|execute") {
        window.__executed.push(args.query);
        return [1, 999];
      }
      if (cmd === "plugin:sql|select") {
        const q = (args && args.query) || "";
        if (q.includes("COALESCE(MAX(priority)")) return [{ next: 20 }];
        if (q.includes("COUNT(t.id)"))
          return ACCOUNTS.map((a) => ({ ...a, entry_count: 5, last_date: day(0, 10) }));
        if (q.includes("COUNT(*) AS n FROM transactions")) return [{ n: TXS.length }];
        if (q.includes("SELECT * FROM")) {
          const table = q.replace("SELECT * FROM", "").trim();
          if (table === "accounts") return ACCOUNTS;
          if (table === "categories") return CATS;
          if (table === "transactions") return TXS;
          if (table === "rules") return RULES;
          if (table === "budgets") return BUDGETS;
          if (table === "goals") return GOALS;
          if (table === "bank_profiles") return PROFILES;
          if (table === "uploads") return [];
          return [];
        }
        if (q.includes("FROM transactions")) {
          const p = (args && args.values) || [];
          const start = p[0], end = p[1];
          return TXS.filter((t) => (!start || t.date >= start) && (!end || t.date <= end));
        }
        if (q.includes("FROM accounts")) return ACCOUNTS;
        if (q.includes("FROM categories")) {
          let rows = CATS;
          if (q.includes("is_archived = 0")) rows = rows.filter((c) => !c.is_archived);
          if (q.includes("is_system = 0")) rows = rows.filter((c) => !c.is_system);
          return rows;
        }
        if (q.includes("FROM bank_profiles")) return PROFILES;
        if (q.includes("FROM rules")) return RULES;
        if (q.includes("FROM budgets")) return BUDGETS;
        if (q.includes("FROM goals")) return GOALS;
        if (q.includes("FROM settings")) return SETTINGS;
        return [];
      }
      return null;
    },
  };

  // Stubbed Anthropic API: categorization suggestions and PDF extraction.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    if (!String(url).includes("api.anthropic.com")) return realFetch(url, opts);
    const body = JSON.parse(opts.body);
    window.__aiCalls.push(opts.body);
    const tool = body.tool_choice && body.tool_choice.name;
    let input;
    if (tool === "categorize") {
      const netflix = TXS.find((t) => t.merchant_normalized === "Netflix.com" && !t.category_id);
      const spotify = TXS.find((t) => t.merchant_normalized === "Spotify USA" && !t.category_id);
      input = { assignments: [
        { id: netflix.id, category: "Subscriptions" },
        { id: spotify.id, category: "Subscriptions" },
      ] };
    } else {
      input = { rows: [
        { date: day(0, 2), description: "ALASKA AIR 0272316546211", amount_cents: -56000 },
        { date: day(0, 3), description: "BARTELL DRUGS #24 SEATTLE", amount_cents: -2235 },
        { date: "garbage", description: "BROKEN", amount_cents: -1 },
      ] };
    }
    return new Response(
      JSON.stringify({ content: [{ type: "tool_use", name: tool, input }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
})();
