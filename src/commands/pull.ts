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
import { applyAgentsFromRepo, listRepoAgentNames, listRepoAgentsWithProviders } from '../sync/agents.js';
import { applySkillsFromRepo, listRepoSkillNames, listRepoSkillsWithProviders } from '../sync/skills.js';
import { formatProviderList, resolveProviderSelection, PROVIDER_UI_METADATA } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { promptForItemSelection, promptForTwoStepSelection, type ItemFilters } from './item-select.js';
import { openSelectionUi, openRoutingUi } from './ui-server.js';
import type { FileRoutingMap, RoutingEntry } from '../sync/routing.js';
import { buildRoutingMap } from '../sync/routing.js';
import { askSecret, askSingleSelect } from '../utils/prompt.js';
import { copyProjectFilesFromPocket } from '../sync/project.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY, c, subItem } from '../utils/sparkle.js';

interface RestoredAssetSummary {
  updatedManifests: string[];
  agentResult: { synced: number; removed: number };
  skillResult: { synced: number; removed: number };
}

export async function pullCommand(
  options: ProviderFlagOptions & { interactive?: boolean; ui?: boolean; route?: boolean; project?: boolean } = {},
): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  if (options.project) {
    await pullProjectCommand(config, repoDir);
    return;
  }

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

  // ── Per-file routing mode (--ui or --interactive flags) ─────────────────────

  if (options.ui || options.interactive) {
    await pullWithRouting(repoDir, config, options.interactive);
    return;
  }

  // ── Legacy mode: no flags, pull everything ──────────────────────────────────

  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  const hasMcpConfig  = activeCategories.has('mcps') && fs.existsSync(mcpConfigPath);

  const allMcpNames   = hasMcpConfig ? listPocketMcpServerNames(repoDir) : [];
  const allAgentNames = activeCategories.has('agents') ? listRepoAgentNames(repoDir) : [];
  const allSkillNames = activeCategories.has('skills') ? listRepoSkillNames(repoDir) : [];

  // Build provider maps for UI/interactive display
  const agentEntries = activeCategories.has('agents') ? listRepoAgentsWithProviders(repoDir) : [];
  const skillEntries = activeCategories.has('skills') ? listRepoSkillsWithProviders(repoDir) : [];
  const agentProviders = Object.fromEntries(agentEntries.map((e) => [e.name, e.provider]));
  const skillProviders = Object.fromEntries(skillEntries.map((e) => [e.name, e.provider]));

  // ── Item selection ────────────────────────────────────────────────────────

  let filters: ItemFilters = {};

  if (options.ui) {
    const aiProviders = selection.selected.map((p) => p.displayName);
    filters = await openSelectionUi(
      { agents: allAgentNames, skills: allSkillNames, mcps: allMcpNames, aiProviders, agentProviders, skillProviders, providers: PROVIDER_UI_METADATA, projects: config.projects },
      'pull',
    );
  } else if (options.interactive) {
    filters = await promptForTwoStepSelection(
      'What would you like to pull?',
      allAgentNames,
      allSkillNames,
      allMcpNames,
      { ...agentProviders, ...skillProviders },
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
  subItem('Providers', { value: formatProviderList(selection.selected) });
  subItem('MCPs', { check: serverCount > 0, value: `${serverCount} server(s) → ${updatedClients.length} client(s)` });
  subItem('Agents', { check: restoredAssets.agentResult.synced > 0, value: `${restoredAssets.agentResult.synced} file(s)` });
  subItem('Skills', { check: restoredAssets.skillResult.synced > 0, value: `${restoredAssets.skillResult.synced} file(s)` });
  subItem('Plugins', { check: restoredAssets.updatedManifests.length > 0, value: `${restoredAssets.updatedManifests.length} manifest(s)` });

  if (updatedClients.length > 0) {
    console.log(`\n  ${c.bold('Updated clients:')}`);
    for (const client of updatedClients) {
      sparkle(c.cyan(client));
    }
    heads_up('Restart affected apps to apply MCP changes.');
  }
  console.log('');
}

// ── Per-file routing mode ─────────────────────────────────────────────────────

async function pullWithRouting(
  repoDir: string,
  config: ReturnType<typeof readConfig>,
  interactiveMode = false,
): Promise<void> {
  // Fetch gist files directly (don't write to dir yet — we route first)
  let gistFiles: Record<string, string>;
  if (config.storageType === 'gist') {
    const result = await fetchGist(resolveToken(config), config.gistId!);
    gistFiles = result.files;
  } else {
    // For repo mode, collect files from the local clone
    gistFiles = {};
    collectFilesRecursive(repoDir, '', gistFiles);
  }

  // Open routing UI or CLI
  const routingMap: FileRoutingMap = interactiveMode
    ? await promptForRoutingCLI(gistFiles, config.projects)
    : await openRoutingUi(gistFiles, config.projects);

  // Write files to their routed destinations
  celebrate(WITTY.pullDone);
  section('Routing Summary');

  let routedCount = 0;
  for (const entry of Object.values(routingMap)) {
    const content = gistFiles[entry.gistKey];
    if (!content) continue;

    const dest = computeDestination(entry, repoDir, config);
    if (!dest) continue;

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, 'utf8');
    routedCount++;
    sparkle(`${c.dim(entry.gistKey)} → ${c.cyan(dest)}`);
  }

  stat('Files routed', routedCount.toString());
  console.log('');
}

