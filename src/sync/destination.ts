import * as path from 'node:path';
import {
  getClaudeHomeDir,
  getClaudeCodeSettingsPath,
  getCopilotHomeDir,
  getCopilotAgentsDir,
  getGeminiHomeDir,
  getGeminiAgentsDir,
  getGeminiSkillsDir,
  getOpenCodeHomeDir,
  expandPath,
} from '../utils/paths.js';
import type { ManifestEntry, Tool, Category, Scope } from './manifest.js';

export interface ResolvedDestination {
  /** Absolute filesystem path where the file should land */
  absPath: string;
  /** Human-readable label for display */
  label: string;
  /** What kind of destination this is */
  kind: 'global' | 'project' | 'custom';
}

export interface DestinationContext {
  /** Override scope: 'project' forces all items to current cwd; 'global' forces all to home */
  forceScope?: 'project' | 'global';
  /** Working directory used when resolving project destinations */
  cwd: string;
}

function globalAgentsDirFor(tool: Tool): string {
  switch (tool) {
    case 'claude': return path.join(getClaudeHomeDir(), 'agents');
    case 'copilot': return getCopilotAgentsDir();
    case 'gemini': return getGeminiAgentsDir();
    case 'opencode': return path.join(getOpenCodeHomeDir(), 'agents');
  }
}

function globalSkillsDirFor(tool: Tool): string {
  switch (tool) {
    case 'claude': return path.join(getClaudeHomeDir(), 'skills');
    case 'gemini': return getGeminiSkillsDir();
    case 'copilot':
    case 'opencode':
      // No native skills dir; fall back to claude conventions
      return path.join(getClaudeHomeDir(), 'skills');
  }
}

function projectDirFor(cwd: string, tool: Tool, category: Category): string {
  if (category === 'files') return cwd;
  switch (tool) {
    case 'claude': return path.join(cwd, '.claude', categoryDirName(category));
    case 'copilot':
      if (category === 'settings') return path.join(cwd, '.github');
      return path.join(cwd, '.copilot', categoryDirName(category));
    case 'opencode': return path.join(cwd, '.opencode', categoryDirName(category));
    case 'gemini': return path.join(cwd, '.gemini', categoryDirName(category));
  }
}

function categoryDirName(category: Category): string {
  switch (category) {
    case 'agents': return 'agents';
    case 'skills': return 'skills';
    case 'plugins': return 'plugins';
    case 'extensions': return 'extensions';
    case 'settings': return 'settings';
    case 'files': return '';
    case 'mcps': return 'mcps';
  }
}

/** Split off the category root prefix from a pocket path so we can rebase to a new dir. */
function relWithinCategory(entry: ManifestEntry): string {
  // pocket paths look like:
  //   agents/claude-code/foo.md           → foo.md
  //   skills/gemini-cli/my-skill/SKILL.md → my-skill/SKILL.md
  //   settings/claude/settings.json       → settings.json
  //   plugins/installed_plugins.json      → installed_plugins.json
  //   projects/<name>/agents/claude/foo.md → foo.md
  const parts = entry.pocketPath.split('/');
  if (entry.scope.kind === 'project') {
    // projects/<name>/<category>/<tool>/<rel...>
    return parts.slice(4).join('/') || parts.slice(-1).join('/');
  }
  // Global: <category>/[providerSubdir|tool]/<rel...> OR <category>/<rel...>
  // Drop category + first subdir if it's a provider/tool name we recognize
  const first = parts[0];
  const second = parts[1];
  const knownSubdirs = new Set(['claude', 'copilot', 'opencode', 'gemini', 'claude-code', 'copilot-cli', 'gemini-cli']);
  if (knownSubdirs.has(second)) {
    return parts.slice(2).join('/');
  }
  // category/<rel...> (e.g. plugins/installed_plugins.json)
  return parts.slice(1).join('/');
}

/** Compute the proposed destination for a manifest entry given the context. */
export function proposeDestination(
  entry: ManifestEntry,
  ctx: DestinationContext,
): ResolvedDestination {
  const scope: Scope = ctx.forceScope === 'project'
    ? { kind: 'project', name: path.basename(ctx.cwd) }
    : ctx.forceScope === 'global'
      ? { kind: 'global' }
      : entry.scope;

  const rel = relWithinCategory(entry);

  if (scope.kind === 'project') {
    const baseDir = projectDirFor(ctx.cwd, entry.tool, entry.category);
    const abs = rel ? path.join(baseDir, rel) : baseDir;
    return { absPath: abs, label: `project (${path.basename(ctx.cwd)}) → ${baseDir}`, kind: 'project' };
  }

  // global
  switch (entry.category) {
    case 'agents': {
      const dir = globalAgentsDirFor(entry.tool);
      return { absPath: path.join(dir, rel), label: `global → ${dir}`, kind: 'global' };
    }
    case 'skills': {
      const dir = globalSkillsDirFor(entry.tool);
      return { absPath: path.join(dir, rel), label: `global → ${dir}`, kind: 'global' };
    }
    case 'plugins': {
      const dir = path.join(getClaudeHomeDir(), 'plugins');
      return { absPath: path.join(dir, rel), label: `global → ${dir}`, kind: 'global' };
    }
    case 'settings': {
      // Settings are single files; pick the canonical location per tool
      let abs: string;
      switch (entry.tool) {
        case 'claude': abs = getClaudeCodeSettingsPath(); break;
        case 'copilot': abs = path.join(getCopilotHomeDir(), 'instructions.md'); break;
        case 'gemini':
          abs = rel === 'GEMINI.md'
            ? path.join(getGeminiHomeDir(), 'GEMINI.md')
            : path.join(getGeminiHomeDir(), 'settings.json');
          break;
        case 'opencode': abs = path.join(getOpenCodeHomeDir(), 'config.json'); break;
      }
      return { absPath: abs, label: `global → ${abs}`, kind: 'global' };
    }
    case 'extensions': {
      const dir = path.join(getOpenCodeHomeDir(), 'extensions');
      return { absPath: path.join(dir, rel), label: `global → ${dir}`, kind: 'global' };
    }
    case 'files': {
      // Project-only; if forced global, drop in HOME
      const abs = path.join(expandPath('~'), rel);
      return { absPath: abs, label: `global → ${abs}`, kind: 'global' };
    }
    case 'mcps':
      return { absPath: '', label: 'mcps (handled separately)', kind: 'global' };
  }
}

/** Alternative destinations the user can switch between for an entry. */
export function availableOverrides(
  entry: ManifestEntry,
  ctx: DestinationContext,
): ResolvedDestination[] {
  const opts: ResolvedDestination[] = [];
  opts.push(proposeDestination(entry, { ...ctx, forceScope: 'global' }));
  opts.push(proposeDestination(entry, { ...ctx, forceScope: 'project' }));
  return opts;
}
