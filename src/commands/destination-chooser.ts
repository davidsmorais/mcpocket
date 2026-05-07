import { askMultiSelect, askSingleSelect } from '../utils/prompt.js';
import { c } from '../utils/sparkle.js';
import type { ManifestEntry } from '../sync/manifest.js';
import { scopeLabel } from '../sync/manifest.js';
import {
  proposeDestination,
  availableOverrides,
  type DestinationContext,
  type ResolvedDestination,
} from '../sync/destination.js';

export interface RoutedItem {
  entry: ManifestEntry;
  destination: ResolvedDestination;
}

/**
 * Step 1: select WHICH manifest entries to pull (multi-select).
 * Step 2: for each selected entry, the user can keep or override the proposed destination.
 *
 * Returns the routed items the user accepted.
 */
export async function chooseDestinations(
  entries: ManifestEntry[],
  ctx: DestinationContext,
  options: { acceptAll?: boolean } = {},
): Promise<RoutedItem[]> {
  if (entries.length === 0) return [];

  // Step 1: filter — let user deselect items they don't want pulled
  const filtered = options.acceptAll
    ? entries
    : await pickEntriesToPull(entries);

  if (filtered.length === 0) return [];

  // Step 2: per-item destination chooser
  const routed: RoutedItem[] = [];
  for (const entry of filtered) {
    const proposed = proposeDestination(entry, ctx);

    if (options.acceptAll || !process.stdin.isTTY) {
      routed.push({ entry, destination: proposed });
      continue;
    }

    const overrides = availableOverrides(entry, ctx);
    const choices = [
      { label: `Accept: ${proposed.label}`, value: 'accept' },
      ...overrides
        .filter((o) => o.absPath !== proposed.absPath)
        .map((o) => ({ label: `Use: ${o.label}`, value: o.absPath })),
      { label: 'Skip this file', value: 'skip' },
    ];

    const header = `${c.bold(entry.pocketPath)} ${c.dim(`[${entry.tool}/${entry.category}/${scopeLabel(entry.scope)}]`)}`;
    console.log(`\n${header}`);
    const pick = await askSingleSelect('  Destination', choices);

    if (pick === 'skip') continue;
    if (pick === 'accept') {
      routed.push({ entry, destination: proposed });
    } else {
      const chosen = overrides.find((o) => o.absPath === pick);
      if (chosen) routed.push({ entry, destination: chosen });
    }
  }

  return routed;
}

async function pickEntriesToPull(entries: ManifestEntry[]): Promise<ManifestEntry[]> {
  if (!process.stdin.isTTY) return entries;
  const sorted = [...entries].sort((a, b) => {
    const k = (e: ManifestEntry) => `${e.tool}::${scopeLabel(e.scope)}::${e.category}::${e.pocketPath}`;
    return k(a).localeCompare(k(b));
  });
  const selected = await askMultiSelect<ManifestEntry>(
    'Select files to pull (space toggles, enter confirms):',
    sorted.map((e) => ({
      label: `${c.dim(`[${e.tool}/${e.category}/${scopeLabel(e.scope)}]`)} ${e.pocketPath}`,
      value: e,
    })),
  );
  return selected;
}
