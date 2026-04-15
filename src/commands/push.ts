import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir, resolveToken } from '../config.js';
import type { SyncCategory } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { collectFilesFromDir, updateGist } from '../storage/gist.js';
import { mergeMcpSources, buildPortableConfig } from '../sync/mcp.js';
import type { McpServersMap } from '../clients/types.js';
import { readPluginManifests, writePluginManifestsToRepo } from '../sync/plugins.js';
import { writeAgentsToRepo, listLocalAgentNames } from '../sync/agents.js';
import { writeSkillsToRepo, listLocalSkillNames } from '../sync/skills.js';
import { prunePocketDir } from '../sync/pocket.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { promptForItemSelection, type ItemFilters } from './item-select.js';
import { openSelectionUi } from './ui-server.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY, c } from '../utils/sparkle.js';

interface AssetSyncSummary {
  manifestCount: number;
  pluginResult: { synced: number; removed: number };
  agentResult: { synced: number; removed: number };
  skillResult: { synced: number; removed: number };
}

export async function pushCommand(
  options: ProviderFlagOptions & { interactive?: boolean; ui?: boolean } = {},
): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();
  const selection = resolveProviderSelection(options, config.syncProviders);
  const activeCategories: Set<SyncCategory> = config.syncCategories
    ? new Set(config.syncCategories)
    : new Set(['mcps', 'agents', 'skills', 'plugins']);

  section('Push');

  if (selection.isFiltered) {
    sparkle(`Sync scope: ${formatProviderList(selection.selected)}`);
  }

  preparePocketDirectory(config.storageType, repoDir, resolveToken(config), config.repoCloneUrl);

  const prunedEntries = prunePocketDir(repoDir);
  if (prunedEntries > 0) {
    sparkle(`Removed ${prunedEntries} stale pocket entr${prunedEntries === 1 ? 'y' : 'ies'}`);
  }

  // ── Discover available items (no passphrase yet) ──────────────────────────

  let allMcps: McpServersMap = {};
  if (activeCategories.has('mcps')) {
    sparkle(WITTY.readingMCP);
    allMcps = mergeMcpSources(...selection.selected.map((p) => p.readMcpServers()));
  }

  const allAgentNames = activeCategories.has('agents') && selection.syncsClaudeHomeAssets
    ? listLocalAgentNames()
    : [];
  const allSkillNames = activeCategories.has('skills') && selection.syncsClaudeHomeAssets
    ? listLocalSkillNames()
    : [];
  const allMcpNames = Object.keys(allMcps);

  // ── Item selection ────────────────────────────────────────────────────────

  let filters: ItemFilters = {};

  if (options.ui) {
    filters = await openSelectionUi(
      { agents: allAgentNames, skills: allSkillNames, mcps: allMcpNames },
      'push',
    );
  } else if (options.interactive) {
    filters = await promptForItemSelection(
      'What would you like to push?',
      allAgentNames,
      allSkillNames,
      allMcpNames,
    );
  }

  // ── MCPs ──────────────────────────────────────────────────────────────────

  let serverCount = 0;
  if (activeCategories.has('mcps')) {
    const serversToSync = filters.mcpNames ? filterMap(allMcps, filters.mcpNames) : allMcps;
    serverCount = Object.keys(serversToSync).length;

    if (serverCount > 0) {
      sparkle(`Pushing ${serverCount} MCP server(s) across ${selection.selected.length} provider(s)`);
      const passphrase = await promptForPushPassphrase();
      sparkle(WITTY.encrypting);
      const portableConfig = buildPortableConfig(serversToSync, passphrase);
      fs.writeFileSync(
        path.join(repoDir, 'mcp-config.json'),
        JSON.stringify(portableConfig, null, 2),
        'utf8',
      );
    } else {
      sparkle('No MCP servers to push — skipping');
    }
  } else {
    sparkle('Skipping MCPs (not in sync scope)');
  }

  // ── Agents, skills, plugins ───────────────────────────────────────────────

  const assetSummary = syncClaudeHomeAssetsToPocket(
    repoDir,
    activeCategories,
    !!config.syncCategories,
    selection.syncsClaudeHomeAssets,
    selection.isFiltered,
    filters,
  );

  // ── Push to remote ────────────────────────────────────────────────────────

  sparkle(WITTY.pushing);

  if (config.storageType === 'gist') {
    try {
      const files = collectFilesFromDir(repoDir);
      await updateGist(resolveToken(config), config.gistId!, files);
      celebrate(WITTY.pushDone);
      heads_up(`Pocket URL: ${c.cyan(config.gistUrl!)}  ← save this to connect from another machine!`);
    } catch (err) {
      oops(`Gist push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    ensureGitConfig(repoDir);
    try {
      commitAndPush(repoDir, resolveToken(config), config.repoCloneUrl!, 'mcpocket: push');
      celebrate(WITTY.pushDone);
    } catch (err) {
      oops(`Push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  section('Summary');
  stat('Storage', config.storageType === 'gist' ? `gist (${config.gistUrl})` : `repo (${config.repoHtmlUrl})`);
  stat('Providers', formatProviderList(selection.selected));
  stat('MCPs', serverCount.toString());
  stat('Plugins', `${assetSummary.manifestCount} manifest file(s)`);
  stat('Agents', assetSummary.agentResult.synced.toString());
  stat('Skills', assetSummary.skillResult.synced.toString());
  console.log('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function preparePocketDirectory(
  storageType: 'repo' | 'gist',
  repoDir: string,
  githubToken: string,
  repoCloneUrl?: string,
): void {
  if (storageType === 'gist') {
    fs.mkdirSync(repoDir, { recursive: true });
    return;
  }

  sparkle(WITTY.pulling);
  try {
    pullRepo(repoDir, githubToken, repoCloneUrl!);
  } catch (err) {
    heads_up(`Could not pull latest — ${(err as Error).message}`);
  }
}

async function promptForPushPassphrase(): Promise<string> {
  const passphrase = await askSecret('  🔒 Passphrase to encrypt secrets: ');
  if (!passphrase) {
    oops('Passphrase cannot be empty.');
    process.exit(1);
  }

  const confirm = await askSecret('  🔒 Confirm passphrase: ');
  if (passphrase !== confirm) {
    oops("Passphrases don't match. Give it another whirl!");
    process.exit(1);
  }

  return passphrase;
}

function syncClaudeHomeAssetsToPocket(
  repoDir: string,
  activeCategories: Set<SyncCategory>,
  hasExplicitCategories: boolean,
  syncsClaudeHomeAssets: boolean,
  showSkipMessage: boolean,
  filters: ItemFilters = {},
): AssetSyncSummary {
  const shouldSyncPlugins = hasExplicitCategories
    ? activeCategories.has('plugins')
    : activeCategories.has('plugins') && syncsClaudeHomeAssets;
  const shouldSyncAgents = hasExplicitCategories
    ? activeCategories.has('agents')
    : activeCategories.has('agents') && syncsClaudeHomeAssets;
  const shouldSyncSkills = hasExplicitCategories
    ? activeCategories.has('skills')
    : activeCategories.has('skills') && syncsClaudeHomeAssets;

  let manifestCount = 0;
  let pluginResult = { synced: 0, removed: 0 };
  let agentResult  = { synced: 0, removed: 0 };
  let skillResult  = { synced: 0, removed: 0 };

  if (!shouldSyncPlugins && !shouldSyncAgents && !shouldSyncSkills) {
    if (showSkipMessage) {
      sparkle('Skipping Claude home plugin manifests for this sync scope');
      sparkle('Skipping Claude home agents for this sync scope');
      sparkle('Skipping Claude home skills for this sync scope');
    }
    return { manifestCount, pluginResult, agentResult, skillResult };
  }

  if (shouldSyncPlugins) {
    sparkle(WITTY.readingPlugins);
    const manifests = readPluginManifests();
    manifestCount = Object.keys(manifests).length;
    sparkle(`Found ${manifestCount} plugin manifest file(s)`);
    pluginResult = writePluginManifestsToRepo(manifests, repoDir);
    if (pluginResult.removed > 0) {
      sparkle(`Removed ${pluginResult.removed} stale plugin manifest file(s) from the pocket`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping plugins (not in sync scope)');
  }

  if (shouldSyncAgents) {
    sparkle(WITTY.readingAgents);
    agentResult = writeAgentsToRepo(repoDir, filters.agentNames);
    sparkle(`Synced ${agentResult.synced} agent file(s)`);
    if (agentResult.removed > 0) {
      sparkle(`Removed ${agentResult.removed} stale agent file(s) from the pocket`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping agents (not in sync scope)');
  }

  if (shouldSyncSkills) {
    sparkle(WITTY.readingSkills);
    skillResult = writeSkillsToRepo(repoDir, filters.skillNames);
    sparkle(`Synced ${skillResult.synced} skill file(s)`);
    if (skillResult.removed > 0) {
      sparkle(`Removed ${skillResult.removed} stale skill file(s) from the pocket`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping skills (not in sync scope)');
  }

  return { manifestCount, pluginResult, agentResult, skillResult };
}

function filterMap<V>(map: Record<string, V>, allowedKeys: ReadonlySet<string>): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [key, val] of Object.entries(map)) {
    if (allowedKeys.has(key)) result[key] = val;
  }
  return result;
}
