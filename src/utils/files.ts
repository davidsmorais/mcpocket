import * as fs from 'fs';
import * as path from 'path';

export interface MirrorStats {
  synced: number;
  removed: number;
}

interface MirrorOptions {
  includeFile?: (relPath: string) => boolean;
  includeDirectory?: (relPath: string) => boolean;
}

interface FileMapOptions {
  protectedTopLevelNames?: ReadonlySet<string>;
}

export function mirrorDirectory(
  sourceDir: string,
  destDir: string,
  options: MirrorOptions = {},
): MirrorStats {
  const includeFile = options.includeFile ?? (() => true);
  const includeDirectory = options.includeDirectory ?? (() => true);

  const sourceFiles = new Map<string, string>();
  collectSourceFiles(sourceDir, '', sourceFiles, includeFile, includeDirectory);

  fs.mkdirSync(destDir, { recursive: true });

  let synced = 0;
  for (const [relPath, fullPath] of sourceFiles) {
    const destPath = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(fullPath, destPath);
    synced++;
  }

  const destFiles = listFiles(destDir);
  let removed = 0;
  for (const relPath of destFiles) {
    if (!includeFile(relPath)) {
      continue;
    }
    if (!sourceFiles.has(relPath)) {
      fs.rmSync(path.join(destDir, relPath), { force: true });
      removed++;
    }
  }

  removeEmptyDirs(destDir);

  return { synced, removed };
}

export function mirrorFileMapToDir(
  dir: string,
  files: Record<string, string>,
  options: FileMapOptions = {},
): MirrorStats {
  fs.mkdirSync(dir, { recursive: true });

  const normalizedFiles = new Map<string, string>();
  for (const [relPath, content] of Object.entries(files)) {
    const normalized = normalizeRelPath(relPath);
    normalizedFiles.set(normalized, content);
  }

  let synced = 0;
  for (const [relPath, content] of normalizedFiles) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    synced++;
  }

  const protectedTopLevelNames = options.protectedTopLevelNames ?? new Set<string>();
  let removed = 0;
  for (const relPath of listFiles(dir)) {
    if (protectedTopLevelNames.has(firstPathSegment(relPath))) {
      continue;
    }
    if (!normalizedFiles.has(normalizeRelPath(relPath))) {
      fs.rmSync(path.join(dir, relPath), { force: true });
      removed++;
    }
  }

  removeEmptyDirs(dir, protectedTopLevelNames);

  return { synced, removed };
}

export function pruneDirectoryTopLevel(
  dir: string,
  keepNames: ReadonlySet<string>,
): number {
  if (!fs.existsSync(dir)) {
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (keepNames.has(entry.name)) {
      continue;
    }
    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

function collectSourceFiles(
  dir: string,
  prefix: string,
  files: Map<string, string>,
  includeFile: (relPath: string) => boolean,
  includeDirectory: (relPath: string) => boolean,
): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? path.join(prefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (!includeDirectory(relPath)) {
        continue;
      }
      collectSourceFiles(path.join(dir, entry.name), relPath, files, includeFile, includeDirectory);
      continue;
    }

    if (entry.isFile() && includeFile(relPath)) {
      files.set(normalizeRelPath(relPath), path.join(dir, entry.name));
    }
  }
}

function listFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      files.push(normalizeRelPath(relPath));
    }
  }
  return files;
}

function removeEmptyDirs(
  dir: string,
  protectedTopLevelNames: ReadonlySet<string> = new Set<string>(),
  isRoot = true,
): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    removeEmptyDirs(fullPath, protectedTopLevelNames, false);

    if (isRoot && protectedTopLevelNames.has(entry.name)) {
      continue;
    }

    if (fs.existsSync(fullPath) && fs.readdirSync(fullPath).length === 0) {
      fs.rmdirSync(fullPath);
    }
  }
}

function firstPathSegment(relPath: string): string {
  return normalizeRelPath(relPath).split('/')[0] ?? relPath;
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}