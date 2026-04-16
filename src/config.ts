import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getMcpocketConfigDir, getMcpocketConfigPath } from './utils/paths.js';
import { getGhToken } from './storage/gh-cli.js';

export type StorageType = 'repo' | 'gist';
export type SyncCategory = 'mcps' | 'agents' | 'skills' | 'plugins';
export const ALL_SYNC_CATEGORIES: SyncCategory[] = ['mcps', 'agents', 'skills', 'plugins'];

export interface McpocketConfig {
  githubToken?: string;  // optional — obtained from GH CLI when absent
  storageType: StorageType;
  // Repo storage
  repoFullName?: string;
  repoCloneUrl?: string;
  repoHtmlUrl?: string;
  // Gist storage
  gistId?: string;
  gistUrl?: string;
  // Sync scope (undefined = all)
  syncCategories?: SyncCategory[];
  syncProviders?: string[];
  // Individual item selection (when using --ui flag)
  syncAgents?: string[];
  syncSkills?: string[];
  syncPlugins?: string[];
  // Cleanup filters (used by `mcpocket cleanup --local`)
  cleanupInclude?: string[];
  cleanupExclude?: string[];
  // Project mode
  projects?: Record<string, string[]>;
}

export function configExists(): boolean {
  return fs.existsSync(getMcpocketConfigPath());
}

export function readConfig(): McpocketConfig {
  const configPath = getMcpocketConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'mcpocket is not initialized. Run `mcpocket init` first.'
    );
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  // Backward compat: configs created before gist support default to repo
  if (!raw.storageType) {
    raw.storageType = 'repo';
  }
  return raw;
}

export function writeConfig(config: McpocketConfig): void {
  const dir = getMcpocketConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getMcpocketConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  // Restrict permissions on non-Windows (contains GitHub token)
  if (process.platform !== 'win32') {
    fs.chmodSync(getMcpocketConfigPath(), 0o600);
  }
}

/** Local staging directory for synced pocket contents */
export function getLocalRepoDir(): string {
  return path.join(os.homedir(), '.mcpocket', 'repo');
}

/**
 * Resolve the GitHub token: use the stored token when available (backward
 * compat for configs created before GH CLI auth), otherwise fall back to the
 * token from the GH CLI (`gh auth token`).
 */
export function resolveToken(config: McpocketConfig): string {
  if (config.githubToken) return config.githubToken;
  return getGhToken();
}
