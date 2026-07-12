/**
 * App logging. Messages go to the Rust log plugin, which writes them to the
 * platform log directory (macOS: ~/Library/Logs/com.moneta.app/moneta.log,
 * Windows: %LOCALAPPDATA%\com.moneta.app\logs\moneta.log) and to stdout in
 * dev. Falls back to the console when the plugin is unavailable (browser
 * dev / E2E).
 */
import { error as pluginError, info as pluginInfo } from "@tauri-apps/plugin-log";

export async function logError(scope: string, message: string): Promise<void> {
  const line = `[${scope}] ${message}`;
  try {
    await pluginError(line);
  } catch {
    console.error(line);
  }
}

export async function logInfo(scope: string, message: string): Promise<void> {
  const line = `[${scope}] ${message}`;
  try {
    await pluginInfo(line);
  } catch {
    console.info(line);
  }
}
