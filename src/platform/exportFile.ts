/** Native save/open dialogs + Rust file IO. Both return null when the user
 * cancels the dialog. */
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export async function exportTextFile(defaultName: string, contents: string): Promise<string | null> {
  const path = await save({ defaultPath: defaultName });
  if (!path) return null;
  await invoke("write_text_file", { path, contents });
  return path;
}

export async function importTextFile(
  filterName: string,
  extensions: string[],
): Promise<{ path: string; contents: string } | null> {
  const path = await open({ multiple: false, filters: [{ name: filterName, extensions }] });
  if (typeof path !== "string") return null;
  const contents = await invoke<string>("read_text_file", { path });
  return { path, contents };
}
