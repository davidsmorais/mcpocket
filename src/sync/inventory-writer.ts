import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InventoryItem } from './inventory.js';
import type { Manifest, ManifestEntry } from './manifest.js';
import { hashFile } from './manifest.js';

/**
 * Copy each inventory item from its source into the pocket at item.pocketPath
 * and produce a manifest entry. Returns the count copied and the new entries.
 */
export function writeInventoryItems(
  items: InventoryItem[],
  pocketDir: string,
): { copied: number; entries: ManifestEntry[] } {
  let copied = 0;
  const entries: ManifestEntry[] = [];

  for (const it of items) {
    if (!fs.existsSync(it.sourceAbs)) continue;
    const dest = path.join(pocketDir, ...it.pocketPath.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(it.sourceAbs, dest);
    copied++;
    entries.push({
      id: it.id,
      tool: it.tool,
      category: it.category,
      scope: it.scope,
      sourcePath: it.sourcePath,
      pocketPath: it.pocketPath,
      contentHash: hashFile(it.sourceAbs),
    });
  }

  return { copied, entries };
}

/**
 * Remove pocket files that match a previous manifest's selection but are not
 * in the new entries (pruning). Only touches paths recorded in the previous
 * manifest — never touches unrelated pocket files.
 */
export function prunePocketUsingManifest(
  pocketDir: string,
  previousManifest: Manifest | null,
  newEntries: ManifestEntry[],
): number {
  if (!previousManifest) return 0;
  const newIds = new Set(newEntries.map((e) => e.id));
  let removed = 0;
  for (const old of previousManifest.entries) {
    if (newIds.has(old.id)) continue;
    const abs = path.join(pocketDir, ...old.pocketPath.split('/'));
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
        removed++;
      } catch {
        // ignore
      }
    }
  }
  return removed;
}
