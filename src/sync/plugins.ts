import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir } from '../utils/paths.js';

export interface InstalledPlugin {
  name: string;
  version?: string;
  source?: string;
  [key: string]: unknown;
}

export interface InstalledPluginsManifest {
  [key: string]: unknown;
}

const PLUGIN_FILES = [
  'plugins/installed_plugins.json',
  'plugins/blocklist.json',
  'plugins/known_marketplaces.json',
];

/** Read all plugin manifest files from ~/.claude/ */
export function readPluginManifests(): Record<string, unknown> {
  const claudeHome = getClaudeHomeDir();
  const manifests: Record<string, unknown> = {};

  for (const relPath of PLUGIN_FILES) {
    const fullPath = path.join(claudeHome, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        manifests[relPath] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch {
        console.warn(`[mcpocket] Could not read ${fullPath}`);
      }
    }
  }

  return manifests;
}

/** Write plugin manifest files into a repo directory */
export function writePluginManifestsToRepo(manifests: Record<string, unknown>, repoDir: string): void {
  for (const [relPath, content] of Object.entries(manifests)) {
    const fullPath = path.join(repoDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(content, null, 2), 'utf8');
  }
}

/** Read plugin manifests from repo directory */
export function readPluginManifestsFromRepo(repoDir: string): Record<string, unknown> {
  const manifests: Record<string, unknown> = {};
  for (const relPath of PLUGIN_FILES) {
    const fullPath = path.join(repoDir, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        manifests[relPath] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch {
        console.warn(`[mcpocket] Could not read repo file ${fullPath}`);
      }
    }
  }
  return manifests;
}

/** Apply plugin manifests from repo to ~/.claude/ (additive for installed_plugins, overwrite for others) */
export function applyPluginManifests(manifests: Record<string, unknown>): string[] {
  const claudeHome = getClaudeHomeDir();
  const updated: string[] = [];

  for (const [relPath, content] of Object.entries(manifests)) {
    const fullPath = path.join(claudeHome, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    if (relPath === 'plugins/installed_plugins.json' && fs.existsSync(fullPath)) {
      // Additive merge for installed plugins
      try {
        const existing = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
        const remote = content as Record<string, unknown>;
        const merged = { ...existing };
        let added = 0;
        for (const [key, val] of Object.entries(remote)) {
          if (!(key in merged)) {
            merged[key] = val;
            added++;
          }
        }
        if (added > 0) {
          fs.writeFileSync(fullPath, JSON.stringify(merged, null, 2), 'utf8');
          updated.push(relPath);
        }
      } catch {
        fs.writeFileSync(fullPath, JSON.stringify(content, null, 2), 'utf8');
        updated.push(relPath);
      }
    } else {
      fs.writeFileSync(fullPath, JSON.stringify(content, null, 2), 'utf8');
      updated.push(relPath);
    }
  }

  return updated;
}
