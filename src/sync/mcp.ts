import * as path from 'path';
import { encryptStringMap, decryptStringMap } from '../utils/crypto.js';
import { normalizePath, expandPath, normalizeCommand, expandCommand, normalizeArgs, expandArgs } from '../utils/paths.js';
import type { McpServersMap, McpServerConfig } from '../clients/types.js';

export interface PortableMcpConfig {
  version: 1;
  mcpServers: McpServersMap;
}

/**
 * Read MCP servers from multiple sources and merge them.
 * Later sources win on conflict.
 */
export function mergeMcpSources(...sources: McpServersMap[]): McpServersMap {
  return Object.assign({}, ...sources);
}

/**
 * Additive merge: add remote servers to local without overwriting existing local ones.
 */
export function additiveMerge(local: McpServersMap, remote: McpServersMap): McpServersMap {
  const result: McpServersMap = { ...local };
  for (const [name, config] of Object.entries(remote)) {
    if (!(name in result)) {
      result[name] = config;
    }
  }
  return result;
}

/**
 * Normalize a single MCP server config for portable storage.
 * - Normalizes command (strips .cmd/.exe)
 * - Normalizes paths in args
 */
export function normalizeServer(server: McpServerConfig): McpServerConfig {
  const normalizedCwd =
    typeof server.cwd === 'string' && isAbsolutePath(server.cwd)
      ? normalizePath(server.cwd)
      : server.cwd;

  return {
    ...server,
    command: server.command ? normalizeCommand(server.command) : undefined,
    args: server.args ? normalizeArgs(server.args) : undefined,
    cwd: normalizedCwd,
  };
}

/**
 * Expand a single MCP server config from portable to platform-native.
 */
export function expandServer(server: McpServerConfig): McpServerConfig {
  const expandedCwd =
    typeof server.cwd === 'string' && server.cwd.startsWith('~')
      ? expandPath(server.cwd)
      : server.cwd;

  return {
    ...server,
    command: server.command ? expandCommand(server.command) : undefined,
    args: server.args ? expandArgs(server.args) : undefined,
    cwd: expandedCwd,
  };
}

/**
 * Normalize all servers and encrypt their env vars.
 */
export function packMcpServers(servers: McpServersMap, passphrase: string): McpServersMap {
  const packed: McpServersMap = {};
  for (const [name, server] of Object.entries(servers)) {
    const normalized = normalizeServer(server);
    let encryptedServer: McpServerConfig = normalized;

    if (normalized.env && Object.keys(normalized.env).length > 0) {
      const { encrypted } = encryptStringMap(normalized.env, passphrase);
      encryptedServer = { ...encryptedServer, env: encrypted };
    }

    if (isStringMap(normalized.headers) && Object.keys(normalized.headers).length > 0) {
      const { encrypted } = encryptStringMap(normalized.headers, passphrase);
      encryptedServer = { ...encryptedServer, headers: encrypted };
    }

    if (isStringMap(normalized.http_headers) && Object.keys(normalized.http_headers).length > 0) {
      const { encrypted } = encryptStringMap(normalized.http_headers, passphrase);
      encryptedServer = { ...encryptedServer, http_headers: encrypted };
    }

    packed[name] = encryptedServer;
  }
  return packed;
}

/**
 * Expand all servers and decrypt their env vars.
 */
export function unpackMcpServers(servers: McpServersMap, passphrase: string): McpServersMap {
  const unpacked: McpServersMap = {};
  for (const [name, server] of Object.entries(servers)) {
    const expanded = expandServer(server);

    let decryptedServer: McpServerConfig = expanded;

    if (expanded.env && Object.keys(expanded.env).length > 0) {
      decryptedServer = { ...decryptedServer, env: decryptStringMap(expanded.env, passphrase) };
    }

    if (isStringMap(expanded.headers) && Object.keys(expanded.headers).length > 0) {
      decryptedServer = { ...decryptedServer, headers: decryptStringMap(expanded.headers, passphrase) };
    }

    if (isStringMap(expanded.http_headers) && Object.keys(expanded.http_headers).length > 0) {
      decryptedServer = {
        ...decryptedServer,
        http_headers: decryptStringMap(expanded.http_headers, passphrase),
      };
    }

    unpacked[name] = decryptedServer;
  }
  return unpacked;
}

/**
 * Build the portable mcp-config.json content.
 */
export function buildPortableConfig(servers: McpServersMap, passphrase: string): PortableMcpConfig {
  return {
    version: 1,
    mcpServers: packMcpServers(servers, passphrase),
  };
}

/**
 * Restore MCP servers from portable config.
 */
export function restoreFromPortableConfig(config: PortableMcpConfig, passphrase: string): McpServersMap {
  return unpackMcpServers(config.mcpServers, passphrase);
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || path.isAbsolute(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}
