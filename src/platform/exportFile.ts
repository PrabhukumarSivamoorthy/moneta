/** Native save dialog + Rust file write. Returns the chosen path, or null
 * if the user cancelled. */
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export async function exportTextFile(defaultName: string, contents: string): Promise<string | null> {
  const path = await save({ defaultPath: defaultName });
  if (!path) return null;
  await invoke("write_text_file", { path, contents });
  return path;
}
