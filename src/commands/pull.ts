import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir, resolveToken } from '../config.js';
import type { SyncCategory } from '../config.js';
import { pullRepo, ensureGitConfig } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir } from '../storage/gist.js';
import { additiveMerge, restoreFromPortableConfig, listPocketMcpServerNames } from '../sync/mcp.js';
import type { PortableMcpConfig } from '../sync/mcp.js';
import type { McpServersMap, ProviderDefinition } from '../clients/types.js';
import { readPluginManifestsFromRepo, applyPluginManifests } from '../sync/plugins.js';
import { applyAgentsFromRepo, listRepoAgentNames } from '../sync/agents.js';
import { applySkillsFromRepo, listRepoSkillNames } from '../sync/skills.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { promptForItemSelection, type ItemFilters } from './item-select.js';
import { openSelectionUi } from './ui-server.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY, c } from '../utils/sparkle.js';

interface RestoredAssetSummary {
  updatedManifests: string[];
  agentResult: { synced: number; removed: number };
  skillResult: { synced: number; removed: number };
}

export async function pullCommand(
  options: ProviderFlagOptions & { interactive?: boolean; ui?: boolean } = {},
): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();
  const selection = resolveProviderSelection(options, config.syncProviders);
  const activeCategories: Set<SyncCategory> = config.syncCategories
    ? new Set(config.syncCategories)
    : new Set(['mcps', 'agents', 'skills', 'plugins']);

  section('Pull');
  if (selection.isFiltered) {
    sparkle(`Sync scope: ${formatProviderList(selection.selected)}`);
  }

  sparkle(WITTY.pulling);
  await syncPocketToLocal(repoDir, config);

  // ── Discover available items from pocket (no passphrase yet) ─────────────

  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  const hasMcpConfig  = activeCategories.has('mcps') && fs.existsSync(mcpConfigPath);

  const allMcpNames   = hasMcpConfig ? listPocketMcpServerNames(repoDir) : [];
  const allAgentNames = activeCategories.has('agents') ? listRepoAgentNames(repoDir) : [];
  const allSkillNames = activeCategories.has('skills') ? listRepoSkillNames(repoDir) : [];

  // ── Item selection ────────────────────────────────────────────────────────

  let filters: ItemFilters = {};

  if (options.ui) {
    filters = await openSelectionUi(
      { agents: allAgentNames, skills: allSkillNames, mcps: allMcpNames },
      'pull',
    );
  } else if (options.interactive) {
    filters = await promptForItemSelection(
      'What would you like to pull?',
      allAgentNames,
      allSkillNames,
      allMcpNames,
    );
  }

  // ── MCPs ──────────────────────────────────────────────────────────────────

  let serverCount   = 0;
  let updatedClients: string[] = [];

  if (activeCategories.has('mcps')) {
    if (!hasMcpConfig) {
      heads_up('No MCP config found in the pocket yet. Run `mcpocket push` on your source machine first!');
    } else {
      // Only decrypt if at least one MCP is selected
      const mcpsSelected = !filters.mcpNames || filters.mcpNames.size > 0;

      if (mcpsSelected) {
        const passphrase = await promptForPullPassphrase();
        sparkle(WITTY.decrypting);

        let remoteServers: McpServersMap;
        try {
          const portableConfig: PortableMcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
          remoteServers = restoreFromPortableConfig(portableConfig, passphrase);
        } catch (err) {
          oops(`Decryption failed: ${(err as Error).message}`);
          process.exit(1);
        }

        const serversToApply = filters.mcpNames
          ? filterMap(remoteServers, filters.mcpNames)
          : remoteServers;

        serverCount    = Object.keys(serversToApply).length;
        updatedClients = applyServersToProviders(selection.selected, serversToApply);
        sparkle(`Restored ${serverCount} MCP server(s)`);
      } else {
        sparkle('No MCP servers selected — skipping');
      }
    }
  } else {
    sparkle('Skipping MCPs (not in sync scope)');
  }

  // ── Agents, skills, plugins ───────────────────────────────────────────────

  const restoredAssets = restoreClaudeHomeAssetsFromPocket(
    repoDir,
    activeCategories,
    !!config.syncCategories,
    selection.syncsClaudeHomeAssets,
    selection.isFiltered,
    filters,
  );

  // ── Summary ───────────────────────────────────────────────────────────────

  celebrate(WITTY.pullDone);

  section('Summary');
  stat('Providers', formatProviderList(selection.selected));
  stat('MCPs', `${serverCount} servers → ${updatedClients.length} client(s)`);
  stat('Plugins', `${restoredAssets.updatedManifests.length} manifest file(s)`);
  stat('Agents', restoredAssets.agentResult.synced.toString());
  stat('Skills', restoredAssets.skillResult.synced.toString());

  if (updatedClients.length > 0) {
    console.log(`\n  ${c.bold('Updated clients:')}`);
    for (const client of updatedClients) {
      sparkle(c.cyan(client));
    }
    heads_up('Restart affected apps to apply MCP changes.');
  }
  console.log('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function syncPocketToLocal(
  repoDir: string,
  config: ReturnType<typeof readConfig>,
): Promise<void> {
  if (config.storageType === 'gist') {
    try {
      const { files: gistFiles, truncated } = await fetchGist(resolveToken(config), config.gistId!);
      fs.mkdirSync(repoDir, { recursive: true });
      writeGistFilesToDir(repoDir, gistFiles);
      if (truncated) {
        heads_up(
          'Your gist has more than 300 files — GitHub only returns the first 300 via its API.\n' +
          '  Some agents, skills, or plugins may not be synced. Consider switching to repo storage.',
        );
      }
      return;
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
  }

  try {
    pullRepo(repoDir, resolveToken(config), config.repoCloneUrl!);
    ensureGitConfig(repoDir);
  } catch (err) {
    oops((err as Error).message);
    process.exit(1);
  }
}

async function promptForPullPassphrase(): Promise<string> {
  const passphrase = await askSecret('  🔓 Passphrase to decrypt secrets: ');
  if (!passphrase) {
    oops('Passphrase cannot be empty.');
    process.exit(1);
  }
  return passphrase;
}

function applyServersToProviders(
  providers: ProviderDefinition[],
  remoteServers: McpServersMap,
): string[] {
  const updatedClients: string[] = [];
  for (const provider of providers) {
    const localServers  = provider.readMcpServers();
    const mergedServers = additiveMerge(localServers, remoteServers);
    if (Object.keys(mergedServers).length > Object.keys(localServers).length) {
      provider.writeMcpServers(mergedServers);
      updatedClients.push(`${provider.displayName} (${provider.getConfigPath()})`);
    }
  }
  return updatedClients;
}

function restoreClaudeHomeAssetsFromPocket(
  repoDir: string,
  activeCategories: Set<SyncCategory>,
  hasExplicitCategories: boolean,
  syncsClaudeHomeAssets: boolean,
  showSkipMessage: boolean,
  filters: ItemFilters = {},
): RestoredAssetSummary {
  const shouldRestorePlugins = hasExplicitCategories
    ? activeCategories.has('plugins')
    : activeCategories.has('plugins') && syncsClaudeHomeAssets;
  const shouldRestoreAgents = hasExplicitCategories
    ? activeCategories.has('agents')
    : activeCategories.has('agents') && syncsClaudeHomeAssets;
  const shouldRestoreSkills = hasExplicitCategories
    ? activeCategories.has('skills')
    : activeCategories.has('skills') && syncsClaudeHomeAssets;

  let updatedManifests: string[] = [];
  let agentResult = { synced: 0, removed: 0 };
  let skillResult = { synced: 0, removed: 0 };

  if (!shouldRestorePlugins && !shouldRestoreAgents && !shouldRestoreSkills) {
    if (showSkipMessage) {
      sparkle('Skipping Claude home plugin manifests for this sync scope');
      sparkle('Skipping Claude home agents for this sync scope');
      sparkle('Skipping Claude home skills for this sync scope');
    }
    return { updatedManifests, agentResult, skillResult };
  }

  if (shouldRestorePlugins) {
    sparkle(WITTY.readingPlugins);
    const manifests = readPluginManifestsFromRepo(repoDir);
    updatedManifests = applyPluginManifests(manifests);
    sparkle(`Updated ${updatedManifests.length} manifest file(s)`);
  } else if (showSkipMessage) {
    sparkle('Skipping plugins (not in sync scope)');
  }

  if (shouldRestoreAgents) {
    sparkle(WITTY.readingAgents);
    agentResult = applyAgentsFromRepo(repoDir, filters.agentNames);
    sparkle(`Restored ${agentResult.synced} agent file(s)`);
    if (agentResult.removed > 0) {
      sparkle(`Removed ${agentResult.removed} stale local agent file(s)`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping agents (not in sync scope)');
  }

  if (shouldRestoreSkills) {
    sparkle(WITTY.readingSkills);
    skillResult = applySkillsFromRepo(repoDir, filters.skillNames);
    sparkle(`Restored ${skillResult.synced} skill file(s)`);
    if (skillResult.removed > 0) {
      sparkle(`Removed ${skillResult.removed} stale local skill file(s)`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping skills (not in sync scope)');
  }

  return { updatedManifests, agentResult, skillResult };
}

function filterMap<V>(
  map: Record<string, V>,
  allowedKeys: ReadonlySet<string>,
): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [key, val] of Object.entries(map)) {
    if (allowedKeys.has(key)) result[key] = val;
  }
  return result;
}
