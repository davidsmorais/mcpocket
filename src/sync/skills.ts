import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir, getGeminiAgencySkillsDir, getGeminiSkillsDir } from '../utils/paths.js';
import { mirrorDirectory } from '../utils/files.js';
import type { SyncResult } from './agents.js';

const SKILLS_DIR = 'skills';

const PROVIDER_SUBDIRS = ['claude-code', 'gemini-cli'] as const;
const LEGACY_PROVIDER_SUBDIRS = ['antigravity'] as const;
type SkillProviderId = typeof PROVIDER_SUBDIRS[number];
type LegacySkillProviderId = typeof LEGACY_PROVIDER_SUBDIRS[number];

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
  for (const skillName of allowedNames) {
    if (relPath === skillName || relPath.startsWith(skillName + path.sep)) {
      return true;
    }
  }
  return false;
}

function isProviderOrLegacySubdir(name: string): boolean {
  return PROVIDER_SUBDIRS.includes(name as SkillProviderId)
    || LEGACY_PROVIDER_SUBDIRS.includes(name as LegacySkillProviderId);
}

/** List skill names available in ~/.claude/skills/ and Gemini CLI skill directories. */
export function listLocalSkillNames(): string[] {
  const claudeNames = listSkillNamesInDir(path.join(getClaudeHomeDir(), SKILLS_DIR));
  const geminiNames = listGeminiSkillNames();
  const seen = new Set(claudeNames);
  const extras = geminiNames.filter((n) => !seen.has(n));
  return [...claudeNames, ...extras];
}

/** List skill names available in repo/skills/ (supports both provider-scoped and flat structure) */
export function listRepoSkillNames(repoDir: string): string[] {
  const skillsDir = path.join(repoDir, SKILLS_DIR);
  if (!fs.existsSync(skillsDir)) return [];

  const providerDirs = getRepoSkillProviderDirs(skillsDir);

  if (providerDirs.length > 0) {
    const allNames: string[] = [];
    const seen = new Set<string>();
    for (const providerDir of providerDirs) {
      const names = listSkillNamesInDir(providerDir);
      for (const name of names) {
        if (!seen.has(name)) {
          seen.add(name);
          allNames.push(name);
        }
      }
    }
    // Also include any flat skill dirs at the skills/ root (migration compat)
    const flatNames = listFlatSkillNames(skillsDir);
    for (const name of flatNames) {
      if (!seen.has(name)) {
        seen.add(name);
        allNames.push(name);
      }
    }
    return allNames;
  }

  return listSkillNamesInDir(skillsDir);
}

function listFlatSkillNames(skillsDir: string): string[] {
  const names: string[] = [];
  if (!fs.existsSync(skillsDir)) return names;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !shouldSkip(entry.name) && !isProviderOrLegacySubdir(entry.name)) {
      names.push(entry.name);
    }
  }
  return names;
}

function listSkillNamesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];

  function scanDir(currentDir: string, relPrefix: string = ''): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (shouldSkip(entry.name)) continue;
      const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        names.push(relPath);
        const subDir = path.join(currentDir, entry.name);
        scanDir(subDir, relPath);
      }
    }
  }

  scanDir(dir);
  return names;
}

/**
 * Copy skills from local sources to repo/skills/<provider>/ subdirectories.
 * Each source is written to its own provider subdir to avoid duplication.
 */
