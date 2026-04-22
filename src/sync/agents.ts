import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir, getCopilotAgentsDir, getGeminiAgentsDir } from '../utils/paths.js';
import { mirrorDirectory } from '../utils/files.js';

const AGENTS_DIR = 'agents';

const PROVIDER_SUBDIRS = ['claude-code', 'copilot-cli', 'gemini-cli'] as const;
type AgentProviderId = typeof PROVIDER_SUBDIRS[number];

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
  const agentName = relPath.slice(0, -3);
  return allowedNames.has(agentName);
}

/** List agent names available in ~/.claude/agents/, ~/.copilot/agents/, and ~/.gemini/agents/ */
export function listLocalAgentNames(): string[] {
  const claudeNames = listAgentNamesInDir(path.join(getClaudeHomeDir(), AGENTS_DIR));
  const copilotNames = listAgentNamesInDir(getCopilotAgentsDir());
  const geminiNames = listAgentNamesInDir(getGeminiAgentsDir());
  const seen = new Set(claudeNames);
  const copilotExtras = copilotNames.filter((n) => !seen.has(n));
  copilotExtras.forEach((name) => seen.add(name));
  const geminiExtras = geminiNames.filter((n) => !seen.has(n));
  return [...claudeNames, ...copilotExtras, ...geminiExtras];
}

/** List agent names available in repo/agents/ (supports both provider-scoped and flat structure) */
export function listRepoAgentNames(repoDir: string): string[] {
  const agentsDir = path.join(repoDir, AGENTS_DIR);
  if (!fs.existsSync(agentsDir)) return [];

  const providerDirs = PROVIDER_SUBDIRS
    .map((subdir) => path.join(agentsDir, subdir))
    .filter(fs.existsSync);

  if (providerDirs.length > 0) {
    const allNames: string[] = [];
    const seen = new Set<string>();
    for (const providerDir of providerDirs) {
      const names = listAgentNamesInDir(providerDir);
      for (const name of names) {
        if (!seen.has(name)) {
          seen.add(name);
          allNames.push(name);
        }
      }
    }
    // Also include any flat .md files at the agents/ root (migration compat)
    const flatNames = listFlatAgentNames(agentsDir);
    for (const name of flatNames) {
      if (!seen.has(name)) {
        seen.add(name);
        allNames.push(name);
      }
    }
    return allNames;
  }

  return listAgentNamesInDir(agentsDir);
}

function listFlatAgentNames(agentsDir: string): string[] {
  const names: string[] = [];
  if (!fs.existsSync(agentsDir)) return names;
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      names.push(entry.name.slice(0, -3));
    }
  }
  return names;
}

function listAgentNamesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const names: string[] = [];

  function scanDir(currentDir: string, relPrefix: string = ''): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;

      if (entry.isFile() && entry.name.endsWith('.md')) {
        const agentName = relPath.slice(0, -3);
        names.push(agentName);
      } else if (entry.isDirectory()) {
        const subDir = path.join(currentDir, entry.name);
        scanDir(subDir, relPath);
      }
    }
  }

  scanDir(dir);
  return names;
}

/**
 * Copy agents from local sources to repo/agents/<provider>/ subdirectories.
 * Each source is written to its own provider subdir to avoid duplication.
 */
export function writeAgentsToRepo(repoDir: string, allowedNames?: ReadonlySet<string>, selectedProviders?: ReadonlySet<string>): SyncResult {
  const claudeSource = path.join(getClaudeHomeDir(), AGENTS_DIR);
  const copilotSource = getCopilotAgentsDir();
  const geminiSource = getGeminiAgentsDir();
  const agentsDir = path.join(repoDir, AGENTS_DIR);

  const sources: Array<{ dir: string; provider: AgentProviderId }> = [];
  if (fs.existsSync(claudeSource) && (!selectedProviders || selectedProviders.has('claude-code'))) {
    sources.push({ dir: claudeSource, provider: 'claude-code' });
  }
  if (fs.existsSync(copilotSource) && (!selectedProviders || selectedProviders.has('copilot-cli'))) {
    sources.push({ dir: copilotSource, provider: 'copilot-cli' });
  }
  if (fs.existsSync(geminiSource) && (!selectedProviders || selectedProviders.has('gemini-cli'))) {
    sources.push({ dir: geminiSource, provider: 'gemini-cli' });
  }

  if (sources.length === 0) {
    let removed = 0;
    for (const subdir of PROVIDER_SUBDIRS) {
      removed += removeManagedDir(path.join(agentsDir, subdir));
    }
    removed += removeManagedDir(agentsDir);
    return { synced: 0, removed };
  }

  let totalSynced = 0;
  let totalRemoved = 0;

  for (const { dir: source, provider } of sources) {
    const dest = path.join(agentsDir, provider);
    const result = mirrorDirectory(source, dest, {
      includeFile: (relPath) => isIncludedFile(relPath, allowedNames),
      includeDirectory: (relPath) => isIncludedDir(relPath),
    });
    totalSynced += result.synced;
    totalRemoved += result.removed;
  }

  for (const subdir of PROVIDER_SUBDIRS) {
    const providerDir = path.join(agentsDir, subdir);
    const hasSource = sources.some((s) => s.provider === subdir);
    if (!hasSource && fs.existsSync(providerDir)) {
      totalRemoved += removeManagedDir(providerDir);
    }
  }

  totalRemoved += migrateFlatAgentsToProviderDirs(agentsDir);

  return { synced: totalSynced, removed: totalRemoved };
}

