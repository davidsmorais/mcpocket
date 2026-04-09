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

export function resolveProviderSelection(options: ProviderFlagOptions = {}): ResolvedProviderSelection {
  const selectedIds = new Set<ProviderId>();

  for (const [optionName, providerId] of Object.entries(OPTION_NAME_TO_PROVIDER_ID) as Array<[keyof ProviderFlagOptions, ProviderId]>) {
    if (options[optionName]) {
      selectedIds.add(providerId);
    }
  }

  const selected = selectedIds.size > 0
    ? ALL_PROVIDERS.filter((provider) => selectedIds.has(provider.id))
    : ALL_PROVIDERS;

  return {
    selected,
    isFiltered: selectedIds.size > 0,
    syncsClaudeHomeAssets: selected.some((provider) => provider.syncsClaudeHomeAssets),
  };
}

export function formatProviderList(providers: ProviderDefinition[]): string {
  return providers.map((provider) => provider.displayName).join(', ');
}