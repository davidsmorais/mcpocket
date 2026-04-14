import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir } from '../config.js';
import type { McpocketConfig } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir, collectFilesFromDir, updateGist } from '../storage/gist.js';
import { ask, askMultiSelect } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, c } from '../utils/sparkle.js';

export interface CleanupOptions {
  local?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

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

  // 2. List pocket files
  const pocketFiles = listPocketFiles(repoDir);
  if (pocketFiles.length === 0) {
    sparkle('No pocket files found. Nothing to clean up.');
    return;
  }

  // 3. Interactive selection — choose which files to KEEP
  const toKeep = await askMultiSelect<string>(
    'Which pocket files would you like to keep?',
    pocketFiles.map((f) => ({ label: f, value: f })),
  );

  const toDelete = pocketFiles.filter((f) => !toKeep.includes(f));

  if (toDelete.length === 0) {
    sparkle('Nothing to delete — all files kept!');
    return;
  }

  // 4. Preview
  printFilesToDelete(toDelete);

  // 5. Confirm
  if (!options.yes && !options.dryRun) {
    const answer = await ask(
      `\n  ${c.yellow('⚠')}  Delete ${toDelete.length} file(s) from pocket? ${c.dim('(y/N)')} `,
    );
    if (!isYes(answer)) {
      sparkle('Cleanup cancelled.');
      return;
    }
  }

  if (options.dryRun) {
    heads_up(`[dry-run] Would delete ${toDelete.length} file(s) from pocket.`);
    heads_up('[dry-run] No files were changed and nothing was pushed.');
    return;
  }

  // 6. Delete
  const deleted = deleteFiles(repoDir, toDelete);
  removeEmptyDirs(repoDir);

  // 7. Push updated pocket back to remote
  sparkle('Pushing updated pocket to remote…');
  await pushPocketToRemote(config, repoDir);

  // 8. Summary
  celebrate('Pocket cleaned up!');
  section('Summary');
  stat('Files kept', toKeep.length);
  stat('Files deleted', deleted);
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

  let toDelete: string[];

  if (hasPatterns) {
    // Pattern-based filtering (whitelist / blacklist from mcpocket.json)
    section('Pattern-based filtering');
    if (hasInclude) {
      sparkle(`Include patterns: ${config.cleanupInclude!.join(', ')}`);
    }
    if (hasExclude) {
      sparkle(`Exclude patterns: ${config.cleanupExclude!.join(', ')}`);
    }

    const toKeep = computeFilesToKeep(pocketFiles, config.cleanupInclude, config.cleanupExclude);
    toDelete = pocketFiles.filter((f) => !toKeep.includes(f));
  } else {
    // No patterns configured — fall back to interactive selection
    const toKeep = await askMultiSelect<string>(
      'Which local pocket files would you like to keep?',
      pocketFiles.map((f) => ({ label: f, value: f })),
    );
    toDelete = pocketFiles.filter((f) => !toKeep.includes(f));
  }

  if (toDelete.length === 0) {
    sparkle('Nothing to delete — all files kept!');
    return;
  }

  // Preview
  printFilesToDelete(toDelete);

  // Confirm
  if (!options.yes && !options.dryRun) {
    const answer = await ask(
      `\n  ${c.yellow('⚠')}  Delete ${toDelete.length} local pocket file(s)? ${c.dim('(y/N)')} `,
    );
    if (!isYes(answer)) {
      sparkle('Cleanup cancelled.');
      return;
    }
  }

  if (options.dryRun) {
    heads_up(`[dry-run] Would delete ${toDelete.length} local pocket file(s).`);
    heads_up('[dry-run] No files were changed.');
    return;
  }

  const deleted = deleteFiles(repoDir, toDelete);
  removeEmptyDirs(repoDir);

  celebrate('Local pocket cleaned up!');
  section('Summary');
  stat('Files kept', pocketFiles.length - deleted);
  stat('Files deleted', deleted);
  console.log('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function printFilesToDelete(files: string[]): void {
  section('Files to be removed');
  for (const f of files) {
    console.log(`    ${c.red('✗')} ${f}`);
  }
}

function isYes(answer: string): boolean {
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}
