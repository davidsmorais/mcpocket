import * as fs from 'fs';
import * as path from 'path';
import { getCursorConfigPath } from '../utils/paths.js';
import type { ClaudeDesktopConfig, McpServersMap } from './types.js';

export function readCursorMcpServers(): McpServersMap {
  const configPath = getCursorConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const config: ClaudeDesktopConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.mcpServers ?? {};
  } catch {
    console.warn(`[mcpocket] Could not read Cursor MCP config at ${configPath}`);
    return {};
  }
}

export function writeCursorMcpServers(servers: McpServersMap): void {
  const configPath = getCursorConfigPath();
  const dir = path.dirname(configPath);

  let config: ClaudeDesktopConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn(`[mcpocket] Could not parse existing Cursor MCP config, will overwrite mcpServers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  config.mcpServers = { ...(config.mcpServers ?? {}), ...servers };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getConfigPath(): string {
  return getCursorConfigPath();
}