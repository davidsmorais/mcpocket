import * as fs from 'fs';
import * as path from 'path';
import { getClaudeHomeDir } from '../utils/paths.js';

const SKILLS_DIR = 'skills';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '__pycache__']);
const SKIP_PREFIXES = ['.'];

function shouldSkip(name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  for (const prefix of SKIP_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

/** Copy skills/ from ~/.claude/skills/ to repo/skills/ (excluding node_modules) */
export function writeSkillsToRepo(repoDir: string): number {
  const source = path.join(getClaudeHomeDir(), SKILLS_DIR);
  const dest = path.join(repoDir, SKILLS_DIR);

  if (!fs.existsSync(source)) {
    return 0;
  }

  return copyDirCounted(source, dest);
}

/** Copy skills/ from repo/skills/ to ~/.claude/skills/ (overwrite, excluding node_modules) */
export function applySkillsFromRepo(repoDir: string): number {
  const source = path.join(repoDir, SKILLS_DIR);
  const dest = path.join(getClaudeHomeDir(), SKILLS_DIR);

  if (!fs.existsSync(source)) {
    return 0;
  }

  return copyDirCounted(source, dest);
}

function copyDirCounted(src: string, dest: string): number {
  let count = 0;
  copyDir(src, dest, () => { count++; });
  return count;
}

function copyDir(src: string, dest: string, onFile: () => void): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, onFile);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      onFile();
    }
  }
}
