import type CodianPlugin from '@/main';

/**
 * `onload` deliberately does not await the settings load (see its comment in
 * src/main.ts): awaiting it there would let Obsidian's plugin hang timer fire.
 * Tests, however, need a fully initialized plugin before asserting, so they go
 * through this helper instead of calling `onload` directly.
 */
export async function loadPlugin(plugin: CodianPlugin): Promise<void> {
  await plugin.onload();
  await plugin.waitForSettingsReady();
}
