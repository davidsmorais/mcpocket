import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';

export type Tool = 'claude' | 'copilot' | 'opencode' | 'gemini';
export type Category =
  | 'settings'
  | 'agents'
  | 'skills'
  | 'plugins'
  | 'extensions'
  | 'mcps'
  | 'files';

export type Scope = { kind: 'global' } | { kind: 'project'; name: string };

export interface ManifestEntry {
  /** Stable id: tool/category/scope/relPath */
  id: string;
  tool: Tool;
  category: Category;
  scope: Scope;
  /** "~/..."-normalized origin path on the source machine */
  sourcePath: string;
  /** Forward-slash relative path within the pocket root */
  pocketPath: string;
  contentHash?: string;
}

export interface Manifest {
  version: 2;
  generatedAt: string;
  generatedFrom: { os: NodeJS.Platform; hostname: string };
  entries: ManifestEntry[];
}

export const MANIFEST_FILENAME = 'mcpocket.manifest.json';

export function emptyManifest(): Manifest {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    generatedFrom: { os: process.platform, hostname: os.hostname() },
    entries: [],
  };
}

export function readManifest(pocketDir: string): Manifest | null {
  const file = path.join(pocketDir, MANIFEST_FILENAME);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.version === 2 && Array.isArray(raw.entries)) {
      return raw as Manifest;
    }
  } catch {
    // fall through
  }
  return null;
}

export function writeManifest(pocketDir: string, manifest: Manifest): void {
  fs.mkdirSync(pocketDir, { recursive: true });
  fs.writeFileSync(
    path.join(pocketDir, MANIFEST_FILENAME),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

export function hashFile(absPath: string): string | undefined {
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return undefined;
  }
}

export function entryId(tool: Tool, category: Category, scope: Scope, relPath: string): string {
  const scopeStr = scope.kind === 'global' ? 'global' : `project:${scope.name}`;
  return `${tool}/${category}/${scopeStr}/${relPath}`;
}

export function scopeLabel(scope: Scope): string {
  return scope.kind === 'global' ? 'GLOBAL' : `project:${scope.name}`;
}