export function writeSkillsToRepo(repoDir: string, allowedNames?: ReadonlySet<string>, selectedProviders?: ReadonlySet<string>): SyncResult {
  const claudeSource = path.join(getClaudeHomeDir(), SKILLS_DIR);
  const skillsDir = path.join(repoDir, SKILLS_DIR);

  const includeDir = (relPath: string) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames);
  const includeFile = (relPath: string) => relPath.endsWith('.md') && !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames);

  const sources: Array<{ dir: string; provider: SkillProviderId }> = [];
  if (fs.existsSync(claudeSource) && (!selectedProviders || selectedProviders.has('claude-code'))) {
    sources.push({ dir: claudeSource, provider: 'claude-code' });
  }
  const geminiSource = getPreferredGeminiSkillSourceDir();
  if (geminiSource && (!selectedProviders || selectedProviders.has('gemini-cli'))) {
    sources.push({ dir: geminiSource, provider: 'gemini-cli' });
  }

  if (sources.length === 0) {
    let removed = 0;
    for (const subdir of PROVIDER_SUBDIRS) {
      removed += removeManagedDir(path.join(skillsDir, subdir));
    }
    removed += removeManagedDir(skillsDir);
    return { synced: 0, removed };
  }

  let totalSynced = 0;
  let totalRemoved = 0;

  for (const { dir: source, provider } of sources) {
    const dest = path.join(skillsDir, provider);
    const result = mirrorDirectory(source, dest, { includeDirectory: includeDir, includeFile });
    totalSynced += result.synced;
    totalRemoved += result.removed;
  }

  for (const subdir of PROVIDER_SUBDIRS) {
    const providerDir = path.join(skillsDir, subdir);
    const hasSource = sources.some((s) => s.provider === subdir);
    if (!hasSource && fs.existsSync(providerDir)) {
      totalRemoved += removeManagedDir(providerDir);
    }
  }

  totalRemoved += migrateFlatSkillsToProviderDirs(skillsDir);

  return { synced: totalSynced, removed: totalRemoved };
}

function getSkillProviderTarget(providerId: SkillProviderId): string {
  const targets: Record<SkillProviderId, string> = {
    'claude-code': path.join(getClaudeHomeDir(), SKILLS_DIR),
    'gemini-cli': getGeminiSkillsDir(),
  };
  return targets[providerId];
}

/**
 * Copy skills from repo/skills/<provider>/ subdirectories to their respective provider target directories.
 * Each provider's files go only to its matching target — no duplication.
 */
