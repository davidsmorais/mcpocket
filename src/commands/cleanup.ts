import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir } from '../config.js';
import type { McpocketConfig } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir, collectFilesFromDir, updateGist } from '../storage/gist.js';
import { listPocketMcpServerNames } from '../sync/mcp.js';
import { ask, askMultiSelect } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, c } from '../utils/sparkle.js';

export interface CleanupOptions {
  local?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

// ── Pocket item model ─────────────────────────────────────────────────────────

type PocketItemKind = 'agent' | 'skill' | 'mcp' | 'other';

interface PocketItem {
  kind: PocketItemKind;
  name: string;
  /** Raw pocket-relative file paths covered by this item. Empty for 'mcp' (handled separately). */
  files: string[];
}

interface DeletionResult {
  filesDeleted: number;
  mcpServersRemoved: number;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cleanupCommand(options: CleanupOptions = {}): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  section('Cleanup');

  if (options.local) {
    await localCleanup(config, repoDir, options);
  } else {
    await remoteCleanup(config, repoDir, options);
  }
}

// ── Remote cleanup ────────────────────────────────────────────────────────────

async function remoteCleanup(
  config: McpocketConfig,
  repoDir: string,
  options: CleanupOptions,
): Promise<void> {
  // 1. Pull pocket from remote
  sparkle('Pulling pocket from remote…');
  await pullPocketToLocal(config, repoDir);

  // 2. Build logical item list
  const pocketFiles = listPocketFiles(repoDir);
  if (pocketFiles.length === 0) {
    sparkle('No pocket files found. Nothing to clean up.');
    return;
  }

  const items = buildPocketItems(repoDir, pocketFiles);

  // 3. Interactive selection — choose which items to KEEP
  const toKeep = await askMultiSelect<PocketItem>(
    'Which pocket items would you like to keep?',
    items.map((item) => ({ label: formatItemLabel(item), value: item })),
  );

  const toDelete = items.filter((item) => !toKeep.includes(item));

  if (toDelete.length === 0) {
    sparkle('Nothing to delete — all items kept!');
    return;
  }

  // 4. Preview
  printItemsToDelete(toDelete);

  // 5. Confirm
  if (!options.yes && !options.dryRun) {
    const answer = await ask(
      `\n  ${c.yellow('⚠')}  Delete ${toDelete.length} item(s) from pocket? ${c.dim('(y/N)')} `,
    );
    if (!isYes(answer)) {
      sparkle('Cleanup cancelled.');
      return;
    }
  }

  if (options.dryRun) {
    heads_up(`[dry-run] Would delete ${toDelete.length} item(s) from pocket.`);
    heads_up('[dry-run] No files were changed and nothing was pushed.');
    return;
  }

  // 6. Delete
  deletePocketItemFiles(repoDir, toDelete);
  removeEmptyDirs(repoDir);

  // 7. Push updated pocket back to remote
  sparkle('Pushing updated pocket to remote…');
  await pushPocketToRemote(config, repoDir);

  // 8. Summary
  celebrate('Pocket cleaned up!');
  section('Summary');
  stat('Items kept', toKeep.length);
  stat('Items deleted', toDelete.length);
  console.log('');
}

// ── Local cleanup ─────────────────────────────────────────────────────────────

async function localCleanup(
  config: McpocketConfig,
  repoDir: string,
  options: CleanupOptions,
): Promise<void> {
  const pocketFiles = listPocketFiles(repoDir);
  if (pocketFiles.length === 0) {
    sparkle('No local pocket files found. Nothing to clean up.');
    return;
  }

  const hasInclude = config.cleanupInclude && config.cleanupInclude.length > 0;
  const hasExclude = config.cleanupExclude && config.cleanupExclude.length > 0;
  const hasPatterns = hasInclude || hasExclude;

  let toDeleteItems: PocketItem[];

  if (hasPatterns) {
    // Pattern-based filtering (whitelist / blacklist from mcpocket.json) — file level
    section('Pattern-based filtering');
    if (hasInclude) {
      sparkle(`Include patterns: ${config.cleanupInclude!.join(', ')}`);
    }
    if (hasExclude) {
      sparkle(`Exclude patterns: ${config.cleanupExclude!.join(', ')}`);
    }

    const toKeepFiles = computeFilesToKeep(pocketFiles, config.cleanupInclude, config.cleanupExclude);
    const toDeleteFiles = pocketFiles.filter((f) => !toKeepFiles.includes(f));
    // Represent pattern-matched files as 'other' items for consistent deletion
    toDeleteItems = toDeleteFiles.map((f) => ({ kind: 'other' as PocketItemKind, name: f, files: [f] }));
  } else {
    // No patterns configured — interactive item-based selection
    const items = buildPocketItems(repoDir, pocketFiles);
    const toKeepItems = await askMultiSelect<PocketItem>(
      'Which local pocket items would you like to keep?',
      items.map((item) => ({ label: formatItemLabel(item), value: item })),
    );
    toDeleteItems = items.filter((item) => !toKeepItems.includes(item));
  }

  if (toDeleteItems.length === 0) {
    sparkle('Nothing to delete — all items kept!');
    return;
  }

  // Preview
  printItemsToDelete(toDeleteItems);

  // Confirm
  if (!options.yes && !options.dryRun) {
    const answer = await ask(
      `\n  ${c.yellow('⚠')}  Delete ${toDeleteItems.length} local pocket item(s)? ${c.dim('(y/N)')} `,
    );
    if (!isYes(answer)) {
      sparkle('Cleanup cancelled.');
      return;
    }
  }

  if (options.dryRun) {
    heads_up(`[dry-run] Would delete ${toDeleteItems.length} local pocket item(s).`);
    heads_up('[dry-run] No files were changed.');
    return;
  }

  const { filesDeleted, mcpServersRemoved } = deletePocketItemFiles(repoDir, toDeleteItems);
  removeEmptyDirs(repoDir);

  celebrate('Local pocket cleaned up!');
  section('Summary');
  stat('Files deleted', filesDeleted);
  if (mcpServersRemoved > 0) {
    stat('MCP servers removed', mcpServersRemoved);
  }
  console.log('');
}

// ── Pocket item helpers ───────────────────────────────────────────────────────

/**
 * Build a list of logical pocket items from raw file paths.
 *
 * - agents/foo.md           → { kind: 'agent', name: 'foo' }
 * - skills/my-skill/...     → { kind: 'skill', name: 'my-skill' } (all files grouped)
 * - mcp-config.json         → one { kind: 'mcp' } item per server key (read without decrypting)
 * - everything else         → { kind: 'other', name: <rel-path> }
 */
export function buildPocketItems(repoDir: string, allFiles: string[]): PocketItem[] {
  const items: PocketItem[] = [];

  // Expand mcp-config.json into individual MCP server items
  let mcpHandled = false;
  if (allFiles.includes('mcp-config.json')) {
    const mcpNames = listPocketMcpServerNames(repoDir);
    if (mcpNames.length > 0) {
      mcpHandled = true;
      for (const name of mcpNames) {
        items.push({ kind: 'mcp', name, files: [] });
      }
    }
  }

  // Group agents and skills; pass everything else through as 'other'
  const agentsByName = new Map<string, string[]>();
  const skillsByName = new Map<string, string[]>();

  for (const f of allFiles) {
    if (f.startsWith('agents/')) {
      const name = path.basename(f, '.md');
      if (!agentsByName.has(name)) agentsByName.set(name, []);
      agentsByName.get(name)!.push(f);
    } else if (f.startsWith('skills/')) {
      const parts = f.split('/');
      const topLevel = parts[1];
      if (topLevel) {
        if (!skillsByName.has(topLevel)) skillsByName.set(topLevel, []);
        skillsByName.get(topLevel)!.push(f);
      }
    } else if (f === 'mcp-config.json' && mcpHandled) {
      // Already expanded above — skip raw file entry
    } else {
      items.push({ kind: 'other', name: f, files: [f] });
    }
  }

  for (const [name, files] of agentsByName) {
    items.push({ kind: 'agent', name, files });
  }
  for (const [name, files] of skillsByName) {
    items.push({ kind: 'skill', name, files });
  }

  // Sort: agents → skills → MCPs → other; alphabetical within each group
  const kindOrder: Record<PocketItemKind, number> = { agent: 0, skill: 1, mcp: 2, other: 3 };
  items.sort((a, b) => {
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.name.localeCompare(b.name);
  });

  return items;
}

/**
 * Surgically remove specific MCP servers from mcp-config.json.
 * Deletes the file entirely when all servers are removed.
 * Returns the number of servers removed.
 */
function removeMcpServersFromPocket(repoDir: string, serverNames: string[]): number {
  const configPath = path.join(repoDir, 'mcp-config.json');
  if (!fs.existsSync(configPath) || serverNames.length === 0) return 0;

  let parsed: { version?: number; mcpServers?: Record<string, unknown> };
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return 0;
  }

