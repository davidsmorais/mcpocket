export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface McpServersMap {
  [serverName: string]: McpServerConfig;
}

/** Subset of claude_desktop_config.json we care about */
export interface ClaudeDesktopConfig {
  mcpServers?: McpServersMap;
  [key: string]: unknown;
}

/** Subset of ~/.claude/settings.json we care about */
export interface ClaudeCodeSettings {
  mcpServers?: McpServersMap;
  enabledPlugins?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

/** Subset of opencode config.json */
export interface OpenCodeConfig {
  mcp?: {
    servers?: McpServersMap;
  };
  [key: string]: unknown;
}
