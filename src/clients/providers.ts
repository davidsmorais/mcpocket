import type { ProviderDefinition } from './types.js';
import { readClaudeDesktopMcpServers, writeClaudeDesktopMcpServers, getConfigPath as getClaudeDesktopPath } from './claude-desktop.js';
import { readClaudeCodeMcpServers, writeClaudeCodeMcpServers, getSettingsPath as getClaudeCodePath } from './claude-code.js';
import { readOpenCodeMcpServers, writeOpenCodeMcpServers, getConfigPath as getOpenCodePath } from './opencode.js';
import { readCopilotCliMcpServers, writeCopilotCliMcpServers, getConfigPath as getCopilotCliPath } from './copilot-cli.js';
import { readCursorMcpServers, writeCursorMcpServers, getConfigPath as getCursorPath } from './cursor.js';
import { readCodexMcpServers, writeCodexMcpServers, getConfigPath as getCodexPath } from './codex.js';
import { readGeminiCliMcpServers, writeGeminiCliMcpServers, getConfigPath as getGeminiCliPath } from './gemini-cli.js';

export const ALL_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'claude-desktop',
    displayName: 'Claude Desktop',
    optionName: 'claudeDesktop',
    syncsClaudeHomeAssets: false,
    getConfigPath: getClaudeDesktopPath,
    readMcpServers: readClaudeDesktopMcpServers,
    writeMcpServers: writeClaudeDesktopMcpServers,
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    optionName: 'claudeCode',
    syncsClaudeHomeAssets: true,
    getConfigPath: getClaudeCodePath,
    readMcpServers: readClaudeCodeMcpServers,
    writeMcpServers: writeClaudeCodeMcpServers,
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    optionName: 'opencode',
    syncsClaudeHomeAssets: false,
    getConfigPath: getOpenCodePath,
    readMcpServers: readOpenCodeMcpServers,
    writeMcpServers: writeOpenCodeMcpServers,
  },
  {
    id: 'copilot-cli',
    displayName: 'Copilot CLI',
    optionName: 'copilotCli',
    syncsClaudeHomeAssets: false,
    getConfigPath: getCopilotCliPath,
    readMcpServers: readCopilotCliMcpServers,
    writeMcpServers: writeCopilotCliMcpServers,
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    optionName: 'cursor',
    syncsClaudeHomeAssets: false,
    getConfigPath: getCursorPath,
    readMcpServers: readCursorMcpServers,
    writeMcpServers: writeCursorMcpServers,
  },
  {
    id: 'codex',
    displayName: 'Codex',
    optionName: 'codex',
    syncsClaudeHomeAssets: false,
    getConfigPath: getCodexPath,
    readMcpServers: readCodexMcpServers,
    writeMcpServers: writeCodexMcpServers,
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    optionName: 'geminiCli',
    syncsClaudeHomeAssets: false,
    getConfigPath: getGeminiCliPath,
    readMcpServers: readGeminiCliMcpServers,
    writeMcpServers: writeGeminiCliMcpServers,
  },
];

export const PROVIDER_OPTION_FLAGS = ALL_PROVIDERS.map((provider) => ({
  flag: `--${provider.id}`,
  description: `Sync only ${provider.displayName} MCP config`,
}));
