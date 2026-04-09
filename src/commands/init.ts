import { getAuthenticatedUser, createRepo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { writeConfig, configExists, getLocalRepoDir } from '../config.js';
import { ask, askSecret } from '../utils/prompt.js';

export async function initCommand(): Promise<void> {
  console.log('carry-on init\n');

  if (configExists()) {
    const overwrite = await ask('carry-on is already initialized. Re-initialize? [y/N] ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborted.');
      return;
    }
  }

  // Get GitHub token
  console.log('Enter your GitHub personal access token.');
  console.log('Required scopes: repo (full control of private repositories)\n');
  console.log('Create one at: https://github.com/settings/tokens/new\n');

  const token = await askSecret('GitHub token: ');
  if (!token) {
    console.error('Error: token cannot be empty.');
    process.exit(1);
  }

  // Verify token and get username
  console.log('\nVerifying token...');
  let owner = '';
  try {
    owner = await getAuthenticatedUser(token);
    console.log(`✓ Authenticated as ${owner}`);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Create repo
  console.log('\nCreating private repo carry-on-sync...');
  let repoInfo: Awaited<ReturnType<typeof createRepo>>;
  try {
    repoInfo = await createRepo(token, owner);
    console.log(`✓ Repo ready: ${repoInfo.htmlUrl}`);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Clone repo locally
  const localDir = getLocalRepoDir();
  console.log(`\nCloning to ${localDir}...`);
  try {
    cloneRepo(repoInfo.cloneUrl, token, localDir);
    ensureGitConfig(localDir);
    console.log('✓ Repo cloned');
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Save config
  writeConfig({
    githubToken: token,
    repoFullName: repoInfo.fullName,
    repoCloneUrl: repoInfo.cloneUrl,
    repoHtmlUrl: repoInfo.htmlUrl,
  });

  console.log('\n✓ carry-on initialized!');
  console.log('\nNext steps:');
  console.log('  carry-on push   — sync this machine\'s setup to the cloud');
  console.log('  carry-on pull   — restore your setup on a new machine');
}
