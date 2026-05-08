import * as fs from 'node:fs';
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
  normalizePath,
} from '../utils/paths.js';
import type { Tool, Category, Scope } from './manifest.js';
import { entryId } from './manifest.js';

export interface InventoryItem {
  id: string;
  tool: Tool;
  category: Category;
  scope: Scope;
  /** Display label (e.g. file name or skill name) */
  name: string;
  /** Absolute path on local disk */
  sourceAbs: string;
  /** "~/..."-normalized source */
  sourcePath: string;
  /** Forward-slash relative path within the pocket root */
  pocketPath: string;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '__pycache__']);
const SKIP_PREFIXES = ['.'];

function shouldSkipDir(name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  for (const p of SKIP_PREFIXES) if (name.startsWith(p)) return true;
  return false;
}

function walk(dir: string, relPrefix = ''): Array<{ rel: string; abs: string }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ rel: string; abs: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      out.push(...walk(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      if (entry.name.startsWith('.')) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      out.push({ rel, abs: path.join(dir, entry.name) });
    }
  }
  return out;
}

interface SourceSpec {
  tool: Tool;
  category: Category;
  /** Either a single file or a directory */
  abs: string;
  /** When true, abs is a directory; otherwise it's a single file */
  isDir: boolean;
  /** Required file extension filter (used for agents which are .md only) */
  ext?: string;
  /** Pocket subdirectory under category root, e.g. 'claude-code' for agents */
  providerSubdir?: string;
}

function globalSources(): SourceSpec[] {
  const claudeHome = getClaudeHomeDir();
  return [
    // Claude
    { tool: 'claude', category: 'settings', abs: getClaudeCodeSettingsPath(), isDir: false },
    { tool: 'claude', category: 'agents', abs: path.join(claudeHome, 'agents'), isDir: true, ext: '.md', providerSubdir: 'claude-code' },
    { tool: 'claude', category: 'skills', abs: path.join(claudeHome, 'skills'), isDir: true, providerSubdir: 'claude-code' },
    { tool: 'claude', category: 'plugins', abs: path.join(claudeHome, 'plugins', 'config.json'), isDir: false },
    // The actual plugin manifest files referenced by readPluginManifests
    { tool: 'claude', category: 'plugins', abs: path.join(claudeHome, 'plugins', 'installed_plugins.json'), isDir: false },
    { tool: 'claude', category: 'plugins', abs: path.join(claudeHome, 'plugins', 'blocklist.json'), isDir: false },
    { tool: 'claude', category: 'plugins', abs: path.join(claudeHome, 'plugins', 'known_marketplaces.json'), isDir: false },

    // Copilot
    { tool: 'copilot', category: 'agents', abs: getCopilotAgentsDir(), isDir: true, ext: '.md', providerSubdir: 'copilot-cli' },
    { tool: 'copilot', category: 'settings', abs: path.join(getCopilotHomeDir(), 'instructions.md'), isDir: false },

    // Gemini
    { tool: 'gemini', category: 'agents', abs: getGeminiAgentsDir(), isDir: true, ext: '.md', providerSubdir: 'gemini-cli' },
    { tool: 'gemini', category: 'skills', abs: getGeminiSkillsDir(), isDir: true, providerSubdir: 'gemini-cli' },
    { tool: 'gemini', category: 'settings', abs: path.join(getGeminiHomeDir(), 'GEMINI.md'), isDir: false },
    { tool: 'gemini', category: 'settings', abs: path.join(getGeminiHomeDir(), 'settings.json'), isDir: false },

    // OpenCode
    { tool: 'opencode', category: 'agents', abs: path.join(getOpenCodeHomeDir(), 'agents'), isDir: true, ext: '.md' },
    { tool: 'opencode', category: 'extensions', abs: path.join(getOpenCodeHomeDir(), 'extensions'), isDir: true },
  ];
}

function buildItems(spec: SourceSpec, scope: Scope, pocketRootForCategory: (cat: Category, providerSubdir?: string) => string): InventoryItem[] {
  const items: InventoryItem[] = [];
  if (spec.isDir) {
    if (!fs.existsSync(spec.abs)) return [];
    for (const f of walk(spec.abs)) {
      if (spec.ext && !f.rel.endsWith(spec.ext)) continue;
      const pocketBase = pocketRootForCategory(spec.category, spec.providerSubdir);
      const pocketPath = `${pocketBase}/${f.rel}`;
      items.push({
        id: entryId(spec.tool, spec.category, scope, f.rel),
        tool: spec.tool,
        category: spec.category,
        scope,
        name: f.rel,
        sourceAbs: f.abs,
        sourcePath: normalizePath(f.abs),
        pocketPath,
      });
    }
  } else {
    if (!fs.existsSync(spec.abs)) return [];
    const fileName = path.basename(spec.abs);
    const pocketBase = pocketRootForCategory(spec.category, spec.providerSubdir);
    const pocketPath = `${pocketBase}/${fileName}`;
    items.push({
      id: entryId(spec.tool, spec.category, scope, fileName),
      tool: spec.tool,
      category: spec.category,
      scope,
      name: fileName,
      sourceAbs: spec.abs,
      sourcePath: normalizePath(spec.abs),
      pocketPath,
    });
  }
  return items;
}

