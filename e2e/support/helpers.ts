import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Test with the Tauri IPC stub installed before the app loads. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript({ path: path.join(HERE, "tauri-stub.js") });
    await page.goto("/");
    await expect(page.getByText("MONETA", { exact: true })).toBeVisible();
    await use(page);
  },
});

export { expect };

/** Click a sidebar item by its exact label. */
export async function nav(page: Page, label: string): Promise<void> {
  await page.locator("span", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click();
}

/** SQL writes captured by the stub. */
export function executed(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __executed: string[] }).__executed);
}

/** Files written via the stubbed save dialog. */
export function written(page: Page): Promise<{ path: string; contents: string }[]> {
  return page.evaluate(() => (window as unknown as { __written: { path: string; contents: string }[] }).__written);
}

/** Request bodies sent to the stubbed Anthropic API. */
export function aiCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __aiCalls: string[] }).__aiCalls);
}
