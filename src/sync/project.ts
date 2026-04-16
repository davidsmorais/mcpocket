import * as fs from 'node:fs';
import * as path from 'node:path';

export const PROJECT_CONFIG_FILENAME = 'mcpocket.json';

export interface ProjectConfig {
  projectName: string;
  files: string[];  // relative paths from CWD, e.g. ["CLAUDE.md", ".cursorrules"]
}

export function projectConfigExists(): boolean {
  return fs.existsSync(path.join(process.cwd(), PROJECT_CONFIG_FILENAME));
}

export function readProjectConfig(): ProjectConfig {
  const configPath = path.join(process.cwd(), PROJECT_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    throw new Error('No project config found. Run `mcpocket init --project` first.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProjectConfig;
}

export function writeProjectConfig(config: ProjectConfig): void {
  const configPath = path.join(process.cwd(), PROJECT_CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

const WELL_KNOWN_AI_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.cursor/rules',
  '.github/copilot-instructions.md',
  '.clinerules',
  'GEMINI.md',
];

export function discoverProjectFiles(): string[] {
  const cwd = process.cwd();
  return WELL_KNOWN_AI_FILES.filter((file) => fs.existsSync(path.join(cwd, file)));
}

export function copyProjectFilesToPocket(
  projectName: string,
  files: string[],
  repoDir: string,
): string[] {
  const cwd = process.cwd();
  const copied: string[] = [];

  for (const file of files) {
    const src = path.join(cwd, file);
    if (!fs.existsSync(src)) {
      console.warn(`Warning: ${file} not found in current directory, skipping.`);
      continue;
    }
    const pocketRelPath = path.join(projectName, file);
    const dest = path.join(repoDir, pocketRelPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(pocketRelPath);
  }

  return copied;
}

export function copyProjectFilesFromPocket(
  projectName: string,
  files: string[],
  repoDir: string,
): number {
  const cwd = process.cwd();
  let count = 0;

  for (const pocketRelPath of files) {
    const src = path.join(repoDir, pocketRelPath);
    if (!fs.existsSync(src)) {
      console.warn(`Warning: ${pocketRelPath} not found in pocket, skipping.`);
      continue;
    }
    const localRelPath = pocketRelPath.startsWith(projectName + path.sep)
      ? pocketRelPath.slice(projectName.length + path.sep.length)
      : pocketRelPath.startsWith(projectName + '/')
        ? pocketRelPath.slice(projectName.length + 1)
        : pocketRelPath;
    const dest = path.join(cwd, localRelPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    count++;
  }

  return count;
}
