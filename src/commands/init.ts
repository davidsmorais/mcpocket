import { getAuthenticatedUser, createRepo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { writeConfig, configExists, getLocalRepoDir } from '../config.js';
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

  // Create repo
  sparkle('Creating your private sync pocket (mcpocket-sync)...');
  let repoInfo: Awaited<ReturnType<typeof createRepo>>;
  try {
    repoInfo = await createRepo(token, owner);
    sparkle(`Pocket ready: ${repoInfo.htmlUrl}`);
  } catch (err) {
    oops((err as Error).message);
    process.exit(1);
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

  // Save config
  writeConfig({
    githubToken: token,
    repoFullName: repoInfo.fullName,
    repoCloneUrl: repoInfo.cloneUrl,
    repoHtmlUrl: repoInfo.htmlUrl,
  });

  celebrate(WITTY.initDone);
  console.log('\n  Next steps:');
  sparkle('mcpocket push   — tuck your setup into the cloud');
  sparkle('mcpocket pull   — unpack your setup on a new machine');
  console.log('');
}
