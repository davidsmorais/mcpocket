import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir, getCopilotAgentsDir } from '../utils/paths.js';
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
  // Extract agent name with full relative path, removing .md extension
  const agentName = relPath.slice(0, -3);
  return allowedNames.has(agentName);
}

/** List agent names available in ~/.claude/agents/ and ~/.copilot/agents/ */
export function listLocalAgentNames(): string[] {
  const claudeNames = listAgentNamesInDir(path.join(getClaudeHomeDir(), AGENTS_DIR));
  const copilotNames = listAgentNamesInDir(getCopilotAgentsDir());
  // Deduplicate; Claude names take precedence (listed first)
  const seen = new Set(claudeNames);
  const extras = copilotNames.filter((n) => !seen.has(n));
  return [...claudeNames, ...extras];
}

/** List agent names available in repo/agents/ */
export function listRepoAgentNames(repoDir: string): string[] {
  const dir = path.join(repoDir, AGENTS_DIR);
  return listAgentNamesInDir(dir);
}

function listAgentNamesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];

  function scanDir(currentDir: string, relPrefix: string = ''): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;

      if (entry.isFile() && entry.name.endsWith('.md')) {
        // Add agent with relative path, removing .md extension
        const agentName = relPath.slice(0, -3);
        names.push(agentName);
      } else if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subDir = path.join(currentDir, entry.name);
        scanDir(subDir, relPath);
      }
    }
  }

  scanDir(dir);
  return names;
}

/** Copy agents/ from ~/.claude/agents/ (and ~/.copilot/agents/ if present) to repo/agents/ */
export function writeAgentsToRepo(repoDir: string, allowedNames?: ReadonlySet<string>): SyncResult {
  const claudeSource = path.join(getClaudeHomeDir(), AGENTS_DIR);
  const copilotSource = getCopilotAgentsDir();
  const dest = path.join(repoDir, AGENTS_DIR);

  const sources = [copilotSource, claudeSource].filter(fs.existsSync);
  if (sources.length === 0) {
    const removed = removeManagedDir(dest);
    return { synced: 0, removed };
  }

  if (sources.length === 1) {
    return mirrorDirectory(sources[0], dest, {
      includeFile: (relPath) => isIncludedFile(relPath, allowedNames),
      includeDirectory: (relPath) => isIncludedDir(relPath),
    });
  }

  // Multiple sources: collect files from all (later sources override earlier ones),
  // then write to dest and prune stale files.
  return mirrorMultipleDirectories(sources, dest, {
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

export function clearAgentsFromRepo(repoDir: string): SyncResult {
  const dir = path.join(repoDir, AGENTS_DIR);
  if (!fs.existsSync(dir)) return { synced: 0, removed: 0 };
  const removed = removeManagedDir(dir);
  return { synced: 0, removed };
}

interface MirrorOptions {
  includeFile?: (relPath: string) => boolean;
  includeDirectory?: (relPath: string) => boolean;
}

function mirrorMultipleDirectories(
  sourceDirs: string[],
  destDir: string,
  options: MirrorOptions = {},
): SyncResult {
  const includeFile = options.includeFile ?? (() => true);
  const includeDirectory = options.includeDirectory ?? (() => true);

  // Build combined source map; later dirs in the array override earlier ones
  const sourceFiles = new Map<string, string>();
  for (const sourceDir of sourceDirs) {
    collectAgentFiles(sourceDir, '', sourceFiles, includeFile, includeDirectory);
  }

  fs.mkdirSync(destDir, { recursive: true });

  let synced = 0;
  for (const [relPath, fullPath] of sourceFiles) {
    const destPath = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(fullPath, destPath);
    synced++;
  }

  // Remove dest files not present in any source
  const destFiles = listAgentFiles(destDir);
  let removed = 0;
  for (const relPath of destFiles) {
    if (!includeFile(relPath)) continue;
    if (!sourceFiles.has(relPath)) {
      fs.rmSync(path.join(destDir, relPath), { force: true });
      removed++;
    }
  }

  removeEmptyAgentDirs(destDir);
  return { synced, removed };
}

function collectAgentFiles(
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
        collectAgentFiles(path.join(dir, entry.name), relPath, files, includeFile, includeDirectory);
      }
    } else if (entry.isFile() && includeFile(relPath)) {
      files.set(relPath, path.join(dir, entry.name));
    }
  }
}

function listAgentFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? path.join(prefix, entry.name).replace(/\\/g, '/') : entry.name;
    if (entry.isDirectory()) {
      files.push(...listAgentFiles(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

function removeEmptyAgentDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    removeEmptyAgentDirs(fullPath);
    if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
  }
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
