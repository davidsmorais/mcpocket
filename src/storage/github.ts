import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

const GITHUB_API = 'https://api.github.com';

export interface RepoInfo {
  fullName: string;  // owner/repo
  cloneUrl: string;
  sshUrl: string;
  htmlUrl: string;
}

function headers(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mcpocket-cli',
  };
}

/** Get the authenticated user's login */
export async function getAuthenticatedUser(token: string): Promise<string> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: headers(token) });
  if (!res.ok) {
    throw new Error(`GitHub auth failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json() as { login: string };
  return data.login;
}

/** Create a private repo named mcpocket-sync (idempotent — returns existing if 422) */
export async function createRepo(token: string, owner: string): Promise<RepoInfo> {
  const repoName = 'mcpocket-sync';

  // Try creating
  const res = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      name: repoName,
      description: 'mcpocket: AI agent config sync',
      private: true,
      auto_init: true,
    }),
  });

  if (res.ok) {
    const data = await res.json() as { full_name: string; clone_url: string; ssh_url: string; html_url: string };
    return {
      fullName: data.full_name,
      cloneUrl: data.clone_url,
      sshUrl: data.ssh_url,
      htmlUrl: data.html_url,
    };
  }

  // 422 = already exists, fetch it
  if (res.status === 422) {
    const existing = await fetch(`${GITHUB_API}/repos/${owner}/${repoName}`, {
      headers: headers(token),
    });
    if (existing.ok) {
      const data = await existing.json() as { full_name: string; clone_url: string; ssh_url: string; html_url: string };
      return {
        fullName: data.full_name,
        cloneUrl: data.clone_url,
        sshUrl: data.ssh_url,
        htmlUrl: data.html_url,
      };
    }
  }

  throw new Error(`Failed to create/fetch repo (${res.status}): ${await res.text()}`);
}

/** Clone the repo to a local directory. Uses HTTPS with token auth. */
export function cloneRepo(cloneUrl: string, token: string, localDir: string): void {
  if (fs.existsSync(path.join(localDir, '.git'))) {
    return; // already cloned
  }

  // Inject token into clone URL: https://token@github.com/...
  const authUrl = cloneUrl.replace('https://', `https://${token}@`);
  const parentDir = path.dirname(localDir);
  const repoDir = path.basename(localDir);

  fs.mkdirSync(parentDir, { recursive: true });
  run('git', ['clone', authUrl, repoDir], { cwd: parentDir });
}

/** Pull latest changes */
export function pullRepo(localDir: string, token: string, remoteUrl: string): void {
  if (!fs.existsSync(path.join(localDir, '.git'))) {
    cloneRepo(remoteUrl, token, localDir);
    return;
  }
  // Update remote URL with auth token in case it changed
  const authUrl = remoteUrl.replace('https://', `https://${token}@`);
  run('git', ['remote', 'set-url', 'origin', authUrl], { cwd: localDir });
  run('git', ['pull', '--rebase', 'origin', 'main'], { cwd: localDir });
}

/** Stage all changes, commit, and push */
export function commitAndPush(localDir: string, token: string, remoteUrl: string, message = 'mcpocket: sync'): void {
  const authUrl = remoteUrl.replace('https://', `https://${token}@`);
  run('git', ['remote', 'set-url', 'origin', authUrl], { cwd: localDir });
  run('git', ['add', '-A'], { cwd: localDir });

  // Check if there's anything to commit
  const status = child_process.spawnSync('git', ['status', '--porcelain'], {
    cwd: localDir,
    encoding: 'utf8',
  });
  if (!status.stdout?.trim()) {
    console.log('[mcpocket] Nothing changed — remote is already up to date.');
    return;
  }

  run('git', ['commit', '-m', message], { cwd: localDir });
  run('git', ['push', 'origin', 'main'], { cwd: localDir });
}

/** Configure git user in the repo if not set globally */
export function ensureGitConfig(localDir: string): void {
  const name = child_process.spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
  if (!name.stdout?.trim()) {
    run('git', ['config', 'user.name', 'mcpocket'], { cwd: localDir });
  }
  const email = child_process.spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' });
  if (!email.stdout?.trim()) {
    run('git', ['config', 'user.email', 'mcpocket@localhost'], { cwd: localDir });
  }
}

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): void {
  const result = child_process.spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || '';
    // Sanitize token from error output
    const sanitized = stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
    throw new Error(`git ${args[0]} failed: ${sanitized}`);
  }
}