export function applySkillsFromRepo(repoDir: string, allowedNames?: ReadonlySet<string>, selectedProviders?: ReadonlySet<string>): SyncResult {
  const skillsDir = path.join(repoDir, SKILLS_DIR);

  const providerDirs = getRepoSkillProviderDirs(skillsDir, selectedProviders);

  if (providerDirs.length === 0) {
    if (fs.existsSync(skillsDir)) {
      const dest = path.join(getClaudeHomeDir(), SKILLS_DIR);
      return mirrorDirectory(skillsDir, dest, {
        includeDirectory: (relPath) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
        includeFile: (relPath) => relPath.endsWith('.md') && !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
      });
    }
    let removed = 0;
    for (const providerSubdir of PROVIDER_SUBDIRS) {
      removed += removeManagedDir(getSkillProviderTarget(providerSubdir));
    }
    return { synced: 0, removed };
  }

  let totalSynced = 0;
  let totalRemoved = 0;

  for (const providerSubdir of PROVIDER_SUBDIRS) {
    const sourceDir = providerSubdir === 'gemini-cli'
      ? getPreferredRepoGeminiSkillSourceDir(skillsDir)
      : path.join(skillsDir, providerSubdir);
    if (!sourceDir || !fs.existsSync(sourceDir)) continue;

    const destDir = getSkillProviderTarget(providerSubdir);
    const result = mirrorDirectory(sourceDir, destDir, {
      includeDirectory: (relPath) => !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
      includeFile: (relPath) => relPath.endsWith('.md') && !shouldSkip(path.basename(relPath)) && isAllowedTopLevel(relPath, allowedNames),
    });
    totalSynced += result.synced;
    totalRemoved += result.removed;
  }

  return { synced: totalSynced, removed: totalRemoved };
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

export interface SkillEntry {
  name: string;
  provider: 'claude' | 'gemini';
}

/** List skills with their source provider, deduplicating (Claude takes precedence) */
export function listLocalSkillsWithProviders(): SkillEntry[] {
  const claudeNames = listSkillNamesInDir(path.join(getClaudeHomeDir(), SKILLS_DIR));
  const geminiNames = listGeminiSkillNames();
  const seen = new Set(claudeNames);
  return [
    ...claudeNames.map((name): SkillEntry => ({ name, provider: 'claude' })),
    ...geminiNames.filter((n) => !seen.has(n)).map((name): SkillEntry => ({ name, provider: 'gemini' })),
  ];
}

/** Find top-level skills that exist in both Claude and Gemini directories (Claude wins, Gemini copy is the duplicate) */
export function findDuplicateSkills(): Array<{ name: string; keepIn: string; removeFrom: string }> {
  const claudeTopLevel = new Set(
    listSkillNamesInDir(path.join(getClaudeHomeDir(), SKILLS_DIR))
      .filter((n) => !n.includes('/') && !n.includes(path.sep)),
  );
  const geminiTopLevel = listGeminiSkillNames()
    .filter((n) => !n.includes('/') && !n.includes(path.sep));
  return geminiTopLevel
    .filter((n) => claudeTopLevel.has(n))
    .map((name) => ({
      name,
      keepIn: '~/.claude/skills/',
      removeFrom: '~/.gemini/skills/',
    }));
}

/** Remove a skill directory from the Gemini CLI skills directory */
export function removeSkillFromGemini(name: string): boolean {
  const skillDir = path.join(getGeminiSkillsDir(), name);
  if (!fs.existsSync(skillDir)) return false;
  fs.rmSync(skillDir, { recursive: true, force: true });
  return true;
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
  for (const entry of fs.readdirSync(dir, { withFileTypes: true})) {
    if (!entry.isDirectory() || shouldSkip(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    pruneEmptyDirs(fullPath);
    if (fs.readdirSync(fullPath).length === 0) {
      fs.rmdirSync(fullPath);
    }
  }
}

function migrateFlatSkillsToProviderDirs(skillsDir: string): number {
  if (!fs.existsSync(skillsDir)) return 0;
  let removed = 0;
  const providerDirNames = new Set<string>(PROVIDER_SUBDIRS);
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (providerDirNames.has(entry.name)) continue;
    if (shouldSkip(entry.name)) continue;
    const fullPath = path.join(skillsDir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

function getGeminiSkillSourceDirs(): string[] {
  return [getGeminiSkillsDir(), getGeminiAgencySkillsDir()];
}

function getPreferredGeminiSkillSourceDir(): string | undefined {
  return getGeminiSkillSourceDirs().find((dir) => fs.existsSync(dir));
}

function listGeminiSkillNames(): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const sourceDir of getGeminiSkillSourceDirs()) {
    const sourceNames = listSkillNamesInDir(sourceDir);
    for (const name of sourceNames) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

function getPreferredRepoGeminiSkillSourceDir(skillsDir: string): string | undefined {
  const candidates = [path.join(skillsDir, 'gemini-cli'), ...LEGACY_PROVIDER_SUBDIRS.map((legacy) => path.join(skillsDir, legacy))];
  return candidates.find((dir) => fs.existsSync(dir));
}

function getRepoSkillProviderDirs(skillsDir: string, selectedProviders?: ReadonlySet<string>): string[] {
  const dirs: string[] = [];
  if (!selectedProviders || selectedProviders.has('claude-code')) {
    const claudeDir = path.join(skillsDir, 'claude-code');
    if (fs.existsSync(claudeDir)) dirs.push(claudeDir);
  }
  if (!selectedProviders || selectedProviders.has('gemini-cli')) {
    const geminiDir = path.join(skillsDir, 'gemini-cli');
    if (fs.existsSync(geminiDir)) dirs.push(geminiDir);
    for (const legacySubdir of LEGACY_PROVIDER_SUBDIRS) {
      const legacyDir = path.join(skillsDir, legacySubdir);
      if (fs.existsSync(legacyDir)) dirs.push(legacyDir);
    }
  }
  return dirs;
}
