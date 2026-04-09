import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir } from '../utils/paths.js';
import { mirrorDirectory } from '../utils/files.js';

const AGENTS_DIR = 'agents';

export interface SyncResult {
  synced: number;
  removed: number;
}

/** Copy agents/ from ~/.claude/agents/ to repo/agents/ */
export function writeAgentsToRepo(repoDir: string): SyncResult {
  const source = path.join(getClaudeHomeDir(), AGENTS_DIR);
  const dest = path.join(repoDir, AGENTS_DIR);

  if (!fs.existsSync(source)) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  return mirrorDirectory(source, dest, {
    includeFile: (relPath) => relPath.endsWith('.md'),
    includeDirectory: (relPath) => {
      const base = path.basename(relPath);
      return !base.startsWith('.') && base !== 'node_modules';
    },
  });
}

/** Copy agents/ from repo/agents/ to ~/.claude/agents/ (overwrite) */
export function applyAgentsFromRepo(repoDir: string): SyncResult {
  const source = path.join(repoDir, AGENTS_DIR);
  const dest = path.join(getClaudeHomeDir(), AGENTS_DIR);

  if (!fs.existsSync(source)) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  return mirrorDirectory(source, dest, {
    includeFile: (relPath) => relPath.endsWith('.md'),
    includeDirectory: (relPath) => {
      const base = path.basename(relPath);
      return !base.startsWith('.') && base !== 'node_modules';
    },
  });
}

function removeManagedDir(dir: string): number {
  if (!fs.existsSync(dir)) {
    return 0;
  }

  const removed = countManagedFiles(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return removed;
}

function countManagedFiles(dir: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countManagedFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      count++;
    }
  }
  return count;
}
