import { useEffect, useState } from "react";
import { getAllSettings } from "../db/repo/settings";

/**
 * Phase 0 stub with one real behavior: it reads the seeded settings rows
 * from SQLite to prove the migration ran and the repository layer works.
 * The full settings editor arrives with its owning phases.
 */
export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <div className="mb-1 text-[20px] font-semibold">Settings</div>
      <div className="mb-6 text-[12.5px] italic text-ink-mute">
        Values below are read live from the local SQLite database.
      </div>

      {error && (
        <div className="border border-danger/50 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Could not read the database: {error}
        </div>
      )}

      {!error && settings === null && (
        <div className="text-[13px] italic text-ink-mute">Loading…</div>
      )}

      {settings && (
        <table className="w-full max-w-xl border-collapse">
          <tbody>
            {Object.entries(settings).map(([key, value]) => (
              <tr key={key} className="border-b border-rule-soft">
                <td className="py-2 pr-6 font-mono text-[12.5px] text-ink-soft">
                  {key}
                </td>
                <td className="py-2 font-mono text-[12.5px]">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
