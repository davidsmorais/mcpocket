import { getAuthenticatedUser, createRepo, resolveRepoInfo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { createGist, resolveGistInfo } from '../storage/gist.js';
import { writeConfig, configExists, getLocalRepoDir } from '../config.js';
import type { StorageType } from '../config.js';
import { ask, askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, oops, heads_up, WITTY } from '../utils/sparkle.js';

export async function initCommand(): Promise<void> {
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
  console.log('  Required scopes: repo (full control of private repositories)\n');
  console.log('  Create one at: https://github.com/settings/tokens/new\n');

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
  console.log('    [1] GitHub repo  (private repo, full git history)');
  console.log('    [2] GitHub gist  (lighter, no git clone needed)\n');
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
        sparkle(`Connected to pocket: ${gistInfo.htmlUrl}`);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
    } else {
      sparkle('Creating your private sync gist...');
      try {
        gistInfo = await createGist(token);
        sparkle(`Pocket ready: ${gistInfo.htmlUrl}`);
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
      const input = await ask('  Paste your repo URL (https://github.com/owner/repo) or owner/repo: ');
      if (!input) {
        oops('Repo URL cannot be empty.');
        process.exit(1);
      }
      sparkle(WITTY.verifying);
      try {
        repoInfo = await resolveRepoInfo(token, input);
        sparkle(`Connected to pocket: ${repoInfo.htmlUrl}`);
      } catch (err) {
        oops((err as Error).message);
        process.exit(1);
      }
    } else {
      sparkle('Creating your private sync pocket (mcpocket-sync)...');
      try {
        repoInfo = await createRepo(token, owner);
        sparkle(`Pocket ready: ${repoInfo.htmlUrl}`);
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
      sparkle(`Stashed at ${localDir}`);
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
  console.log('\n  Next steps:');
  sparkle('mcpocket push   — tuck your setup into the cloud');
  sparkle('mcpocket pull   — unpack your setup on a new machine');
  console.log('');
}
