import { createRepo, resolveRepoInfo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { createGist, resolveGistInfo } from '../storage/gist.js';
import { getGhToken, getGhUsername, listGhRepos, listGhGists } from '../storage/gh-cli.js';
import { writeConfig, configExists, getLocalRepoDir, ALL_SYNC_CATEGORIES } from '../config.js';
import type { StorageType, SyncCategory } from '../config.js';
import { ALL_PROVIDERS } from '../clients/providers.js';
import { ask, askMultiSelect, askSingleSelect } from '../utils/prompt.js';
import { sparkle, celebrate, section, oops, WITTY, c } from '../utils/sparkle.js';
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

  // Authenticate via GH CLI
  console.log('');
  sparkle('Linking your GitHub account via the GitHub CLI...');

  let token = '';
  let owner = '';
  try {
    token = getGhToken();
    owner = getGhUsername();
    sparkle(`Authenticated as \x1b[1m${owner}\x1b[0m — nice to meet you!`);
  } catch (err) {
    oops((err as Error).message);
    console.log(`\n  Run ${c.cyan('gh auth login')} then retry.\n`);
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
      sparkle('Fetching your gists...');
      let gists;
      try {
        gists = listGhGists(50);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
      if (!gists || gists.length === 0) {
        oops('No gists found in your GitHub account.');
        process.exit(1);
      }
      const selectedId = await askSingleSelect(
        'Select a gist:',
        gists.map((g) => ({
          label: `${g.description || c.dim('(no description)')}  ${c.dim(g.id.slice(0, 8) + '...')}  ${c.dim(relativeTime(g.updatedAt))}`,
          value: g.id,
        })),
      );
      sparkle(WITTY.verifying);
      try {
        gistInfo = await resolveGistInfo(token, selectedId);
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
      sparkle('Fetching your repositories...');
      let repos;
      try {
        repos = listGhRepos(50);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
      if (!repos || repos.length === 0) {
        oops('No repositories found in your GitHub account.');
        process.exit(1);
      }
      const selectedUrl = await askSingleSelect(
        'Select a repository:',
        repos.map((r) => ({
          label: `${r.nameWithOwner}  ${c.dim(r.isPrivate ? '(private)' : '(public)')}  ${c.dim(relativeTime(r.pushedAt || r.updatedAt))}${r.description ? `  ${c.dim(r.description)}` : ''}`,
          value: r.url,
        })),
      );
      sparkle(WITTY.verifying);
      try {
        repoInfo = await resolveRepoInfo(token, selectedUrl);
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

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  return `${months} months ago`;
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
