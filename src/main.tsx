import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getDb } from "./db/client";
import "./styles.css";

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
