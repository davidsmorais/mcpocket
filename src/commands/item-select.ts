import { askMultiSelect } from '../utils/prompt.js';
import { c } from '../utils/sparkle.js';
import { ALL_PROVIDERS } from '../clients/providers.js';

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
  selectedProviders?: ReadonlySet<string>;
}

const KIND_LABEL: Record<SyncItemKind, string> = {
  agent: '[agent]',
  skill: '[skill]',
  mcp:   '[mcp]  ',
};

function formatSyncItemLabel(item: SyncItem, provider?: string): string {
  const providerTag = provider ? c.dim(` [${provider}]`) : '';
  return `${KIND_LABEL[item.kind]}  ${item.name}${providerTag}`;
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
  providers?: Record<string, string>,
  selectedProviders?: ReadonlySet<string>,
): Promise<ItemFilters> {
  // Build the list of items to display, optionally filtered by selectedProviders.
  // MCPs are merged across providers; we still show all MCPs for selection.
  const providerLabelForName = (name: string) => providers?.[name];

  // Determine which agents/skills to show when providers are selected
  let showAgentNames = agentNames;
  let showSkillNames = skillNames;
  if (selectedProviders && selectedProviders.size > 0 && providers) {
    // Map selected provider IDs to provider labels used in the providers map
    const providerToLabel: Record<string, string> = {
      'claude-code': 'claude',
      'claude-desktop': 'claude', // MCPs only, no direct assets
      'opencode': '',
      'copilot-cli': 'copilot',
      'cursor': '',
      'codex': '',
      'antigravity': 'gemini',
    };

    const allowedLabels = new Set<string>();
    for (const pid of Array.from(selectedProviders)) {
      const lbl = providerToLabel[pid];
      if (lbl) allowedLabels.add(lbl);
    }

    showAgentNames = agentNames.filter((name) => {
      const label = providerLabelForName(name);
      // If there's no provider label for this agent, exclude when filtering by providers
      return label ? allowedLabels.has(label) : false;
    });

    showSkillNames = skillNames.filter((name) => {
      const label = providerLabelForName(name);
      return label ? allowedLabels.has(label) : false;
    });
  }

  const items: SyncItem[] = [
    ...showAgentNames.sort().map((name) => ({ kind: 'agent' as SyncItemKind, name })),
    ...showSkillNames.sort().map((name) => ({ kind: 'skill' as SyncItemKind, name })),
    ...mcpNames.sort().map((name) => ({ kind: 'mcp' as SyncItemKind, name })),
  ];

  if (items.length === 0) return {};

  const selected = await askMultiSelect<SyncItem>(
    question,
    items.map((item) => ({ label: formatSyncItemLabel(item, providers?.[item.name]), value: item })),
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

  // Propagate the provider selection in the filters for downstream filtering if needed
  if (selectedProviders && selectedProviders.size > 0) {
    filters.selectedProviders = new Set(Array.from(selectedProviders));
  }

  return filters;
}

/**
 * CLI helper to prompt the user to select providers. Returns a Set of selected provider IDs.
 */
export async function promptForProviderSelectionCLI(): Promise<Set<string>> {
  // Build choices from ALL_PROVIDERS with their displayName
  const providerChoices = ALL_PROVIDERS.map((p) => ({ label: p.displayName, value: p.id }));
  // Show the multiselect prompt
  const selections = await askMultiSelect<string>(
    'Select providers to include:',
    providerChoices as unknown as { label: string; value: string }[],
  );

  const selected = selections?.length ? new Set<string>(selections as string[]) : new Set<string>();
  // If nothing selected, return all providers
  if (selected.size === 0) {
    return new Set<string>(ALL_PROVIDERS.map((p) => p.id));
  }
  return selected;
}

/**
 * Two-step CLI selection: first prompt for providers, then for items filtered by those providers.
 * This is the main interactive entry point for push/pull when --interactive is used.
 */
export async function promptForTwoStepSelection(
  question: string,
  agentNames: string[],
  skillNames: string[],
  mcpNames: string[],
  providers?: Record<string, string>,
): Promise<ItemFilters> {
  // Step 1: Select providers
  const selectedProviders = await promptForProviderSelectionCLI();

  // Step 2: Select items filtered by chosen providers
  return promptForItemSelection(question, agentNames, skillNames, mcpNames, providers, selectedProviders);
}

/** True when at least one MCP name passes through the filter. */
export function hasMcpsInSelection(filters: ItemFilters, availableMcpNames: string[]): boolean {
  if (!filters.mcpNames) return availableMcpNames.length > 0;
  return filters.mcpNames.size > 0;
}
