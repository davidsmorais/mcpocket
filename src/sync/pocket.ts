import { pruneDirectoryTopLevel } from '../utils/files.js';

export const MANAGED_POCKET_TOP_LEVEL = new Set([
  '.git',
  'mcp-config.json',
  'plugins',
  'agents',
  'skills',
]);

export const AGENT_PROVIDER_SUBDIRS = ['claude-code', 'copilot-cli'] as const;
export const SKILL_PROVIDER_SUBDIRS = ['claude-code', 'antigravity'] as const;

export function prunePocketDir(repoDir: string): number {
  return pruneDirectoryTopLevel(repoDir, MANAGED_POCKET_TOP_LEVEL);
}
