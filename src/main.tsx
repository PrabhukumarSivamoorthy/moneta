import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getDb } from "./db/client";
import "./styles.css";

// Open the database eagerly so migrations run at launch rather than on the
// first screen that happens to query.
getDb().catch((e) => console.error("Database init failed:", e));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
