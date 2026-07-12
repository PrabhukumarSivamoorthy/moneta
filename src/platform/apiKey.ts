/**
 * Anthropic API key access. The key lives in a local secret file managed by
 * Rust commands (src-tauri/src/lib.rs) — outside the repo, outside the
 * database, so ledger exports can never include it.
 */
import { invoke } from "@tauri-apps/api/core";

export function getApiKey(): Promise<string | null> {
  return invoke<string | null>("get_api_key");
}

export function setApiKey(key: string): Promise<void> {
  return invoke<void>("set_api_key", { key });
}
