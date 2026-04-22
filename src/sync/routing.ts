/**
 * Per-file routing data model for pull --route mode.
 *
 * When pulling from a gist, each file can be assigned a destination along
 * three dimensions: project, provider, and tool type.
 */

/** Tool types that a gist file can be routed as */
export type ToolType = 'agent' | 'skill' | 'plugin' | 'mcp' | 'project';

/** Provider IDs that files can be routed to */
export type RoutingProvider =
  | 'claude-code'
  | 'claude-desktop'
  | 'opencode'
  | 'copilot-cli'
  | 'cursor'
  | 'codex'
  | 'gemini-cli';

/** Routing destination for a single gist file */
export interface RoutingEntry {
  /** The gist key (e.g., "agents__claude-code__foo.md") */
  gistKey: string;
  /** Display name derived from the gist key (e.g., "foo.md" or "my-skill/SKILL.md") */
  displayName: string;
  /** Tool type: what kind of file this is */
  tool: ToolType;
  /** Provider this file belongs to (undefined for plugins, mcp, project files) */
  provider?: RoutingProvider;
  /** Project this file belongs to (undefined for non-project files) */
  project?: string;
}

/** Map of gist key → routing entry */
export type FileRoutingMap = Record<string, RoutingEntry>;

/** Known provider subdirectory names used in gist keys */
export const PROVIDER_SUBDIRS = ['claude-code', 'copilot-cli', 'gemini-cli'] as const;

/** Detect tool type from gist key pattern */
export function detectToolType(gistKey: string): ToolType {
  if (gistKey === 'mcp-config.json') return 'mcp';
  if (gistKey.startsWith('agents__')) return 'agent';
  if (gistKey.startsWith('skills__')) return 'skill';
  if (gistKey.startsWith('plugins__')) return 'plugin';
  // Check for project files: "projectName__..." where projectName is not a known top-level dir
  const firstSegment = gistKey.split('__')[0];
  if (!['agents', 'skills', 'plugins', 'mcp-config.json'].includes(firstSegment)) {
    return 'project';
  }
  return 'project'; // fallback
}

/** Extract provider from gist key (e.g., "agents__claude-code__foo.md" → "claude-code") */
export function detectProvider(gistKey: string): RoutingProvider | undefined {
  const parts = gistKey.split('__');
  // agents__claude-code__foo.md → parts[1] = "claude-code"
  // skills__gemini-cli__my-skill__SKILL.md → parts[1] = "gemini-cli"
  if (parts.length >= 2 && PROVIDER_SUBDIRS.includes(parts[1] as typeof PROVIDER_SUBDIRS[number])) {
    return parts[1] as RoutingProvider;
  }
  return undefined;
}

/** Extract project name from gist key (e.g., "myproj__CLAUDE.md" → "myproj") */
export function detectProject(gistKey: string): string | undefined {
  const tool = detectToolType(gistKey);
  if (tool !== 'project') return undefined;
  return gistKey.split('__')[0];
}

/** Derive display name from gist key */
export function deriveDisplayName(gistKey: string): string {
  const parts = gistKey.split('__');
  const tool = detectToolType(gistKey);

  switch (tool) {
    case 'mcp':
      return 'mcp-config.json';
    case 'agent':
      // agents__claude-code__foo.md → foo.md
      // agents__claude-code__nested__bar.md → nested/bar.md
      return parts.slice(2).join('/');
    case 'skill':
      // skills__claude-code__my-skill__SKILL.md → my-skill/SKILL.md
      return parts.slice(2).join('/');
    case 'plugin':
      // plugins__installed_plugins.json → installed_plugins.json
      return parts.slice(1).join('/');
    case 'project':
      // myproj__CLAUDE.md → CLAUDE.md
      // myproj__subdir__file.md → subdir/file.md
      return parts.slice(1).join('/');
    default:
      return gistKey;
  }
}

/** Build a routing map from raw gist files with pattern-based defaults */
export function buildRoutingMap(gistFiles: Record<string, string>): FileRoutingMap {
  const map: FileRoutingMap = {};

  for (const [gistKey] of Object.entries(gistFiles)) {
    const tool = detectToolType(gistKey);
    map[gistKey] = {
      gistKey,
      displayName: deriveDisplayName(gistKey),
      tool,
      provider: detectProvider(gistKey),
      project: detectProject(gistKey),
    };
  }

  return map;
}
