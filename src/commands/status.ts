import * as fs from 'fs';
import * as path from 'path';
import { readConfig, getLocalRepoDir, resolveToken } from '../config.js';
import { pullRepo } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir } from '../storage/gist.js';
import { readClaudeDesktopMcpServers } from '../clients/claude-desktop.js';
import { readClaudeCodeMcpServers } from '../clients/claude-code.js';
import { readOpenCodeMcpServers } from '../clients/opencode.js';
import { mergeMcpSources } from '../sync/mcp.js';
import type { PortableMcpConfig } from '../sync/mcp.js';
import { sparkle, section, heads_up, WITTY, c } from '../utils/sparkle.js';

export async function statusCommand(): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  sparkle(WITTY.pulling);

  if (config.storageType === 'gist') {
    try {
      const { files: gistFiles } = await fetchGist(resolveToken(config), config.gistId!);
      fs.mkdirSync(repoDir, { recursive: true });
      writeGistFilesToDir(repoDir, gistFiles);
    } catch (err) {
      heads_up(`Could not fetch gist — ${(err as Error).message}`);
    }
  } else {
    try {
      pullRepo(repoDir, resolveToken(config), config.repoCloneUrl!);
    } catch (err) {
      heads_up(`Could not pull latest — ${(err as Error).message}`);
    }
  }

  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  if (!fs.existsSync(mcpConfigPath)) {
    heads_up('The pocket is empty! Run `mcpocket push` to stash your setup.');
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

  section('MCP Servers');
  if (inBoth.length > 0) {
    console.log('\n    \x1b[32mSynced:\x1b[0m');
    for (const n of inBoth) console.log(`      ${c.green('✓')} ${c.bold(n)}`);
  }
  if (onlyRemote.length > 0) {
    console.log('\n    \x1b[36mIn pocket, not here (run pull):\x1b[0m');
    for (const n of onlyRemote) console.log(`      ${c.cyan('↓')} ${c.bold(n)}`);
  }
  if (onlyLocal.length > 0) {
    console.log('\n    \x1b[33mLocal only (run push):\x1b[0m');
    for (const n of onlyLocal) console.log(`      ${c.yellow('↑')} ${c.bold(n)}`);
  }
  if (remoteNames.size === 0 && localNames.size === 0) {
    sparkle('No MCP servers found. Your pocket is empty!');
  }

  // Plugins
  section('Plugin Manifests');
  const pluginFiles = ['plugins/installed_plugins.json', 'plugins/blocklist.json', 'plugins/known_marketplaces.json'];
  for (const f of pluginFiles) {
    const inRepo = fs.existsSync(path.join(repoDir, f));
    console.log(`    ${inRepo ? c.green('✓') : c.red('✗')} ${c.dim(f)}`);
  }

  // Agents
  section('Agents');
  const agentsDir = path.join(repoDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const count = countFiles(agentsDir, '.md');
    sparkle(`${count} agent file(s) in the pocket`);
  } else {
    sparkle('Not synced yet — they\'re waiting for their first adventure!');
  }

  // Skills
  section('Skills');
  const skillsDir = path.join(repoDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    const count = countFiles(skillsDir);
    sparkle(`${count} skill file(s) in the pocket`);
  } else {
    sparkle('Not synced yet — skill points unspent!');
  }

  const remoteUrl = config.storageType === 'gist' ? config.gistUrl : config.repoHtmlUrl;
  console.log(`\n  🔗 Remote: ${c.cyan(String(remoteUrl))}\n`);
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
