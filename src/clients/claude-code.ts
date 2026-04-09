import * as fs from 'fs';
import * as path from 'path';
import { getClaudeCodeSettingsPath } from '../utils/paths.js';
import type { ClaudeCodeSettings, McpServersMap } from './types.js';

export function readClaudeCodeSettings(): ClaudeCodeSettings {
  const settingsPath = getClaudeCodeSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    console.warn(`[mcpocket] Could not read Claude Code settings at ${settingsPath}`);
    return {};
  }
}

export function readClaudeCodeMcpServers(): McpServersMap {
  return readClaudeCodeSettings().mcpServers ?? {};
}

export function writeClaudeCodeMcpServers(servers: McpServersMap): void {
  const settingsPath = getClaudeCodeSettingsPath();
  const dir = path.dirname(settingsPath);

  let settings: ClaudeCodeSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      console.warn(`[mcpocket] Could not parse existing Claude Code settings, will overwrite mcpServers only`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  settings.mcpServers = { ...(settings.mcpServers ?? {}), ...servers };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

export function getSettingsPath(): string {
  return getClaudeCodeSettingsPath();
}
