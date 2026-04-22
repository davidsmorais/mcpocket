export interface McpServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  bearer_token_env_var?: string;
  enabled?: boolean;
  required?: boolean;
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
  enabled_tools?: string[];
  disabled_tools?: string[];
  scopes?: string[];
  oauth_resource?: string;
  tools?: Record<string, unknown>;
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

/** Subset of opencode config.json — schema uses `mcpServers` at top level */
export interface OpenCodeConfig {
  mcpServers?: McpServersMap;
  [key: string]: unknown;
}

export type ProviderId =
  | 'claude-desktop'
  | 'claude-code'
  | 'opencode'
  | 'copilot-cli'
  | 'cursor'
  | 'codex'
  | 'gemini-cli';

export interface ProviderDefinition {
  id: ProviderId;
  displayName: string;
  optionName: string;
  syncsClaudeHomeAssets: boolean;
  getConfigPath(): string;
  readMcpServers(): McpServersMap;
  writeMcpServers(servers: McpServersMap): void;
}
