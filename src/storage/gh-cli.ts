import * as child_process from 'child_process';

export interface GhRepo {
  nameWithOwner: string;
  url: string;
  updatedAt: string;
  pushedAt: string;
  isPrivate: boolean;
  description: string | null;
}

export interface GhGist {
  id: string;
  description: string;
  url: string;
  updatedAt: string;
  isPublic: boolean;
}

function run(args: string[]): { stdout: string; ok: boolean; stderr: string } {
  const result = child_process.spawnSync('gh', args, { encoding: 'utf8' });
  return {
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    ok: result.status === 0,
  };
}

/** Get the current GH CLI auth token (requires `gh auth login` to have been run) */
export function getGhToken(): string {
  const { stdout, ok } = run(['auth', 'token']);
  if (!ok || !stdout) {
    throw new Error(
      'GitHub CLI is not authenticated. Run `gh auth login` first, then retry.',
    );
  }
  return stdout;
}

/** Get the authenticated GitHub username via GH CLI */
export function getGhUsername(): string {
  const { stdout, ok, stderr } = run(['api', 'user', '--jq', '.login']);
  if (!ok || !stdout) {
    throw new Error(
      `Could not get GitHub username. Make sure \`gh auth login\` has been run.\n${stderr}`,
    );
  }
  return stdout;
}

/** List the authenticated user's source repos, ordered by most recently pushed */
export function listGhRepos(limit = 50): GhRepo[] {
  const { stdout, ok, stderr } = run([
    'repo', 'list',
    '--json', 'nameWithOwner,url,updatedAt,pushedAt,isPrivate,description',
    '--limit', String(limit),
    '--source',
  ]);
  if (!ok) {
    throw new Error(`Could not list repositories: ${stderr}`);
  }
  return JSON.parse(stdout) as GhRepo[];
}

/** List the authenticated user's gists, ordered by most recently updated */
export function listGhGists(limit = 50): GhGist[] {
  const { stdout, ok, stderr } = run([
    'gist', 'list',
    '--json', 'id,description,url,updatedAt,isPublic',
    '--limit', String(limit),
  ]);
  if (!ok) {
    throw new Error(`Could not list gists: ${stderr}`);
  }
  return JSON.parse(stdout) as GhGist[];
}
