import * as fs from 'fs';
import * as path from 'path';
import { getCopilotCliConfigPath } from '../utils/paths.js';
import type { McpServerConfig, McpServersMap } from './types.js';

interface CopilotCliConfig {
  servers?: Record<string, McpServerConfig>;
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export function readCopilotCliMcpServers(): McpServersMap {
  const configPath = getCopilotCliConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const config: CopilotCliConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.servers ?? config.mcpServers ?? {};
  } catch {
    console.warn(`[mcpocket] Could not read Copilot CLI MCP config at ${configPath}`);
    return {};
  }
}

export function writeCopilotCliMcpServers(servers: McpServersMap): void {
  const configPath = getCopilotCliConfigPath();
  const dir = path.dirname(configPath);

  let config: CopilotCliConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn(`[mcpocket] Could not parse existing Copilot CLI MCP config, will overwrite servers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  const key = config.mcpServers && !config.servers ? 'mcpServers' : 'servers';
  const existing = config[key] ?? {};
  config[key] = { ...existing, ...normalizeCopilotServers(servers) };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getConfigPath(): string {
  return getCopilotCliConfigPath();
}

function normalizeCopilotServers(servers: McpServersMap): McpServersMap {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      if (server.url) {
        return [name, { ...server, type: server.type ?? 'http' }];
      }

      if (server.command) {
        return [name, { ...server, type: server.type ?? 'stdio' }];
      }

      return [name, server];
    })
  );
}