  const servers = parsed.mcpServers ?? {};
  for (const name of serverNames) {
    delete servers[name];
  }

  if (Object.keys(servers).length === 0) {
    fs.rmSync(configPath);
  } else {
    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf8');
  }

  return serverNames.length;
}

/**
 * Delete the files/servers represented by the given items.
 * MCP items are handled by rewriting mcp-config.json rather than deleting it wholesale.
 */
function deletePocketItemFiles(repoDir: string, items: PocketItem[]): DeletionResult {
  const filesToDelete: string[] = [];
  const mcpNamesToRemove: string[] = [];

  for (const item of items) {
    if (item.kind === 'mcp') {
      mcpNamesToRemove.push(item.name);
    } else {
      filesToDelete.push(...item.files);
    }
  }

  const filesDeleted = deleteFiles(repoDir, filesToDelete);
  const mcpServersRemoved =
    mcpNamesToRemove.length > 0 ? removeMcpServersFromPocket(repoDir, mcpNamesToRemove) : 0;

  return { filesDeleted, mcpServersRemoved };
}

const KIND_LABEL: Record<PocketItemKind, string> = {
  agent: '[agent]',
  skill: '[skill]',
  mcp:   '[mcp]  ',
  other: '[other]',
};

function formatItemLabel(item: PocketItem): string {
  return `${KIND_LABEL[item.kind]}  ${item.name}`;
}

