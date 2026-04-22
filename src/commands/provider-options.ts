import { ALL_PROVIDERS } from '../clients/providers.js';
import { askMultiSelect } from '../utils/prompt.js';
import type { ProviderDefinition, ProviderId } from '../clients/types.js';

export interface ProviderFlagOptions {
  claudeDesktop?: boolean;
  claudeCode?: boolean;
  opencode?: boolean;
  copilotCli?: boolean;
  cursor?: boolean;
  codex?: boolean;
  geminiCli?: boolean;
  antigravity?: boolean;
}

export interface ResolvedProviderSelection {
  selected: ProviderDefinition[];
  isFiltered: boolean;
  syncsClaudeHomeAssets: boolean;
}

// UI metadata for providers to render colored badges in the UI
export interface ProviderUiMetadata {
  id: string;
  displayName: string;
  color: string;
}

// Color mapping for providers to render consistent UI badges
const PROVIDER_COLORS: Record<string, string> = {
  'claude-desktop': '#38bdf8',
  'claude-code': '#38bdf8',
  'opencode': '#fb8500',
  'copilot-cli': '#8b949e',
  'cursor': '#a78bfa',
  'codex': '#3fb950',
  'gemini-cli': '#a78bfa'
};

// Exposed provider UI metadata for the frontend UI to render provider chips/badges
export const PROVIDER_UI_METADATA: ProviderUiMetadata[] = ALL_PROVIDERS.map((p) => ({
  id: p.id,
  displayName: p.displayName,
  color: PROVIDER_COLORS[p.id] ?? '#000000',
}));

const OPTION_NAME_TO_PROVIDER_ID: Record<keyof ProviderFlagOptions, ProviderId> = {
  claudeDesktop: 'claude-desktop',
  claudeCode: 'claude-code',
  opencode: 'opencode',
  copilotCli: 'copilot-cli',
  cursor: 'cursor',
  codex: 'codex',
  geminiCli: 'gemini-cli',
  antigravity: 'gemini-cli',
};

export function resolveProviderSelection(
  options: ProviderFlagOptions = {},
  configProviders?: string[]
): ResolvedProviderSelection {
  const selectedIds = new Set<ProviderId>();

  for (const [optionName, providerId] of Object.entries(OPTION_NAME_TO_PROVIDER_ID) as Array<[keyof ProviderFlagOptions, ProviderId]>) {
    if (options[optionName]) {
      selectedIds.add(providerId);
    }
  }

  // If no CLI flags were given, fall back to the stored provider list from config
  if (selectedIds.size === 0 && configProviders && configProviders.length > 0) {
    for (const id of configProviders) {
      if (id === 'antigravity') {
        selectedIds.add('gemini-cli');
      } else {
        selectedIds.add(id as ProviderId);
      }
    }
  }

  const selected = selectedIds.size > 0
    ? ALL_PROVIDERS.filter((provider) => selectedIds.has(provider.id))
    : ALL_PROVIDERS;

  const isFiltered = selectedIds.size > 0 && selected.length < ALL_PROVIDERS.length;

  return {
    selected,
    isFiltered,
    syncsClaudeHomeAssets: selected.some((provider) => provider.syncsClaudeHomeAssets),
  };
}

export function formatProviderList(providers: ProviderDefinition[]): string {
  return providers.map((provider) => provider.displayName).join(', ');
}

// Interactive provider selection for UI/interactive flows
export async function promptForProviderSelection(): Promise<ProviderDefinition[]> {
  const options = ALL_PROVIDERS.map((p) => ({ label: p.displayName, value: p }));
  const selected = await askMultiSelect('Select providers to include:', options);
  return selected.length > 0 ? selected : ALL_PROVIDERS; // default to all if none selected
}
