import * as fs from 'node:fs';
import { readConfig, writeConfig, getLocalRepoDir, resolveToken } from '../config.js';
import { resolveGistInfo } from '../storage/gist.js';
import { resolveRepoInfo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { listGhRepos, listGhGists } from '../storage/gh-cli.js';
import { sparkle, celebrate, section, oops, WITTY, c } from '../utils/sparkle.js';
import { askSingleSelect } from '../utils/prompt.js';

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

export async function setCommand(): Promise<void> {
  const config = readConfig();
  const token = resolveToken(config);

  section('Set Pocket');

  // Ask repo or gist
  const storageType = await askSingleSelect('Where does your pocket live?', [
    { label: `GitHub Repo  ${c.dim('(private repo, full git history)')}`, value: 'repo' as const },
    { label: `GitHub Gist  ${c.dim('(lighter, no git clone needed)')}`,   value: 'gist' as const },
  ]);

  if (storageType === 'gist') {
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
    let gistInfo: { id: string; htmlUrl: string };
    try {
      gistInfo = await resolveGistInfo(token, selectedId);
      sparkle(`Connected to gist pocket: ${c.cyan(gistInfo.htmlUrl)}`);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }

    writeConfig({
      ...config,
      storageType: 'gist',
      gistId: gistInfo.id,
      gistUrl: gistInfo.htmlUrl,
      repoFullName: undefined,
      repoCloneUrl: undefined,
      repoHtmlUrl: undefined,
    });
  } else {
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
    let repoInfo: Awaited<ReturnType<typeof resolveRepoInfo>>;
    try {
      repoInfo = await resolveRepoInfo(token, selectedUrl);
      sparkle(`Connected to repo pocket: ${c.cyan(repoInfo.htmlUrl)}`);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }

    const localDir = getLocalRepoDir();
    sparkle(WITTY.cloning);
    try {
      fs.mkdirSync(localDir, { recursive: true });
      cloneRepo(repoInfo.cloneUrl, token, localDir);
      ensureGitConfig(localDir);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }

    writeConfig({
      ...config,
      storageType: 'repo',
      repoFullName: repoInfo.fullName,
      repoCloneUrl: repoInfo.cloneUrl,
      repoHtmlUrl: repoInfo.htmlUrl,
      gistId: undefined,
      gistUrl: undefined,
    });
  }

  celebrate('Pocket updated!');
  console.log('');
}