function computeDestination(
  entry: ReturnType<typeof import('../sync/routing.js').buildRoutingMap>[string],
  repoDir: string,
  config: ReturnType<typeof readConfig>,
): string | null {
  const { tool, provider, project, gistKey } = entry;

  switch (tool) {
    case 'agent': {
      if (!provider) return null;
      const targetDir = provider === 'claude-code' || provider === 'claude-desktop'
        ? path.join(process.env.HOME || '~', '.claude', 'agents')
        : provider === 'copilot-cli'
          ? path.join(process.env.HOME || '~', '.copilot', 'agents')
          : path.join(process.env.HOME || '~', '.claude', 'agents');
      // Extract relative path from gist key: agents__claude-code__foo.md → foo.md
      const parts = gistKey.split('__');
      const relPath = parts.slice(2).join('/');
      return path.join(targetDir, relPath);
    }
    case 'skill': {
      if (!provider) return null;
      const targetDir = provider === 'claude-code' || provider === 'claude-desktop'
        ? path.join(process.env.HOME || '~', '.claude', 'skills')
        : provider === 'gemini-cli'
          ? path.join(process.env.HOME || '~', '.gemini', 'skills')
          : path.join(process.env.HOME || '~', '.claude', 'skills');
      const parts = gistKey.split('__');
      const relPath = parts.slice(2).join('/');
      return path.join(targetDir, relPath);
    }
    case 'plugin': {
      const targetDir = path.join(process.env.HOME || '~', '.claude', 'plugins');
      const parts = gistKey.split('__');
      const relPath = parts.slice(1).join('/');
      return path.join(targetDir, relPath);
    }
    case 'mcp': {
      // MCP config goes to the repo dir for later processing
      return path.join(repoDir, 'mcp-config.json');
    }
    case 'project': {
      if (!project) return null;
      // Project files go to the current working directory
      const parts = gistKey.split('__');
      const relPath = parts.slice(1).join('/');
      return path.join(process.cwd(), relPath);
    }
    default:
      return null;
  }
}

function collectFilesRecursive(dir: string, prefix: string, files: Record<string, string>): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const key = prefix ? `${prefix}__${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(fullPath, key, files);
    } else if (entry.isFile()) {
      files[key] = fs.readFileSync(fullPath, 'utf8');
    }
  }
}

async function promptForRoutingCLI(
  gistFiles: Record<string, string>,
  projects?: Record<string, string[]>,
): Promise<FileRoutingMap> {
  const routingMap = buildRoutingMap(gistFiles);
  const entries = Object.values(routingMap);
  const projectNames = projects ? Object.keys(projects) : [];

  sparkle(`\n${c.bold('Per-file routing — assign each file to a destination')}`);
  sparkle(c.dim('Format: <file> → project | provider | tool\n'));

  for (const entry of entries) {
    console.log(`\n${c.bold(entry.displayName)} ${c.dim(`(${entry.gistKey})`)}`);

    // Project selection
    if (projectNames.length > 0) {
      const projectChoices = ['(none)', ...projectNames].map((p) => ({ label: p, value: p }));
      const selectedProject = await askSingleSelect('Project', projectChoices);
      entry.project = selectedProject === '(none)' ? undefined : selectedProject;
    }

    // Provider selection
    const allProviders = ['(none)', 'claude-code', 'claude-desktop', 'opencode', 'copilot-cli', 'cursor', 'codex', 'gemini-cli'];
    const providerChoices = allProviders.map((p) => ({ label: p, value: p }));
    const selectedProvider = await askSingleSelect('Provider', providerChoices);
    entry.provider = selectedProvider === '(none)' ? undefined : selectedProvider as RoutingEntry['provider'];

    // Tool selection
    const allTools = ['agent', 'skill', 'plugin', 'mcp', 'project'];
    const toolChoices = allTools.map((t) => ({ label: t, value: t }));
    const selectedTool = await askSingleSelect('Tool', toolChoices);
    entry.tool = selectedTool as RoutingEntry['tool'];
  }

  console.log('');
  return routingMap;
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
    agentResult = applyAgentsFromRepo(repoDir, filters.agentNames, filters.selectedProviders);
    sparkle(`Restored ${agentResult.synced} agent file(s)`);
    if (agentResult.removed > 0) {
      sparkle(`Removed ${agentResult.removed} stale local agent file(s)`);
    }
  } else if (showSkipMessage) {
    sparkle('Skipping agents (not in sync scope)');
  }

  if (shouldRestoreSkills) {
    sparkle(WITTY.readingSkills);
    skillResult = applySkillsFromRepo(repoDir, filters.skillNames, filters.selectedProviders);
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

async function pullProjectCommand(
  config: ReturnType<typeof readConfig>,
  repoDir: string,
): Promise<void> {
  section('Pull Project');

  const projects = config.projects;
  if (!projects || Object.keys(projects).length === 0) {
    heads_up('No projects found in your pocket. Push a project first with `mcpocket push --project`.');
    return;
  }

  sparkle(WITTY.pulling);
  await syncPocketToLocal(repoDir, config);

  const projectNames = Object.keys(projects);
  let projectName: string;

  if (projectNames.length === 1) {
    projectName = projectNames[0];
    sparkle(`Pulling project "${projectName}"...`);
  } else {
    projectName = await askSingleSelect(
      'Which project would you like to pull?',
      projectNames.map((name) => ({ label: name, value: name })),
    );
  }

  const files = projects[projectName];
  if (!files || files.length === 0) {
    heads_up(`No files registered for project "${projectName}".`);
    return;
  }

  sparkle(`Restoring ${files.length} file(s) for project "${projectName}"...`);
  const count = copyProjectFilesFromPocket(projectName, files, repoDir);

  celebrate(WITTY.pullDone);
  section('Summary');
  stat('Project', projectName);
  stat('Files restored', count.toString());
  console.log('');
}
