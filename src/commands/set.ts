import * as fs from 'node:fs';
import { readConfig, writeConfig, getLocalRepoDir } from '../config.js';
import { resolveGistInfo } from '../storage/gist.js';
import { resolveRepoInfo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { sparkle, celebrate, section, oops, WITTY } from '../utils/sparkle.js';

function detectGist(input: string): boolean {
  if (/gist\.github\.com/i.test(input)) return true;
  // Raw gist IDs are long hex strings with no slashes
  if (/^[a-f0-9]{20,}$/i.test(input)) return true;
  return false;
}

export async function setCommand(pocketUrl: string): Promise<void> {
  const config = readConfig();
  const trimmed = pocketUrl.trim();

  section('Set Pocket');

  if (detectGist(trimmed)) {
    sparkle(WITTY.verifying);
    let gistInfo: { id: string; htmlUrl: string };
    try {
      gistInfo = await resolveGistInfo(config.githubToken, trimmed);
      sparkle(`Connected to gist pocket: ${gistInfo.htmlUrl}`);
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
    sparkle(WITTY.verifying);
    let repoInfo: Awaited<ReturnType<typeof resolveRepoInfo>>;
    try {
      repoInfo = await resolveRepoInfo(config.githubToken, trimmed);
      sparkle(`Connected to repo pocket: ${repoInfo.htmlUrl}`);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }

    const localDir = getLocalRepoDir();
    sparkle(WITTY.cloning);
    try {
      fs.mkdirSync(localDir, { recursive: true });
      cloneRepo(repoInfo.cloneUrl, config.githubToken, localDir);
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

  celebrate('Pocket URL updated!');
  console.log('');
}
