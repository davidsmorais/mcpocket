import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir } from '../utils/paths.js';

const AGENTS_DIR = 'agents';

/** Copy agents/ from ~/.claude/agents/ to repo/agents/ */
export function writeAgentsToRepo(repoDir: string): number {
  const source = path.join(getClaudeHomeDir(), AGENTS_DIR);
  const dest = path.join(repoDir, AGENTS_DIR);

  if (!fs.existsSync(source)) {
    return 0;
  }

  let count = 0;
  copyDir(source, dest, (relPath) => {
    // Only sync .md files from agents
    if (relPath.endsWith('.md')) {
      count++;
      return true;
    }
    // Skip .git, node_modules, CI dirs
    const base = path.basename(relPath);
    return !base.startsWith('.') && base !== 'node_modules';
  });

  return count;
}

/** Copy agents/ from repo/agents/ to ~/.claude/agents/ (overwrite) */
export function applyAgentsFromRepo(repoDir: string): number {
  const source = path.join(repoDir, AGENTS_DIR);
  const dest = path.join(getClaudeHomeDir(), AGENTS_DIR);

  if (!fs.existsSync(source)) {
    return 0;
  }

  let count = 0;
  copyDir(source, dest, (relPath) => {
    if (relPath.endsWith('.md')) {
      count++;
      return true;
    }
    const base = path.basename(relPath);
    return !base.startsWith('.') && base !== 'node_modules';
  });

  return count;
}

function copyDir(src: string, dest: string, filter: (relPath: string) => boolean): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (!filter(entry.name)) continue;

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
