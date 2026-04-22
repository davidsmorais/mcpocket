import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir, resolveToken, writeConfig } from '../config.js';
import type { SyncCategory } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { collectFilesFromDir, updateGist } from '../storage/gist.js';
import { mergeMcpSources, buildPortableConfig } from '../sync/mcp.js';
import type { McpServersMap } from '../clients/types.js';
import { readPluginManifests, writePluginManifestsToRepo } from '../sync/plugins.js';
import { writeAgentsToRepo, listLocalAgentsWithProviders } from '../sync/agents.js';
import { writeSkillsToRepo, listLocalSkillsWithProviders } from '../sync/skills.js';
import { prunePocketDir } from '../sync/pocket.js';
import { formatProviderList, resolveProviderSelection, PROVIDER_UI_METADATA } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { promptForItemSelection, promptForTwoStepSelection, type ItemFilters } from './item-select.js';
import { openSelectionUi } from './ui-server.js';
import { askSecret, ask } from '../utils/prompt.js';
import { readProjectConfig, copyProjectFilesToPocket } from '../sync/project.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY, c, subItem, providerHeader } from '../utils/sparkle.js';

interface AssetSyncSummary {
  manifestCount: number;
  pluginResult: { synced: number; removed: number };
  agentResult: { synced: number; removed: number };
  skillResult: { synced: number; removed: number };
}

export async function pushCommand(
  options: ProviderFlagOptions & { interactive?: boolean; ui?: boolean; project?: boolean } = {},
): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  if (options.project) {
    await pushProjectCommand(config, repoDir);
    return;
  }

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

  const agentEntries = activeCategories.has('agents')
    ? listLocalAgentsWithProviders()
    : [];
  const skillEntries = activeCategories.has('skills')
    ? listLocalSkillsWithProviders()
    : [];
  const allAgentNames = agentEntries.map((e) => e.name);
  const allSkillNames = skillEntries.map((e) => e.name);
  const allMcpNames = Object.keys(allMcps);
  const allPluginPaths = activeCategories.has('plugins') ? Object.keys(readPluginManifests()) : [];

  const agentProviders = Object.fromEntries(agentEntries.map((e) => [e.name, e.provider]));
  const skillProviders = Object.fromEntries(skillEntries.map((e) => [e.name, e.provider]));
  const providers = { ...agentProviders, ...skillProviders };

  // ── Item selection ────────────────────────────────────────────────────────

  let filters: ItemFilters = {};

  if (options.ui) {
    const aiProviders = selection.selected.map((p) => p.displayName);
    filters = await openSelectionUi(
      { agents: allAgentNames, skills: allSkillNames, mcps: allMcpNames, plugins: allPluginPaths, aiProviders, agentProviders, skillProviders, providers: PROVIDER_UI_METADATA, projects: config.projects },
      'push',
    );
  } else if (options.interactive) {
    filters = await promptForTwoStepSelection(
      'What would you like to push?',
      allAgentNames,
      allSkillNames,
      allMcpNames,
      providers,
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

  subItem('Providers', { value: formatProviderList(selection.selected) });
  subItem('MCPs', { check: serverCount > 0, value: `${serverCount} server(s)` });
  subItem('Agents', { check: assetSummary.agentResult.synced > 0, value: `${assetSummary.agentResult.synced} file(s)` });
  subItem('Skills', { check: assetSummary.skillResult.synced > 0, value: `${assetSummary.skillResult.synced} file(s)` });
  subItem('Plugins', { check: assetSummary.manifestCount > 0, value: `${assetSummary.manifestCount} manifest(s)` });
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
  const shouldSyncAgents = activeCategories.has('agents');
  const shouldSyncSkills = activeCategories.has('skills');

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
    const filteredManifests = filters.pluginNames
      ? Object.fromEntries(Object.entries(manifests).filter(([key]) => filters.pluginNames!.has(key)))
      : manifests;
    manifestCount = Object.keys(filteredManifests).length;
    sparkle(`Found ${manifestCount} plugin manifest file(s)`);
    pluginResult = writePluginManifestsToRepo(filteredManifests, repoDir);
    if (pluginResult.removed > 0) {
      sparkle(`Removed ${pluginResult.removed} stale plugin manifest file(s) from the pocket`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping plugins (not in sync scope)');
  }

  if (shouldSyncAgents) {
    sparkle(WITTY.readingAgents);
    agentResult = writeAgentsToRepo(repoDir, filters.agentNames, filters.selectedProviders);
    sparkle(`Synced ${agentResult.synced} agent file(s)`);
    if (agentResult.removed > 0) {
      sparkle(`Removed ${agentResult.removed} stale agent file(s) from the pocket`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping agents (not in sync scope)');
  }

  if (shouldSyncSkills) {
    sparkle(WITTY.readingSkills);
    skillResult = writeSkillsToRepo(repoDir, filters.skillNames, filters.selectedProviders);
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

async function pushProjectCommand(
  config: ReturnType<typeof readConfig>,
  repoDir: string,
): Promise<void> {
  section('Push Project');

  let projectConfig;
  try {
    projectConfig = readProjectConfig();
  } catch (err) {
    oops((err as Error).message);
    process.exit(1);
  }

  const defaultName = projectConfig.projectName;
  const answer = await ask(`  Project name [${defaultName}]: `);
  const projectName = answer.trim() || defaultName;

  if (projectConfig.files.length === 0) {
    oops('No files configured to push. Edit mcpocket.json to add files.');
    process.exit(1);
  }

  preparePocketDirectory(config.storageType, repoDir, resolveToken(config), config.repoCloneUrl);

  sparkle(`Pushing project "${projectName}" files...`);
  const pocketPaths = copyProjectFilesToPocket(projectName, projectConfig.files, repoDir);

  if (pocketPaths.length === 0) {
    oops('No files were copied. Check that configured files exist in the current directory.');
    process.exit(1);
  }

  // Update global config projects map
  const updatedConfig = {
    ...config,
    projects: {
      ...(config.projects || {}),
      [projectName]: pocketPaths,
    },
  };
  writeConfig(updatedConfig);

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
      commitAndPush(repoDir, resolveToken(config), config.repoCloneUrl!, `mcpocket: push project ${projectName}`);
      celebrate(WITTY.pushDone);
    } catch (err) {
      oops(`Push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  section('Summary');
  stat('Project', projectName);
  stat('Files pushed', pocketPaths.length.toString());
  for (const p of pocketPaths) {
    sparkle(c.dim(p));
  }
  console.log('');
}
