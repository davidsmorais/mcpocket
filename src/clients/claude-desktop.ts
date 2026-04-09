import * as fs from 'fs';
import * as path from 'path';
import { getClaudeDesktopConfigPath } from '../utils/paths.js';
import type { ClaudeDesktopConfig, McpServersMap } from './types.js';

export function readClaudeDesktopMcpServers(): McpServersMap {
  const configPath = getClaudeDesktopConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config: ClaudeDesktopConfig = JSON.parse(raw);
    return config.mcpServers ?? {};
  } catch {
    console.warn(`[carry-on] Could not read Claude Desktop config at ${configPath}`);
    return {};
  }
}

export function writeClaudeDesktopMcpServers(servers: McpServersMap): void {
  const configPath = getClaudeDesktopConfigPath();
  const dir = path.dirname(configPath);

  let config: ClaudeDesktopConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn(`[carry-on] Could not parse existing Claude Desktop config, will overwrite mcpServers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  config.mcpServers = { ...(config.mcpServers ?? {}), ...servers };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getConfigPath(): string {
  return getClaudeDesktopConfigPath();
}
