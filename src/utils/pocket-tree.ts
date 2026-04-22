import fs from 'fs';
import path from 'path';

// Import managed top-level pocket dirs/config from the core sync module
import { MANAGED_POCKET_TOP_LEVEL } from '../sync/pocket';

export interface PocketTreeResult {
  mcpConfig: string | null;        // "mcp-config.json" if exists
  plugins: string[];               // files under plugins/
  providers: ProviderTree;         // agents/skills organized by provider
  projects: Record<string, ProjectTree>;  // project directories with their files
}

export interface ProviderTree {
  agents: Record<string, string[]>;   // provider -> list of agent file paths
  skills: Record<string, string[]>;   // provider -> list of skill file paths
}

export interface ProjectTree {
  files: string[];  // all files under the project directory (relative paths)
}

/** Normalize a path to POSIX-style relative path */
function relPosix(baseDir: string, fullPath: string): string {
  const rel = path.relative(baseDir, fullPath);
  // Normalize to forward slashes regardless of OS
  return rel.split(path.sep).join('/');
}

/** Recursively collect all files under a directory, skipping hidden entries and some system dirs */
function scanDirFiles(rootDir: string, repoDir: string, includeMdOnly: boolean = false): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootDir)) return results;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const curr = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(curr, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      // Skip standard hidden dirs at the top level of the repository
      if (name.startsWith('.')) {
        // Hidden entries are only allowed to survive inside projects, not here
        continue;
      }
      const fullPath = path.join(curr, name);
      if (ent.isDirectory()) {
        // Always skip certain system dirs
        if (name === 'node_modules' || name === '.git') continue;
        stack.push(fullPath);
      } else if (ent.isFile()) {
        if (includeMdOnly) {
          if (path.extname(name).toLowerCase() !== '.md') continue;
        }
        results.push(relPosix(repoDir, fullPath));
      }
    }
  }
  return results;
}

/** Recursively collect all files under a directory, including hidden ones, but skipping some system dirs */
function scanDirFilesInclusiveHidden(rootDir: string, repoDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootDir)) return results;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const curr = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(curr, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      const fullPath = path.join(curr, name);
      if (ent.isDirectory()) {
        // Skip certain system dirs, even if hidden
        if (name === 'node_modules' || name === '.git') continue;
        stack.push(fullPath);
      } else if (ent.isFile()) {
        results.push(relPosix(repoDir, fullPath));
      }
    }
  }
  return results;
}

/** Scan the pocket tree and categorize files */
export function scanPocketTree(repoDir: string): PocketTreeResult {
  // Normalize input
  const base = path.resolve(repoDir);

  // 1) MCP config presence
  const mcpConfigPath = path.join(base, 'mcp-config.json');
  const mcpConfig: string | null = fs.existsSync(mcpConfigPath) ? 'mcp-config.json' : null;

  // 2) Plugins - all files under plugins/ recursively, skip hidden entries at all levels
  const pluginsRoot = path.join(base, 'plugins');
  const plugins: string[] = [];
  if (fs.existsSync(pluginsRoot) && fs.statSync(pluginsRoot).isDirectory()) {
    const files = scanDirFiles(pluginsRoot, base, false);
    // filter out any that do not live under plugins/ and ensure path is relative
    for (const f of files) {
      // Ensure the path indeed starts with 'plugins/'
      if (f.startsWith('plugins/')) plugins.push(f);
    }
  }

  // 3) Providers - agents and skills
  const providers: ProviderTree = {
    agents: {},
    skills: {},
  };

  // Agents: expect subdirectories under agents/; only include non-hidden provider dirs
  const agentsRoot = path.join(base, 'agents');
  if (fs.existsSync(agentsRoot) && fs.statSync(agentsRoot).isDirectory()) {
    const providerEntries = fs.readdirSync(agentsRoot, { withFileTypes: true });
    for (const pe of providerEntries) {
      if (!pe.isDirectory()) continue;
      const providerName = pe.name;
      if (providerName.startsWith('.')) continue; // skip hidden providers
      const providerDir = path.join(agentsRoot, providerName);
      const mdFiles = scanDirFiles(providerDir, base, true);
      providers.agents[providerName] = mdFiles;
    }
  }

  // Skills: providers under skills/; list all files recursively (hidden files excluded at top level only)
  const skillsRoot = path.join(base, 'skills');
  if (fs.existsSync(skillsRoot) && fs.statSync(skillsRoot).isDirectory()) {
    const providerEntries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    for (const pe of providerEntries) {
      if (!pe.isDirectory()) continue;
      const providerName = pe.name;
      if (providerName.startsWith('.')) continue; // skip hidden providers
      const providerDir = path.join(skillsRoot, providerName);
      const files = scanDirFilesInclusiveHidden(providerDir, base);
      providers.skills[providerName] = files;
    }
  }

  // 4) Projects - top-level dirs not in MANAGED_POCKET_TOP_LEVEL, skip hidden top-level
  const projects: Record<string, ProjectTree> = {};
  const topLevelEntries = fs.readdirSync(base, { withFileTypes: true });
  for (const entry of topLevelEntries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith('.')) continue; // skip hidden top-level dirs
    if (MANAGED_POCKET_TOP_LEVEL.has(name)) continue; // skip managed top-level dirs/files
    const projPath = path.join(base, name);
    // List all files within project, including hidden ones, but skip node_modules/.git
    const projFiles = scanDirFilesInclusiveHidden(projPath, base);
    projects[name] = { files: projFiles };
  }

  return {
    mcpConfig,
    plugins,
    providers,
    projects,
  };
}
