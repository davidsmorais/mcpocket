import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Manifest, ManifestEntry, Tool, Category, Scope } from './manifest.js';
import { emptyManifest, entryId } from './manifest.js';

/**
 * Walk an existing pocket directory (one without mcpocket.manifest.json) and
 * synthesize a manifest by mapping the legacy directory layout to tool/category/scope.
 *
 * Legacy layout this understands:
 *   agents/<provider-id>/<rel>      → tool=<provider>, category=agents, scope=global
 *   skills/<provider-id>/<rel>      → tool=<provider>, category=skills, scope=global
 *   plugins/<file>                  → tool=claude, category=plugins, scope=global
 *   settings/<tool>/<file>          → tool=<tool>, category=settings, scope=global
 *   extensions/<tool>/<rel>         → tool=<tool>, category=extensions, scope=global
 *   projects/<name>/<cat>/<tool>/<rel> → scope=project:<name>
 *   <projectName>/<rel>             → scope=project:<projectName>, category=files (older convention)
 *   mcp-config.json                 → handled separately
 */
export function synthesizeManifestFromLegacyPocket(pocketDir: string): Manifest {
  const manifest = emptyManifest();
  if (!fs.existsSync(pocketDir)) return manifest;

  const entries: ManifestEntry[] = [];
  for (const f of walkAll(pocketDir)) {
    if (f.rel === 'mcp-config.json') continue;
    if (f.rel === 'mcpocket.manifest.json') continue;
    if (f.rel.startsWith('.git/')) continue;

    const mapped = mapLegacyPath(f.rel);
    if (!mapped) continue;

    entries.push({
      id: entryId(mapped.tool, mapped.category, mapped.scope, mapped.relPath),
      tool: mapped.tool,
      category: mapped.category,
      scope: mapped.scope,
      sourcePath: '~/(unknown)',
      pocketPath: f.rel,
    });
  }

  manifest.entries = entries;
  return manifest;
}

interface MappedPath {
  tool: Tool;
  category: Category;
  scope: Scope;
  relPath: string;
}

const PROVIDER_TO_TOOL: Record<string, Tool> = {
  'claude-code': 'claude',
  'claude-desktop': 'claude',
  'copilot-cli': 'copilot',
  'gemini-cli': 'gemini',
  claude: 'claude',
  copilot: 'copilot',
  gemini: 'gemini',
  opencode: 'opencode',
};

function mapLegacyPath(rel: string): MappedPath | null {
  const parts = rel.split('/');
  if (parts.length === 0) return null;

  const head = parts[0];

  if (head === 'agents' || head === 'skills') {
    const category: Category = head === 'agents' ? 'agents' : 'skills';
    const second = parts[1];
    const tool = PROVIDER_TO_TOOL[second];
    if (tool) {
      return { tool, category, scope: { kind: 'global' }, relPath: parts.slice(2).join('/') };
    }
    // Flat layout (no provider subdir): assume claude
    return { tool: 'claude', category, scope: { kind: 'global' }, relPath: parts.slice(1).join('/') };
  }

  if (head === 'plugins') {
    return { tool: 'claude', category: 'plugins', scope: { kind: 'global' }, relPath: parts.slice(1).join('/') };
  }

  if (head === 'settings') {
    const tool = PROVIDER_TO_TOOL[parts[1]] || 'claude';
    return { tool, category: 'settings', scope: { kind: 'global' }, relPath: parts.slice(2).join('/') };
  }

  if (head === 'extensions') {
    const tool = PROVIDER_TO_TOOL[parts[1]] || 'opencode';
    return { tool, category: 'extensions', scope: { kind: 'global' }, relPath: parts.slice(2).join('/') };
  }

  if (head === 'projects' && parts.length >= 4) {
    const name = parts[1];
    const cat = parts[2] as Category;
    const tool = PROVIDER_TO_TOOL[parts[3]] || 'claude';
    return { tool, category: cat, scope: { kind: 'project', name }, relPath: parts.slice(4).join('/') };
  }

  // Older convention: top-level <projectName>/<file>
  // Treat anything we don't recognize as a project file under that top-level name.
  if (parts.length >= 2) {
    return {
      tool: 'claude',
      category: 'files',
      scope: { kind: 'project', name: head },
      relPath: parts.slice(1).join('/'),
    };
  }

  return null;
}

function walkAll(dir: string, prefix = ''): Array<{ rel: string }> {
  const out: Array<{ rel: string }> = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkAll(abs, rel));
    else if (e.isFile()) out.push({ rel });
  }
  return out;
}
