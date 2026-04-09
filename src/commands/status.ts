import * as fs from 'fs';
import * as path from 'path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo } from '../storage/github.js';
import { readClaudeDesktopMcpServers } from '../clients/claude-desktop.js';
import { readClaudeCodeMcpServers } from '../clients/claude-code.js';
import { readOpenCodeMcpServers } from '../clients/opencode.js';
import { mergeMcpSources } from '../sync/mcp.js';
import type { PortableMcpConfig } from '../sync/mcp.js';

export async function statusCommand(): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  console.log('Fetching remote state...');
  try {
    pullRepo(repoDir, config.githubToken, config.repoCloneUrl);
  } catch (err) {
    console.warn(`Warning: could not pull latest — ${(err as Error).message}`);
  }

  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  if (!fs.existsSync(mcpConfigPath)) {
    console.log('\nRemote has no config yet. Run `carry-on push` to upload your setup.');
    return;
  }

  // Compare MCPs (without decrypting — just compare names)
  const portableConfig: PortableMcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  const remoteNames = new Set(Object.keys(portableConfig.mcpServers));

  const local = mergeMcpSources(
    readClaudeDesktopMcpServers(),
    readClaudeCodeMcpServers(),
    readOpenCodeMcpServers()
  );
  const localNames = new Set(Object.keys(local));

  const onlyRemote = [...remoteNames].filter(n => !localNames.has(n));
  const onlyLocal = [...localNames].filter(n => !remoteNames.has(n));
  const inBoth = [...remoteNames].filter(n => localNames.has(n));

  console.log('\n── MCP Servers ─────────────────────────────────');
  if (inBoth.length > 0) {
    console.log('\n  Synced:');
    for (const n of inBoth) console.log(`    ✓ ${n}`);
  }
  if (onlyRemote.length > 0) {
    console.log('\n  In remote, not local (run pull):');
    for (const n of onlyRemote) console.log(`    ↓ ${n}`);
  }
  if (onlyLocal.length > 0) {
    console.log('\n  In local, not remote (run push):');
    for (const n of onlyLocal) console.log(`    ↑ ${n}`);
  }
  if (remoteNames.size === 0 && localNames.size === 0) {
    console.log('  No MCP servers found.');
  }

  // Plugins
  console.log('\n── Plugin Manifests ────────────────────────────');
  const pluginFiles = ['plugins/installed_plugins.json', 'plugins/blocklist.json', 'plugins/known_marketplaces.json'];
  for (const f of pluginFiles) {
    const inRepo = fs.existsSync(path.join(repoDir, f));
    console.log(`  ${inRepo ? '✓' : '✗'} ${f}`);
  }

  // Agents
  console.log('\n── Agents ──────────────────────────────────────');
  const agentsDir = path.join(repoDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const count = countFiles(agentsDir, '.md');
    console.log(`  ${count} agent file(s) in remote`);
  } else {
    console.log('  Not synced yet');
  }

  // Skills
  console.log('\n── Skills ──────────────────────────────────────');
  const skillsDir = path.join(repoDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    const count = countFiles(skillsDir);
    console.log(`  ${count} skill file(s) in remote`);
  } else {
    console.log('  Not synced yet');
  }

  console.log(`\nRemote: ${config.repoHtmlUrl}\n`);
}

function countFiles(dir: string, ext?: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name), ext);
    } else if (!ext || entry.name.endsWith(ext)) {
      count++;
    }
  }
  return count;
}
