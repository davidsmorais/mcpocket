import * as os from 'os';
import * as path from 'path';

const HOME = os.homedir();

/**
 * Normalize an absolute path to a portable format:
 * - Replace home dir with ~
 * - Normalize to forward slashes
 * - Normalize npx.cmd → npx (Windows command wrappers)
 */
export function normalizePath(p: string): string {
  // Replace home directory prefix with ~
  let normalized = p;
  if (normalized.startsWith(HOME)) {
    normalized = '~' + normalized.slice(HOME.length);
  }
  // Normalize backslashes to forward slashes
  normalized = normalized.replace(/\\/g, '/');
  return normalized;
}

/**
 * Expand a portable path back to an absolute platform path:
 * - Expand ~ to home dir
 * - Normalize slashes for current platform
 */
export function expandPath(p: string): string {
  let expanded = p;
  if (expanded.startsWith('~/') || expanded === '~') {
    expanded = HOME + expanded.slice(1);
  }
  // On Windows, normalize to backslashes
  if (process.platform === 'win32') {
    expanded = expanded.replace(/\//g, '\\');
  }
  return expanded;
}

/**
 * Normalize a command name: strip .cmd / .exe extensions added on Windows
 * e.g. npx.cmd → npx
 */
export function normalizeCommand(cmd: string): string {
  return cmd.replace(/\.(cmd|exe|bat)$/i, '');
}

/**
 * Expand a command for the current platform.
 * On Windows, node-based commands may need .cmd wrapper.
 * We leave commands as-is and let PATH resolution handle it.
 */
export function expandCommand(cmd: string): string {
  return cmd;
}

/**
 * Normalize an array of args — replace any absolute paths inside args
 */
export function normalizeArgs(args: string[]): string[] {
  return args.map(arg => {
    // If the arg looks like an absolute path (starts with / or X:\), normalize it
    if (/^[a-zA-Z]:[\\\/]/.test(arg) || arg.startsWith('/')) {
      return normalizePath(arg);
    }
    return arg;
  });
}

/**
 * Expand args back to platform paths
 */
export function expandArgs(args: string[]): string[] {
  return args.map(arg => {
    if (arg.startsWith('~')) {
      return expandPath(arg);
    }
    return arg;
  });
}

/**
 * Get the Claude Desktop config path for the current platform
 */
export function getClaudeDesktopConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] || path.join(HOME, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  // Linux
  return path.join(HOME, '.config', 'Claude', 'claude_desktop_config.json');
}

/**
 * Get the Claude Code settings path
 */
export function getClaudeCodeSettingsPath(): string {
  return path.join(HOME, '.claude', 'settings.json');
}

/**
 * Get the Claude home directory
 */
export function getClaudeHomeDir(): string {
  return path.join(HOME, '.claude');
}

/**
 * Get the OpenCode config path
 */
export function getOpenCodeConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] || path.join(HOME, 'AppData', 'Roaming');
    return path.join(appData, 'opencode', 'config.json');
  }
  return path.join(HOME, '.config', 'opencode', 'config.json');
}

/**
 * Get the mcpocket config directory
 */
export function getMcpocketConfigDir(): string {
  return path.join(HOME, '.mcpocket');
}

/**
 * Get the mcpocket config file path
 */
export function getMcpocketConfigPath(): string {
  return path.join(getMcpocketConfigDir(), 'config.json');
}
