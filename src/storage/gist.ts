import * as fs from 'fs';
import * as path from 'path';
import { mirrorFileMapToDir } from '../utils/files.js';

const GITHUB_API = 'https://api.github.com';

export interface GistInfo {
  id: string;
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

/**
 * Resolve a gist URL (https://gist.github.com/user/id) or raw ID to GistInfo,
 * verifying it's accessible with the given token.
 */
export async function resolveGistInfo(token: string, urlOrId: string): Promise<GistInfo> {
  const trimmed = urlOrId.trim();
  // Extract ID from URL: https://gist.github.com/user/gistId
  const urlMatch = trimmed.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i);
  const gistId = urlMatch ? urlMatch[1] : trimmed;

  const res = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    headers: headers(token),
  });

  if (!res.ok) {
    throw new Error(`Could not access gist (${res.status}): ${await res.text()}`);
  }

  const data = await res.json() as { id: string; html_url: string };
  return { id: data.id, htmlUrl: data.html_url };
}

/** Create a private gist as the sync target */
export async function createGist(token: string): Promise<GistInfo> {
  const res = await fetch(`${GITHUB_API}/gists`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      description: 'mcpocket: AI agent config sync',
      public: false,
      files: {
        'mcpocket.json': { content: JSON.stringify({ version: 1 }, null, 2) },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create gist (${res.status}): ${await res.text()}`);
  }

  const data = await res.json() as { id: string; html_url: string };
  return { id: data.id, htmlUrl: data.html_url };
}

/** Upload files to an existing gist (creates/updates, does not delete missing files) */
export async function updateGist(
  token: string,
  gistId: string,
  files: Record<string, string>,
): Promise<void> {
  const gistFiles: Record<string, { content: string }> = {};
  for (const [name, content] of Object.entries(files)) {
    gistFiles[name] = { content };
  }

  const existingFiles = await fetchGist(token, gistId);
  for (const name of Object.keys(existingFiles)) {
    if (!(name in files)) {
      gistFiles[name] = { content: '' };
    }
  }

  const res = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({
      files: Object.fromEntries(
        Object.entries(gistFiles).map(([name, file]) => [
          name,
          name in files ? file : null,
        ])
      ),
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update gist (${res.status}): ${await res.text()}`);
  }
}

/** Fetch all files from a gist */
export async function fetchGist(
  token: string,
  gistId: string,
): Promise<Record<string, string>> {
  const res = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    headers: headers(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch gist (${res.status}): ${await res.text()}`);
  }

  const data = await res.json() as {
    files: Record<string, { filename: string; content: string }>;
  };

  const files: Record<string, string> = {};
  for (const [name, file] of Object.entries(data.files)) {
    files[name] = file.content;
  }
  return files;
}

/**
 * Collect all files from a directory into a flat map.
 * Directory separators are encoded as __ in keys.
 */
export function collectFilesFromDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!fs.existsSync(dir)) return files;
  collectRecursive(dir, '', files);
  return files;
}

function collectRecursive(
  dir: string,
  prefix: string,
  files: Record<string, string>,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const key = prefix ? `${prefix}__${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectRecursive(fullPath, key, files);
    } else if (entry.isFile()) {
      files[key] = fs.readFileSync(fullPath, 'utf8');
    }
  }
}

/**
 * Write flat gist files back to a directory.
 * Keys with __ are expanded to subdirectories.
 */
export function writeGistFilesToDir(
  dir: string,
  files: Record<string, string>,
): void {
  const expandedFiles = Object.fromEntries(
    Object.entries(files).map(([key, content]) => [key.split('__').join(path.sep), content])
  );
  mirrorFileMapToDir(dir, expandedFiles, {
    protectedTopLevelNames: new Set(['.git']),
  });
}
