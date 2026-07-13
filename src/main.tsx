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

async function start() {
  // Plain-browser dev (no Tauri shell, no E2E stub already installed):
  // stand up an in-browser SQLite so every real feature works. Never in the
  // packaged app — __TAURI_INTERNALS__ is already set there.
  const hasBackend = !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (import.meta.env.DEV && !hasBackend) {
    const { installBrowserBackend } = await import("./dev/browserBackend");
    await installBrowserBackend();
  }

  void logInfo("app", "webview started");

  // Open the database eagerly so migrations run at launch rather than on the
  // first screen that happens to query.
  const dbReady = getDb().catch((e) => console.error("Database init failed:", e));

  // Dev-only import smoke test (see src/dev/e2eImport.ts).
  if (import.meta.env.DEV && import.meta.env.VITE_E2E) {
    void dbReady
      .then(() => import("./dev/e2eImport"))
      .then((m) => m.runE2eImport())
      .catch((e) => console.error("[e2e-import] failed:", e));
  }

  // The display currency must be known before the first amounts render.
  try {
    const { getAllSettings } = await import("./db/repo/settings");
    const { setDisplayCurrency } = await import("./lib/money");
    const settings = await getAllSettings();
    if (settings.currency) setDisplayCurrency(settings.currency);
  } catch {
    // Missing settings table: USD default stands.
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
