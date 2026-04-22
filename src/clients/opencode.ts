import * as fs from 'fs';
import * as path from 'path';
import { getOpenCodeConfigPath } from '../utils/paths.js';
import type { OpenCodeConfig, McpServersMap } from './types.js';

export function readOpenCodeMcpServers(): McpServersMap {
  const configPath = getOpenCodeConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const config: OpenCodeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.mcpServers ?? {};
  } catch {
    console.warn(`[mcpocket] Could not read OpenCode config at ${configPath}`);
    return {};
  }
}

export function writeOpenCodeMcpServers(servers: McpServersMap): void {
  const configPath = getOpenCodeConfigPath();
  const dir = path.dirname(configPath);

  let config: OpenCodeConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn(`[mcpocket] Could not parse existing OpenCode config, will overwrite mcpServers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  config.mcpServers = { ...(config.mcpServers ?? {}), ...servers };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getConfigPath(): string {
  return getOpenCodeConfigPath();
}
