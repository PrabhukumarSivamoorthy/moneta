import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getDb } from "./db/client";
import { logError, logInfo } from "./platform/log";
import "./styles.css";

// Anything that escapes React lands in the log file too.
window.addEventListener("error", (e) => {
  void logError("window", `${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  void logError("promise", String(e.reason));
});
void logInfo("app", "webview started");

// Open the database eagerly so migrations run at launch rather than on the
// first screen that happens to query.
const dbReady = getDb().catch((e) => console.error("Database init failed:", e));

// Dev-only import smoke test (see src/dev/e2eImport.ts). Dead code in
// production builds.
if (import.meta.env.DEV && import.meta.env.VITE_E2E) {
  void dbReady
    .then(() => import("./dev/e2eImport"))
    .then((m) => m.runE2eImport())
    .catch((e) => console.error("[e2e-import] failed:", e));
}

async function start() {
  // The display currency must be known before the first amounts render.
  try {
    const { getAllSettings } = await import("./db/repo/settings");
    const { setDisplayCurrency } = await import("./lib/money");
    const settings = await getAllSettings();
    if (settings.currency) setDisplayCurrency(settings.currency);
  } catch {
    // Browser dev / E2E without a settings table: USD default stands.
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
