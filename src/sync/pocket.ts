import { pruneDirectoryTopLevel } from '../utils/files.js';

export const MANAGED_POCKET_TOP_LEVEL = new Set([
  '.git',
  'mcp-config.json',
  'plugins',
  'agents',
  'skills',
]);

export function prunePocketDir(repoDir: string): number {
  return pruneDirectoryTopLevel(repoDir, MANAGED_POCKET_TOP_LEVEL);
}