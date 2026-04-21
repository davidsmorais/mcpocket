import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir, getGeminiAgencySkillsDir } from '../utils/paths.js';
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

/** List skill names (top-level entries) available in ~/.claude/skills/ and ~/.gemini/extensions/agency-agents/skills/ */
export function listLocalSkillNames(): string[] {
  const claudeNames = listSkillNamesInDir(path.join(getClaudeHomeDir(), SKILLS_DIR));
  const geminiNames = listSkillNamesInDir(getGeminiAgencySkillsDir());
  const seen = new Set(claudeNames);
  const extras = geminiNames.filter((n) => !seen.has(n));
  return [...claudeNames, ...extras];
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

/** Copy skills/ from ~/.claude/skills/ (and ~/.gemini/extensions/agency-agents/skills/ if present) to repo/skills/ */
export function writeSkillsToRepo(repoDir: string, allowedNames?: ReadonlySet<string>): SyncResult {
  const claudeSource = path.join(getClaudeHomeDir(), SKILLS_DIR);
  const geminiSource = getGeminiAgencySkillsDir();
  const dest = path.join(repoDir, SKILLS_DIR);

  const includeDir = (relPath: string) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames);
  const includeFile = (relPath: string) => relPath.endsWith('.md') && !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames);

  const sources = [geminiSource, claudeSource].filter(fs.existsSync);
  if (sources.length === 0) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  if (sources.length === 1) {
    return mirrorDirectory(sources[0], dest, { includeDirectory: includeDir, includeFile });
  }

  return mirrorMultipleSkillDirs(sources, dest, { includeDirectory: includeDir, includeFile });
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
    includeFile: (relPath) => relPath.endsWith('.md') && !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
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

export function clearSkillsFromRepo(repoDir: string): SyncResult {
  const dir = path.join(repoDir, SKILLS_DIR);
  if (!fs.existsSync(dir)) return { synced: 0, removed: 0 };
  const removed = removeManagedDir(dir);
  return { synced: 0, removed };
}

export function pruneSkillsFromRepo(repoDir: string, keepNames: ReadonlySet<string>): SyncResult {
  const dir = path.join(repoDir, SKILLS_DIR);
  if (!fs.existsSync(dir)) return { synced: 0, removed: 0 };

  let removed = 0;
  function scanAndRemove(currentDir: string, relPrefix: string = ''): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (shouldSkip(entry.name)) continue;
      const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;

      if (entry.isFile()) {
        if (!keepNames.has(relPath)) {
          fs.unlinkSync(path.join(currentDir, entry.name));
          removed++;
        }
      } else if (entry.isDirectory()) {
        scanAndRemove(path.join(currentDir, entry.name), relPath);
      }
    }
  }

  scanAndRemove(dir);
  pruneEmptyDirs(dir);
  return { synced: 0, removed };
}

interface MirrorOptions {
  includeFile?: (relPath: string) => boolean;
  includeDirectory?: (relPath: string) => boolean;
}

function mirrorMultipleSkillDirs(
  sourceDirs: string[],
  destDir: string,
  options: MirrorOptions = {},
): SyncResult {
  const includeFile = options.includeFile ?? (() => true);
  const includeDirectory = options.includeDirectory ?? (() => true);

  const sourceFiles = new Map<string, string>();
  for (const sourceDir of sourceDirs) {
    collectSkillFiles(sourceDir, '', sourceFiles, includeFile, includeDirectory);
  }

  fs.mkdirSync(destDir, { recursive: true });

  let synced = 0;
  for (const [relPath, fullPath] of sourceFiles) {
    const destPath = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(fullPath, destPath);
    synced++;
  }

  const destFiles = listSkillFiles(destDir);
  let removed = 0;
  for (const relPath of destFiles) {
    if (!includeFile(relPath)) continue;
    if (!sourceFiles.has(relPath)) {
      fs.rmSync(path.join(destDir, relPath), { force: true });
      removed++;
    }
  }

  pruneEmptyDirs(destDir);
  return { synced, removed };
}

function collectSkillFiles(
  dir: string,
  prefix: string,
  files: Map<string, string>,
  includeFile: (relPath: string) => boolean,
  includeDirectory: (relPath: string) => boolean,
): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? path.join(prefix, entry.name).replace(/\\/g, '/') : entry.name;
    if (entry.isDirectory()) {
      if (includeDirectory(relPath)) {
        collectSkillFiles(path.join(dir, entry.name), relPath, files, includeFile, includeDirectory);
      }
    } else if (entry.isFile() && includeFile(relPath)) {
      files.set(relPath, path.join(dir, entry.name));
    }
  }
}

function listSkillFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? path.join(prefix, entry.name).replace(/\\/g, '/') : entry.name;
    if (entry.isDirectory()) {
      files.push(...listSkillFiles(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
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

function pruneEmptyDirs(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || shouldSkip(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    pruneEmptyDirs(fullPath);
    if (fs.readdirSync(fullPath).length === 0) {
      fs.rmdirSync(fullPath);
    }
  }
}
