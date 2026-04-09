import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getMcpocketConfigDir, getMcpocketConfigPath } from './utils/paths.js';

export type StorageType = 'repo' | 'gist';

export interface McpocketConfig {
  githubToken: string;
  storageType: StorageType;
  // Repo storage
  repoFullName?: string;
  repoCloneUrl?: string;
  repoHtmlUrl?: string;
  // Gist storage
  gistId?: string;
  gistUrl?: string;
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
