import { ALL_PROVIDERS } from '../clients/providers.js';
import type { ProviderDefinition, ProviderId } from '../clients/types.js';

export interface ProviderFlagOptions {
  claudeDesktop?: boolean;
  claudeCode?: boolean;
  opencode?: boolean;
  copilotCli?: boolean;
  cursor?: boolean;
  codex?: boolean;
  antigravity?: boolean;
}

export interface ResolvedProviderSelection {
  selected: ProviderDefinition[];
  isFiltered: boolean;
  syncsClaudeHomeAssets: boolean;
}

const OPTION_NAME_TO_PROVIDER_ID: Record<keyof ProviderFlagOptions, ProviderId> = {
  claudeDesktop: 'claude-desktop',
  claudeCode: 'claude-code',
  opencode: 'opencode',
  copilotCli: 'copilot-cli',
  cursor: 'cursor',
  codex: 'codex',
  antigravity: 'antigravity',
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
      selectedIds.add(id as ProviderId);
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