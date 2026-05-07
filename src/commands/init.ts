import * as path from 'node:path';
import { createRepo, resolveRepoInfo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { createGist, resolveGistInfo } from '../storage/gist.js';
import { getGhToken, getGhUsername, listGhRepos, listGhGists } from '../storage/gh-cli.js';
import { writeConfig, configExists, getLocalRepoDir } from '../config.js';
import type { StorageType } from '../config.js';
import { ask, askMultiSelect, askSingleSelect } from '../utils/prompt.js';
import { sparkle, celebrate, section, oops, WITTY, c } from '../utils/sparkle.js';

export interface InitOptions {
  project?: boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  if (options.project) {
    return initProjectCommand();
  }

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

    writeConfig({
      githubToken: token,
      storageType: 'gist',
      gistId: gistInfo.id,
      gistUrl: gistInfo.htmlUrl,
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

    writeConfig({
      githubToken: token,
      storageType: 'repo',
      repoFullName: repoInfo.fullName,
      repoCloneUrl: repoInfo.cloneUrl,
      repoHtmlUrl: repoInfo.htmlUrl,
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


async function initProjectCommand(): Promise<void> {
  section('Init Project');

  const { projectConfigExists, writeProjectConfig, discoverProjectFiles } =
    await import('../sync/project.js');

  if (projectConfigExists()) {
    const answer = await ask('  Project config already exists. Re-initialize? [y/N] ');
    if (answer.toLowerCase() !== 'y') {
      sparkle('No worries, keeping project config as-is.');
      return;
    }
  }

  const defaultName = path.basename(process.cwd());
  const nameAnswer = await ask(`  Project name [${defaultName}]: `);
  const projectName = nameAnswer.trim() || defaultName;

  const discovered = discoverProjectFiles();

  let selectedFiles: string[] = [];

  if (discovered.length === 0) {
    sparkle('No well-known AI config files found in this directory.');
    sparkle('Add files like CLAUDE.md or .cursorrules and re-run `mcpocket init --project`.');
  } else {
    selectedFiles = await askMultiSelect<string>(
      'Which files should be tracked?',
      discovered.map((f) => ({ label: f, value: f })),
    );
  }

  writeProjectConfig({ projectName, files: selectedFiles });

  celebrate(`Project "${projectName}" initialized! ${selectedFiles.length} file(s) tracked.`);
  sparkle(c.cyan('mcpocket push --project') + '   — push project files to your pocket');
  sparkle(c.cyan('mcpocket pull --project') + '   — pull project files on another machine');
}
