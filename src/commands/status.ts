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
import { sparkle, section, heads_up, WITTY, c, subItem } from '../utils/sparkle.js';
import { scanPocketTree } from '../utils/pocket-tree.js';
import { renderPocketTree } from '../utils/tree-render.js';
import { ALL_PROVIDERS } from '../clients/providers.js';

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

  const portableConfig: PortableMcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  const remoteNames = new Set(Object.keys(portableConfig.mcpServers));

  const local = mergeMcpSources(
    readClaudeDesktopMcpServers(),
    readClaudeCodeMcpServers(),
    readOpenCodeMcpServers()
  );
  const localNames = new Set(Object.keys(local));

  const synced = [...remoteNames].filter(n => localNames.has(n));
  const remoteOnly = [...remoteNames].filter(n => !localNames.has(n));
  const localOnly = [...localNames].filter(n => !remoteNames.has(n));

  section('MCP Sync Status');
  if (synced.length > 0) {
    subItem('Synced', { check: true, value: synced.join(', ') });
  }
  if (remoteOnly.length > 0) {
    subItem('In pocket, not local', { value: `${remoteOnly.length} to pull — ${remoteOnly.join(', ')}` });
  }
  if (localOnly.length > 0) {
    subItem('Local only', { value: `${localOnly.length} to push — ${localOnly.join(', ')}` });
  }
  if (remoteNames.size === 0 && localNames.size === 0) {
    sparkle('No MCP servers found. Your pocket is empty!');
  }

  const pocketTree = scanPocketTree(repoDir);
  renderPocketTree(pocketTree);

  const remoteUrl = config.storageType === 'gist' ? config.gistUrl : config.repoHtmlUrl;
  console.log(`\n  🔗 Remote: ${c.cyan(String(remoteUrl))}\n`);
}
