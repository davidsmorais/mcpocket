import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir } from '../utils/paths.js';
import { mirrorDirectory } from '../utils/files.js';

const AGENTS_DIR = 'agents';

export interface SyncResult {
  synced: number;
  removed: number;
}

function isIncludedDir(relPath: string): boolean {
  const base = path.basename(relPath);
  return !base.startsWith('.') && base !== 'node_modules';
}

function isIncludedFile(relPath: string, allowedNames?: ReadonlySet<string>): boolean {
  if (!relPath.endsWith('.md')) return false;
  if (!allowedNames) return true;
  const name = path.basename(relPath, '.md');
  return allowedNames.has(name);
}

/** List agent names available in ~/.claude/agents/ */
export function listLocalAgentNames(): string[] {
  const dir = path.join(getClaudeHomeDir(), AGENTS_DIR);
  return listAgentNamesInDir(dir);
}

/** List agent names available in repo/agents/ */
export function listRepoAgentNames(repoDir: string): string[] {
  const dir = path.join(repoDir, AGENTS_DIR);
  return listAgentNamesInDir(dir);
}

function listAgentNamesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      names.push(path.basename(entry.name, '.md'));
    } else if (entry.isDirectory()) {
      // Include subdirectory agent files
      const subDir = path.join(dir, entry.name);
      for (const sub of fs.readdirSync(subDir, { withFileTypes: true })) {
        if (sub.isFile() && sub.name.endsWith('.md')) {
          names.push(path.basename(sub.name, '.md'));
        }
      }
    }
  }
  return names;
}

/** Copy agents/ from ~/.claude/agents/ to repo/agents/ */
export function writeAgentsToRepo(repoDir: string, allowedNames?: ReadonlySet<string>): SyncResult {
  const source = path.join(getClaudeHomeDir(), AGENTS_DIR);
  const dest = path.join(repoDir, AGENTS_DIR);

  if (!fs.existsSync(source)) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  return mirrorDirectory(source, dest, {
    includeFile: (relPath) => isIncludedFile(relPath, allowedNames),
    includeDirectory: (relPath) => isIncludedDir(relPath),
  });
}

/** Copy agents/ from repo/agents/ to ~/.claude/agents/ (overwrite) */
export function applyAgentsFromRepo(repoDir: string, allowedNames?: ReadonlySet<string>): SyncResult {
  const source = path.join(repoDir, AGENTS_DIR);
  const dest = path.join(getClaudeHomeDir(), AGENTS_DIR);

  if (!fs.existsSync(source)) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  return mirrorDirectory(source, dest, {
    includeFile: (relPath) => isIncludedFile(relPath, allowedNames),
    includeDirectory: (relPath) => isIncludedDir(relPath),
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
