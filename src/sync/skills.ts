import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir } from '../utils/paths.js';
import { mirrorDirectory } from '../utils/files.js';
import type { SyncResult } from './agents.js';

const SKILLS_DIR = 'skills';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '__pycache__']);
const SKIP_PREFIXES = ['.'];

function shouldSkip(name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  for (const prefix of SKIP_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

function isAllowedTopLevel(relPath: string, allowedNames?: ReadonlySet<string>): boolean {
  if (!allowedNames) return true;
  // Check if relPath is under any of the allowed skill directories
  // Skills can now be nested (e.g., "team/my-skill"), so we check if relPath
  // matches or is under any allowed skill directory
  for (const skillName of allowedNames) {
    if (relPath === skillName || relPath.startsWith(skillName + path.sep)) {
      return true;
    }
  }
  return false;
}

/** List skill names (top-level entries) available in ~/.claude/skills/ */
export function listLocalSkillNames(): string[] {
  const dir = path.join(getClaudeHomeDir(), SKILLS_DIR);
  return listSkillNamesInDir(dir);
}

/** List skill names (top-level entries) available in repo/skills/ */
export function listRepoSkillNames(repoDir: string): string[] {
  const dir = path.join(repoDir, SKILLS_DIR);
  return listSkillNamesInDir(dir);
}

function listSkillNamesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];

  function scanDir(currentDir: string, relPrefix: string = ''): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (shouldSkip(entry.name)) continue;
      const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Add skill directory name with relative path
        names.push(relPath);
        // Recursively scan subdirectories
        const subDir = path.join(currentDir, entry.name);
        scanDir(subDir, relPath);
      }
    }
  }

  scanDir(dir);
  return names;
}

/** Copy skills/ from ~/.claude/skills/ to repo/skills/ (excluding node_modules) */
export function writeSkillsToRepo(repoDir: string, allowedNames?: ReadonlySet<string>): SyncResult {
  const source = path.join(getClaudeHomeDir(), SKILLS_DIR);
  const dest = path.join(repoDir, SKILLS_DIR);

  if (!fs.existsSync(source)) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  return mirrorDirectory(source, dest, {
    includeDirectory: (relPath) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
    includeFile: (relPath) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
  });
}

/** Copy skills/ from repo/skills/ to ~/.claude/skills/ (overwrite, excluding node_modules) */
export function applySkillsFromRepo(repoDir: string, allowedNames?: ReadonlySet<string>): SyncResult {
  const source = path.join(repoDir, SKILLS_DIR);
  const dest = path.join(getClaudeHomeDir(), SKILLS_DIR);

  if (!fs.existsSync(source)) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  return mirrorDirectory(source, dest, {
    includeDirectory: (relPath) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
    includeFile: (relPath) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
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
    if (shouldSkip(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countManagedFiles(fullPath);
    } else if (entry.isFile()) {
      count++;
    }
  }
  return count;
}
