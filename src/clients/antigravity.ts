import * as fs from 'fs';
import * as path from 'path';
import { getAntigravityConfigPath } from '../utils/paths.js';
import type { McpServerConfig, McpServersMap } from './types.js';

interface AntigravityMcpConfig {
  mcpServers?: Record<string, McpServerConfig & { serverUrl?: string }>;
  [key: string]: unknown;
}

export function readAntigravityMcpServers(): McpServersMap {
  const configPath = getAntigravityConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const config: AntigravityMcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const servers = config.mcpServers ?? {};
    return Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [name, fromAntigravityServer(server)])
    );
  } catch {
    console.warn(`[mcpocket] Could not read Antigravity MCP config at ${configPath}`);
    return {};
  }
}

export function writeAntigravityMcpServers(servers: McpServersMap): void {
  const configPath = getAntigravityConfigPath();
  const dir = path.dirname(configPath);

  let config: AntigravityMcpConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.warn(`[mcpocket] Could not parse existing Antigravity config, will overwrite mcpServers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = config.mcpServers ?? {};
  const mappedServers = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, toAntigravityServer(server)])
  );

  config.mcpServers = { ...existing, ...mappedServers };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getConfigPath(): string {
  return getAntigravityConfigPath();
}

function fromAntigravityServer(server: McpServerConfig & { serverUrl?: string }): McpServerConfig {
  if (!server.serverUrl) {
    return server;
  }

  const { serverUrl, ...rest } = server;
  return { ...rest, url: serverUrl };
}

function toAntigravityServer(server: McpServerConfig): McpServerConfig & { serverUrl?: string } {
  if (!server.url) {
    return server;
  }

  const { url, ...rest } = server;
  return { ...rest, serverUrl: url };
}