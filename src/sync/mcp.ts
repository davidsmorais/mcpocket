import * as path from 'path';
import { encryptEnv, decryptEnv } from '../utils/crypto.js';
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
  return {
    ...server,
    command: normalizeCommand(server.command),
    args: server.args ? normalizeArgs(server.args) : undefined,
  };
}

/**
 * Expand a single MCP server config from portable to platform-native.
 */
export function expandServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    command: expandCommand(server.command),
    args: server.args ? expandArgs(server.args) : undefined,
  };
}

/**
 * Normalize all servers and encrypt their env vars.
 */
export function packMcpServers(servers: McpServersMap, passphrase: string): McpServersMap {
  const packed: McpServersMap = {};
  for (const [name, server] of Object.entries(servers)) {
    const normalized = normalizeServer(server);
    if (normalized.env && Object.keys(normalized.env).length > 0) {
      const { encrypted } = encryptEnv(normalized.env, passphrase);
      packed[name] = { ...normalized, env: encrypted };
    } else {
      packed[name] = normalized;
    }
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
    if (expanded.env && Object.keys(expanded.env).length > 0) {
      unpacked[name] = { ...expanded, env: decryptEnv(expanded.env, passphrase) };
    } else {
      unpacked[name] = expanded;
    }
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
