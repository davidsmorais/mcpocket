import * as fs from 'node:fs';
import * as path from 'node:path';
import * as TOML from '@iarna/toml';
import { getCodexConfigPath } from '../utils/paths.js';
import type { McpServersMap } from './types.js';

interface CodexConfig {
  mcp_servers?: McpServersMap;
  [key: string]: unknown;
}

export function readCodexMcpServers(): McpServersMap {
  const configPath = getCodexConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const config = TOML.parse(fs.readFileSync(configPath, 'utf8')) as unknown as CodexConfig;
    return config.mcp_servers ?? {};
  } catch {
    console.warn(`[mcpocket] Could not read Codex config at ${configPath}`);
    return {};
  }
}

export function writeCodexMcpServers(servers: McpServersMap): void {
  const configPath = getCodexConfigPath();
  const dir = path.dirname(configPath);

  let config: CodexConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = TOML.parse(fs.readFileSync(configPath, 'utf8')) as unknown as CodexConfig;
    } catch {
      console.warn(`[mcpocket] Could not parse existing Codex config, will overwrite mcp_servers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  config.mcp_servers = servers;
  fs.writeFileSync(configPath, TOML.stringify(config as TOML.JsonMap), 'utf8');
}

export function getConfigPath(): string {
  return getCodexConfigPath();
}