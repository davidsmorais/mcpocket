import { getAuthenticatedUser, createRepo, resolveRepoInfo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { createGist, resolveGistInfo } from '../storage/gist.js';
import { writeConfig, configExists, getLocalRepoDir, ALL_SYNC_CATEGORIES } from '../config.js';
import type { StorageType, SyncCategory } from '../config.js';
import { ALL_PROVIDERS } from '../clients/providers.js';
import { ask, askSecret, askMultiSelect } from '../utils/prompt.js';
import { sparkle, celebrate, section, oops, heads_up, WITTY, c } from '../utils/sparkle.js';
import { openSelectionUi, type UiItems } from './ui-server.js';
import { listLocalAgentNames } from '../sync/agents.js';
import { listLocalSkillNames } from '../sync/skills.js';
import { readPluginManifests } from '../sync/plugins.js';

export interface InitOptions {
  ui?: boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  section('Init');

  if (configExists()) {
    const overwrite = await ask('  mcpocket is already set up. Re-initialize? [y/N] ');
    if (overwrite.toLowerCase() !== 'y') {
      sparkle('No worries, keeping everything as-is.');
      return;
    }
  }

  // Get GitHub token
  console.log('');
  sparkle('First, let\'s link your GitHub account.');
  console.log(`  Required scopes: ${c.bold('repo')} ${c.dim('(full control of private repositories)')}\n`);
  console.log(`  Create one at: ${c.cyan('https://github.com/settings/tokens/new')}\n`);

  const token = await askSecret('  🔑 GitHub token: ');
  if (!token) {
    oops('Token cannot be empty.');
    process.exit(1);
  }

  // Verify token and get username
  sparkle(WITTY.verifying);
  let owner = '';
  try {
    owner = await getAuthenticatedUser(token);
    sparkle(`Authenticated as \x1b[1m${owner}\x1b[0m — nice to meet you!`);
  } catch (err) {
    oops((err as Error).message);
    process.exit(1);
  }

  // Choose storage type
  console.log('');
  sparkle('Where should mcpocket store your config?');
  console.log(`    ${c.cyan('[1]')} GitHub repo  ${c.dim('(private repo, full git history)')}`);
  console.log(`    ${c.cyan('[2]')} GitHub gist  ${c.dim('(lighter, no git clone needed)')}\n`);
  const storageChoice = await ask('  Pick one [1/2]: ');
  const storageType: StorageType = storageChoice === '2' ? 'gist' : 'repo';

  // Ask if they already have an existing pocket to connect to
  console.log('');
  const hasExisting = await ask('  Do you have an existing pocket to connect? [y/N] ');
  const connectToExisting = hasExisting.toLowerCase() === 'y';

  if (storageType === 'gist') {
    let gistInfo: { id: string; htmlUrl: string };

    if (connectToExisting) {
      const input = await ask('  Paste your gist URL or gist ID: ');
      if (!input) {
        oops('Gist URL or ID cannot be empty.');
        process.exit(1);
      }
      sparkle(WITTY.verifying);
      try {
        gistInfo = await resolveGistInfo(token, input);
        sparkle(`Connected to pocket: ${c.cyan(gistInfo.htmlUrl)}`);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
    } else {
      sparkle('Creating your private sync gist...');
      try {
        gistInfo = await createGist(token);
        sparkle(`Pocket ready: ${c.cyan(gistInfo.htmlUrl)}`);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
    }

    // Ensure staging dir exists
    const localDir = getLocalRepoDir();
    const fs = await import('fs');
    fs.mkdirSync(localDir, { recursive: true });

    const { syncCategories, syncProviders, syncAgents, syncSkills, syncPlugins } = await askSyncScope(options.ui);

    writeConfig({
      githubToken: token,
      storageType: 'gist',
      gistId: gistInfo.id,
      gistUrl: gistInfo.htmlUrl,
      syncCategories,
      syncProviders,
      syncAgents,
      syncSkills,
      syncPlugins,
    });
  } else {
    let repoInfo: Awaited<ReturnType<typeof createRepo>>;

    if (connectToExisting) {
      const input = await ask('  Paste your repo URL (https://github.com/owner/repo) or owner/repo: ');
      if (!input) {
        oops('Repo URL cannot be empty.');
        process.exit(1);
      }
      sparkle(WITTY.verifying);
      try {
        repoInfo = await resolveRepoInfo(token, input);
        sparkle(`Connected to pocket: ${c.cyan(repoInfo.htmlUrl)}`);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
    } else {
      sparkle('Creating your private sync pocket (mcpocket-sync)...');
      try {
        repoInfo = await createRepo(token, owner);
        sparkle(`Pocket ready: ${c.cyan(repoInfo.htmlUrl)}`);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
    }

    // Clone repo locally
    const localDir = getLocalRepoDir();
    sparkle(WITTY.cloning);
    try {
      cloneRepo(repoInfo.cloneUrl, token, localDir);
      ensureGitConfig(localDir);
      sparkle(`Stashed at ${c.dim(localDir)}`);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }

    const { syncCategories, syncProviders, syncAgents, syncSkills, syncPlugins } = await askSyncScope(options.ui);

    writeConfig({
      githubToken: token,
      storageType: 'repo',
      repoFullName: repoInfo.fullName,
      repoCloneUrl: repoInfo.cloneUrl,
      repoHtmlUrl: repoInfo.htmlUrl,
      syncCategories,
      syncProviders,
      syncAgents,
      syncSkills,
      syncPlugins,
    });
  }

  celebrate(WITTY.initDone);
  console.log(`\n  ${c.bold('Next steps:')}`);
  sparkle(`${c.cyan('mcpocket push')}   — tuck your setup into the cloud`);
  sparkle(`${c.cyan('mcpocket pull')}   — unpack your setup on a new machine`);
  console.log('');
}

interface AskSyncScopeResult {
  syncCategories: SyncCategory[];
  syncProviders: string[];
  syncAgents?: string[];
  syncSkills?: string[];
  syncPlugins?: string[];
}

async function askSyncScope(useUI?: boolean): Promise<AskSyncScopeResult> {
  section('Sync Scope');
  sparkle('Choose what mcpocket will sync for you.');

  const CATEGORY_LABELS: Record<SyncCategory, string> = {
    mcps: 'MCPs',
    agents: 'Agents',
    skills: 'Skills',
    plugins: 'Plugins',
  };

  const syncCategories = await askMultiSelect<SyncCategory>(
    'Which categories should be synced?',
    ALL_SYNC_CATEGORIES.map((cat) => ({
      label: CATEGORY_LABELS[cat],
      value: cat,
    }))
  );

  let syncProviders: string[] = ALL_PROVIDERS.map((p) => p.id);

  if (syncCategories.includes('mcps')) {
    syncProviders = (await askMultiSelect(
      'Which MCP providers should be synced?',
      ALL_PROVIDERS.map((p) => ({ label: p.displayName, value: p.id }))
    )) as string[];
  }

  let syncAgents: string[] | undefined;
  let syncSkills: string[] | undefined;
  let syncPlugins: string[] | undefined;

  if (useUI) {
    console.log('');
    sparkle('Opening browser UI for individual item selection...');

    const agentNames = syncCategories.includes('agents') ? listLocalAgentNames() : [];
    const skillNames = syncCategories.includes('skills') ? listLocalSkillNames() : [];
    const mcpNames = syncCategories.includes('mcps') ? syncProviders : [];

    const manifests = syncCategories.includes('plugins') ? readPluginManifests() : {};
    const pluginNames = Object.keys(manifests.hasOwnProperty('plugins/installed_plugins.json')
      ? ((manifests['plugins/installed_plugins.json'] as Record<string, unknown>) || {})
      : {});

    const uiItems: UiItems = {
      agents: agentNames,
      skills: skillNames,
      mcps: mcpNames,
      ...(pluginNames.length > 0 && { plugins: pluginNames }),
    };

    const filters = await openSelectionUi(uiItems, 'push');

    if (filters.agentNames) {
      syncAgents = Array.from(filters.agentNames);
    }
    if (filters.skillNames) {
      syncSkills = Array.from(filters.skillNames);
    }
    if (filters.pluginNames) {
      syncPlugins = Array.from(filters.pluginNames);
    }
  }

  return { syncCategories, syncProviders, syncAgents, syncSkills, syncPlugins };
}
