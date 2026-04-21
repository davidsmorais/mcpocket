import { askMultiSelect } from '../utils/prompt.js';
import { c } from '../utils/sparkle.js';

export type SyncItemKind = 'agent' | 'skill' | 'mcp';

export interface SyncItem {
  kind: SyncItemKind;
  name: string;
}

/**
 * Filters for individual item-level sync selection.
 * `undefined` means "all items in that category" (no filtering applied).
 */
export interface ItemFilters {
  aiProviderNames?: ReadonlySet<string>;
  mcpNames?: ReadonlySet<string>;
  agentNames?: ReadonlySet<string>;
  skillNames?: ReadonlySet<string>;
  pluginNames?: ReadonlySet<string>;
}

const KIND_LABEL: Record<SyncItemKind, string> = {
  agent: '[agent]',
  skill: '[skill]',
  mcp:   '[mcp]  ',
};

function formatSyncItemLabel(item: SyncItem): string {
  return `${KIND_LABEL[item.kind]}  ${item.name}`;
}

/**
 * Show a single combined multi-select listing agents, skills, and MCP servers
 * together with kind labels. Returns per-category name filters.
 *
 * When all items in a category are kept, the filter for that category is `undefined`
 * (meaning "pass everything through without filtering").
 *
 * Pressing Enter with all items selected = sync everything (fast-path equivalent
 * to the old default-sync-all behaviour).
 */
export async function promptForItemSelection(
  question: string,
  agentNames: string[],
  skillNames: string[],
  mcpNames: string[],
): Promise<ItemFilters> {
  const items: SyncItem[] = [
    ...agentNames.sort().map((name) => ({ kind: 'agent' as SyncItemKind, name })),
    ...skillNames.sort().map((name) => ({ kind: 'skill' as SyncItemKind, name })),
    ...mcpNames.sort().map((name) => ({ kind: 'mcp' as SyncItemKind, name })),
  ];

  if (items.length === 0) return {};

  const selected = await askMultiSelect<SyncItem>(
    question,
    items.map((item) => ({ label: formatSyncItemLabel(item), value: item })),
  );

  const selectedAgentNames = selected.filter((i) => i.kind === 'agent').map((i) => i.name);
  const selectedSkillNames = selected.filter((i) => i.kind === 'skill').map((i) => i.name);
  const selectedMcpNames   = selected.filter((i) => i.kind === 'mcp').map((i) => i.name);

  const filters: ItemFilters = {};

  // Only set a filter when it is a strict subset (otherwise leave undefined = pass all)
  if (selectedAgentNames.length < agentNames.length) {
    filters.agentNames = new Set(selectedAgentNames);
  }
  if (selectedSkillNames.length < skillNames.length) {
    filters.skillNames = new Set(selectedSkillNames);
  }
  if (selectedMcpNames.length < mcpNames.length) {
    filters.mcpNames = new Set(selectedMcpNames);
  }

  return filters;
}

/** True when at least one MCP name passes through the filter. */
export function hasMcpsInSelection(filters: ItemFilters, availableMcpNames: string[]): boolean {
  if (!filters.mcpNames) return availableMcpNames.length > 0;
  return filters.mcpNames.size > 0;
}