/**
 * Copy agents from repo/agents/<provider>/ subdirectories to ~/.claude/agents/.
 * Reads from all provider subdirs and merges into the Claude home directory.
 */
function getAgentProviderTarget(providerId: AgentProviderId): string {
  const targets: Record<AgentProviderId, string> = {
    'claude-code': path.join(getClaudeHomeDir(), AGENTS_DIR),
    'copilot-cli': getCopilotAgentsDir(),
    'gemini-cli': getGeminiAgentsDir(),
  };
  return targets[providerId];
}

export function applyAgentsFromRepo(repoDir: string, allowedNames?: ReadonlySet<string>, selectedProviders?: ReadonlySet<string>): SyncResult {
  const agentsDir = path.join(repoDir, AGENTS_DIR);

  const providerDirs = PROVIDER_SUBDIRS
    .filter((subdir) => !selectedProviders || selectedProviders.has(subdir))
    .map((subdir) => path.join(agentsDir, subdir))
    .filter(fs.existsSync);

  if (providerDirs.length === 0) {
    if (fs.existsSync(agentsDir)) {
      const dest = path.join(getClaudeHomeDir(), AGENTS_DIR);
      return mirrorDirectory(agentsDir, dest, {
        includeFile: (relPath) => isIncludedFile(relPath, allowedNames),
        includeDirectory: (relPath) => isIncludedDir(relPath),
      });
    }
    let removed = 0;
    for (const providerSubdir of PROVIDER_SUBDIRS) {
      removed += removeManagedDir(getAgentProviderTarget(providerSubdir));
    }
    return { synced: 0, removed };
  }

  let totalSynced = 0;
  let totalRemoved = 0;

  for (const providerSubdir of PROVIDER_SUBDIRS) {
    const sourceDir = path.join(agentsDir, providerSubdir);
    if (!fs.existsSync(sourceDir)) continue;

    const destDir = getAgentProviderTarget(providerSubdir);
    const result = mirrorDirectory(sourceDir, destDir, {
      includeFile: (relPath) => isIncludedFile(relPath, allowedNames),
      includeDirectory: (relPath) => isIncludedDir(relPath),
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

export interface AgentEntry {
  name: string;
  /** Source label used by provider-filtering UI. */
  provider: 'claude' | 'copilot' | 'gemini';
}

/** List agents with their source provider, deduplicating (Claude takes precedence) */
export function listLocalAgentsWithProviders(): AgentEntry[] {
  const claudeNames = listAgentNamesInDir(path.join(getClaudeHomeDir(), AGENTS_DIR));
  const copilotNames = listAgentNamesInDir(getCopilotAgentsDir());
  const geminiNames = listAgentNamesInDir(getGeminiAgentsDir());
  const seen = new Set(claudeNames);
  const copilotUnique = copilotNames.filter((n) => !seen.has(n));
  copilotUnique.forEach((name) => seen.add(name));
  return [
    ...claudeNames.map((name): AgentEntry => ({ name, provider: 'claude' })),
    ...copilotUnique.map((name): AgentEntry => ({ name, provider: 'copilot' })),
    ...geminiNames.filter((n) => !seen.has(n)).map((name): AgentEntry => ({ name, provider: 'gemini' })),
  ];
}

/** Find agents that exist in both Claude and Copilot directories (Claude wins, Copilot copy is the duplicate) */
export function findDuplicateAgents(): Array<{ name: string; keepIn: string; removeFrom: string }> {
  const claudeNames = new Set(listAgentNamesInDir(path.join(getClaudeHomeDir(), AGENTS_DIR)));
  const copilotNames = listAgentNamesInDir(getCopilotAgentsDir());
  return copilotNames
    .filter((n) => claudeNames.has(n))
    .map((name) => ({ name, keepIn: '~/.claude/agents/', removeFrom: '~/.copilot/agents/' }));
}

/** Remove an agent file from the Copilot agents directory */
export function removeAgentFromCopilot(name: string): boolean {
  const filePath = path.join(getCopilotAgentsDir(), name + '.md');
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  const parentDir = path.dirname(filePath);
  if (parentDir !== getCopilotAgentsDir() && fs.readdirSync(parentDir).length === 0) {
    fs.rmdirSync(parentDir);
  }
  return true;
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

function migrateFlatAgentsToProviderDirs(agentsDir: string): number {
  if (!fs.existsSync(agentsDir)) return 0;
  let removed = 0;
  const providerDirNames = new Set<string>(PROVIDER_SUBDIRS);
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (providerDirNames.has(entry.name)) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = path.join(agentsDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      fs.unlinkSync(fullPath);
      removed++;
    } else if (entry.isDirectory()) {
      const subFiles = fs.readdirSync(fullPath, { withFileTypes: true });
      const hasMdFiles = subFiles.some((f) => f.isFile() && f.name.endsWith('.md'));
      if (!hasMdFiles) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed++;
      }
    }
  }
  return removed;
}