/** Pocket layout for global items. Preserves legacy paths where they exist. */
function globalPocketBase(category: Category, providerSubdir?: string): string {
  switch (category) {
    case 'agents':
      return providerSubdir ? `agents/${providerSubdir}` : 'agents';
    case 'skills':
      return providerSubdir ? `skills/${providerSubdir}` : 'skills';
    case 'plugins':
      return 'plugins';
    case 'settings':
      // settings live in their own tree, namespaced by tool
      return 'settings';
    case 'extensions':
      return 'extensions';
    case 'files':
      return 'files';
    case 'mcps':
      return 'mcps';
  }
}

function projectPocketBase(projectName: string, category: Category): string {
  return `projects/${projectName}/${category}`;
}

export function discoverGlobalInventory(): InventoryItem[] {
  const scope: Scope = { kind: 'global' };
  const items: InventoryItem[] = [];
  for (const spec of globalSources()) {
    // For settings: prefix the pocket path with the tool to avoid collisions
    const baseFn = spec.category === 'settings' || spec.category === 'extensions'
      ? (cat: Category) => `${globalPocketBase(cat)}/${spec.tool}`
      : globalPocketBase;
    items.push(...buildItems(spec, scope, baseFn));
  }
  // De-duplicate by id (some specs may overlap, e.g. plugin manifests)
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

interface ProjectSourceSpec {
  tool: Tool;
  category: Category;
  /** Path relative to project root */
  rel: string;
  isDir: boolean;
  ext?: string;
}

function projectSources(): ProjectSourceSpec[] {
  return [
    { tool: 'claude', category: 'files', rel: 'CLAUDE.md', isDir: false },
    { tool: 'copilot', category: 'files', rel: 'AGENTS.md', isDir: false },
    { tool: 'copilot', category: 'files', rel: 'COPILOT.md', isDir: false },
    { tool: 'gemini', category: 'files', rel: 'GEMINI.md', isDir: false },
    { tool: 'copilot', category: 'files', rel: 'mcp.json', isDir: false },
    { tool: 'copilot', category: 'files', rel: 'mcp-config.json', isDir: false },
    { tool: 'copilot', category: 'files', rel: '.vscode/mcp.json', isDir: false },
    { tool: 'copilot', category: 'files', rel: '.cursor/mcp.json', isDir: false },
    { tool: 'claude', category: 'settings', rel: '.claude/settings.json', isDir: false },
    { tool: 'claude', category: 'agents', rel: '.claude/agents', isDir: true, ext: '.md' },
    { tool: 'claude', category: 'skills', rel: '.claude/skills', isDir: true },
    { tool: 'copilot', category: 'agents', rel: '.copilot/agents', isDir: true, ext: '.md' },
    { tool: 'copilot', category: 'settings', rel: '.github/copilot-instructions.md', isDir: false },
    { tool: 'opencode', category: 'agents', rel: '.opencode/agents', isDir: true, ext: '.md' },
    { tool: 'opencode', category: 'extensions', rel: '.opencode/extensions', isDir: true },
    { tool: 'gemini', category: 'agents', rel: '.gemini/agents', isDir: true, ext: '.md' },
    { tool: 'gemini', category: 'skills', rel: '.gemini/skills', isDir: true },
  ];
}

export function discoverProjectInventory(cwd: string, projectName: string): InventoryItem[] {
  const scope: Scope = { kind: 'project', name: projectName };
  const items: InventoryItem[] = [];

  for (const spec of projectSources()) {
    const abs = path.join(cwd, spec.rel);
    if (spec.isDir) {
      if (!fs.existsSync(abs)) continue;
      for (const f of walk(abs)) {
        if (spec.ext && !f.rel.endsWith(spec.ext)) continue;
        const subRel = `${spec.rel}/${f.rel}`;
        const pocketPath = `${projectPocketBase(projectName, spec.category)}/${spec.tool}/${f.rel}`;
        items.push({
          id: entryId(spec.tool, spec.category, scope, subRel),
          tool: spec.tool,
          category: spec.category,
          scope,
          name: subRel,
          sourceAbs: f.abs,
          sourcePath: normalizePath(f.abs),
          pocketPath,
        });
      }
    } else {
      if (!fs.existsSync(abs)) continue;
      const fileName = path.basename(spec.rel);
      const pocketPath = `${projectPocketBase(projectName, spec.category)}/${spec.tool}/${fileName}`;
      items.push({
        id: entryId(spec.tool, spec.category, scope, spec.rel),
        tool: spec.tool,
        category: spec.category,
        scope,
        name: spec.rel,
        sourceAbs: abs,
        sourcePath: normalizePath(abs),
        pocketPath,
      });
    }
  }
  return items;
}
