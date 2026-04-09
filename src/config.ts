import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getCarryOnConfigDir, getCarryOnConfigPath } from './utils/paths.js';

export interface CarryOnConfig {
  githubToken: string;
  repoFullName: string;   // owner/repo
  repoCloneUrl: string;
  repoHtmlUrl: string;
}

export function configExists(): boolean {
  return fs.existsSync(getCarryOnConfigPath());
}

export function readConfig(): CarryOnConfig {
  const configPath = getCarryOnConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'carry-on is not initialized. Run `carry-on init` first.'
    );
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function writeConfig(config: CarryOnConfig): void {
  const dir = getCarryOnConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCarryOnConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  // Restrict permissions on non-Windows (contains GitHub token)
  if (process.platform !== 'win32') {
    fs.chmodSync(getCarryOnConfigPath(), 0o600);
  }
}

/** Local clone directory */
export function getLocalRepoDir(): string {
  return path.join(os.homedir(), '.carry-on', 'repo');
}