function printItemsToDelete(items: PocketItem[]): void {
  section('Items to be removed');
  for (const item of items) {
    console.log(`    ${c.red('✗')} ${formatItemLabel(item)}`);
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

/** Pull the remote pocket into the local staging directory. */
async function pullPocketToLocal(config: McpocketConfig, repoDir: string): Promise<void> {
  if (config.storageType === 'gist') {
    try {
      const { files: gistFiles, truncated } = await fetchGist(config.githubToken, config.gistId!);
      fs.mkdirSync(repoDir, { recursive: true });
      writeGistFilesToDir(repoDir, gistFiles);
      if (truncated) {
        heads_up(
          'Your gist has more than 300 files — GitHub only returns the first 300 via its API.\n' +
          '  Some files may not be synced. Consider switching to repo storage.',
        );
      }
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
    return;
  }

  try {
    pullRepo(repoDir, config.githubToken, config.repoCloneUrl!);
    ensureGitConfig(repoDir);
  } catch (err) {
    oops((err as Error).message);
    process.exit(1);
  }
}

/** Push the local staging directory back to the remote pocket. */
async function pushPocketToRemote(config: McpocketConfig, repoDir: string): Promise<void> {
  if (config.storageType === 'gist') {
    try {
      const files = collectFilesFromDir(repoDir);
      await updateGist(config.githubToken, config.gistId!, files);
    } catch (err) {
      oops(`Gist push failed: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  ensureGitConfig(repoDir);
  try {
    commitAndPush(repoDir, config.githubToken, config.repoCloneUrl!, 'mcpocket: cleanup');
  } catch (err) {
    oops(`Push failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

// ── File utilities ────────────────────────────────────────────────────────────

/**
 * Return all files inside the pocket staging directory as forward-slash
 * relative paths, excluding the `.git` directory.
 */
export function listPocketFiles(repoDir: string): string[] {
  if (!fs.existsSync(repoDir)) {
    return [];
  }
  const results: string[] = [];
  collectFiles(repoDir, '', results);
  return results.sort();
}

function collectFiles(dir: string, prefix: string, results: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, relPath, results);
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
}

/**
 * Determine which files from `allFiles` should be kept after applying
 * include (whitelist) and exclude (blacklist) glob patterns.
 *
 * Rules:
 *  1. If `include` patterns are provided, only files matching at least one
 *     include pattern are candidates.
 *  2. If `exclude` patterns are provided, any remaining candidate that also
 *     matches an exclude pattern is removed.
 *  3. When both sets are provided the effective set is (include ∩ ¬exclude).
 */
export function computeFilesToKeep(
  allFiles: string[],
  include?: string[],
  exclude?: string[],
): string[] {
  let result = allFiles;

  if (include && include.length > 0) {
    result = result.filter((f) => include.some((p) => matchesGlob(f, p)));
  }

  if (exclude && exclude.length > 0) {
    result = result.filter((f) => !exclude.some((p) => matchesGlob(f, p)));
  }

  return result;
}

/**
 * Match a forward-slash relative file path against a simple glob pattern.
 *
 * Supported syntax:
 *   `*`       — any sequence of characters within a single path segment
 *   `**`      — any sequence of characters across path segments
 *   `dir/`    — matches all files inside `dir/` (shorthand for `dir/**`)
 *   Literal characters otherwise.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedFile = filePath.replace(/\\/g, '/');
  let normalizedPattern = pattern.replace(/\\/g, '/');

  // A trailing '/' means "any file inside this directory"
  if (normalizedPattern.endsWith('/')) {
    normalizedPattern += '**';
  }

  // A pattern with no '/' and no '**' is matched against the basename as well
  const isBasenamePattern =
    !normalizedPattern.includes('/') && !normalizedPattern.includes('**');

  if (isBasenamePattern) {
    // Try matching the full relative path AND just the basename
    const basename = normalizedFile.split('/').pop() ?? normalizedFile;
    return (
      globToRegex(normalizedPattern).test(normalizedFile) ||
      globToRegex(normalizedPattern).test(basename)
    );
  }

  return globToRegex(normalizedPattern).test(normalizedFile);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    // Escape all regex special chars except * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Replace ** with a placeholder, then * with segment matcher
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function deleteFiles(repoDir: string, relPaths: string[]): number {
  let deleted = 0;
  for (const relPath of relPaths) {
    const fullPath = path.resolve(path.join(repoDir, relPath));
    // Safety: must stay within pocket root
    if (!isWithinDir(repoDir, fullPath)) {
      oops(`Refusing to delete file outside pocket root: ${relPath}`);
      continue;
    }
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true });
      deleted++;
    }
  }
  return deleted;
}

function removeEmptyDirs(dir: string, isRoot = true): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    removeEmptyDirs(fullPath, false);
    if (!isRoot && fs.existsSync(fullPath) && fs.readdirSync(fullPath).length === 0) {
      fs.rmdirSync(fullPath);
    }
  }
}

function isWithinDir(dir: string, filePath: string): boolean {
  const resolvedDir = path.resolve(dir);
  const resolvedFile = path.resolve(filePath);
  return (
    resolvedFile === resolvedDir ||
    resolvedFile.startsWith(resolvedDir + path.sep)
  );
}

function isYes(answer: string): boolean {
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}
