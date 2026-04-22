import * as fs from 'fs';
import * as path from 'path';
import { getGeminiCliSettingsPath } from '../utils/paths.js';
import type { McpServerConfig, McpServersMap } from './types.js';

interface GeminiCliSettings {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export function readGeminiCliMcpServers(): McpServersMap {
  const configPath = getGeminiCliSettingsPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const settings: GeminiCliSettings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return settings.mcpServers ?? {};
  } catch (err) {
    console.warn(`[mcpocket] Could not read Gemini CLI settings at ${configPath}: ${(err as Error).message}`);
    return {};
  }
}

export function writeGeminiCliMcpServers(servers: McpServersMap): void {
  const configPath = getGeminiCliSettingsPath();
  const dir = path.dirname(configPath);

  let settings: GeminiCliSettings = {};
  if (fs.existsSync(configPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.warn(`[mcpocket] Could not parse existing Gemini CLI settings (${(err as Error).message}), will overwrite mcpServers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = settings.mcpServers ?? {};
  settings.mcpServers = { ...existing, ...servers };
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf8');
}

export function getConfigPath(): string {
  return getGeminiCliSettingsPath();
}
