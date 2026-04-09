import * as fs from 'fs';
import * as path from 'path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { collectFilesFromDir, updateGist } from '../storage/gist.js';
import { readClaudeDesktopMcpServers } from '../clients/claude-desktop.js';
import { readClaudeCodeMcpServers } from '../clients/claude-code.js';
import { readOpenCodeMcpServers } from '../clients/opencode.js';
import { mergeMcpSources, buildPortableConfig } from '../sync/mcp.js';
import { readPluginManifests, writePluginManifestsToRepo } from '../sync/plugins.js';
import { writeAgentsToRepo } from '../sync/agents.js';
import { writeSkillsToRepo } from '../sync/skills.js';
import { prunePocketDir } from '../sync/pocket.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY } from '../utils/sparkle.js';

export async function pushCommand(): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  section('Push');

  // For repo mode, pull latest first to avoid conflicts
  if (config.storageType !== 'gist') {
    sparkle(WITTY.pulling);
    try {
      pullRepo(repoDir, config.githubToken, config.repoCloneUrl!);
    } catch (err) {
      heads_up(`Could not pull latest — ${(err as Error).message}`);
    }
  } else {
    fs.mkdirSync(repoDir, { recursive: true });
  }

  const prunedEntries = prunePocketDir(repoDir);
  if (prunedEntries > 0) {
    sparkle(`Removed ${prunedEntries} stale pocket entr${prunedEntries === 1 ? 'y' : 'ies'}`);
  }

  // Get passphrase for encrypting secrets
  const passphrase = await askSecret('  🔒 Passphrase to encrypt secrets: ');
  if (!passphrase) {
    oops('Passphrase cannot be empty.');
    process.exit(1);
  }
  const confirm = await askSecret('  🔒 Confirm passphrase: ');
  if (passphrase !== confirm) {
    oops('Passphrases don\'t match. Give it another whirl!');
    process.exit(1);
  }

  sparkle(WITTY.readingMCP);
  const desktop = readClaudeDesktopMcpServers();
  const claudeCode = readClaudeCodeMcpServers();
  const opencode = readOpenCodeMcpServers();
  const merged = mergeMcpSources(desktop, claudeCode, opencode);
  const serverCount = Object.keys(merged).length;
  sparkle(`Found ${serverCount} MCP server(s) across all clients`);

  // Write mcp-config.json
  sparkle(WITTY.encrypting);
  const portableConfig = buildPortableConfig(merged, passphrase);
  fs.writeFileSync(
    path.join(repoDir, 'mcp-config.json'),
    JSON.stringify(portableConfig, null, 2),
    'utf8'
  );

  // Sync plugin manifests
  sparkle(WITTY.readingPlugins);
  const manifests = readPluginManifests();
  const manifestCount = Object.keys(manifests).length;
  sparkle(`Found ${manifestCount} plugin manifest file(s)`);
  const pluginResult = writePluginManifestsToRepo(manifests, repoDir);
  if (pluginResult.removed > 0) {
    sparkle(`Removed ${pluginResult.removed} stale plugin manifest file(s) from the pocket`);
  }

  // Sync agents
  sparkle(WITTY.readingAgents);
  const agentResult = writeAgentsToRepo(repoDir);
  sparkle(`Synced ${agentResult.synced} agent file(s)`);
  if (agentResult.removed > 0) {
    sparkle(`Removed ${agentResult.removed} stale agent file(s) from the pocket`);
  }

  // Sync skills
  sparkle(WITTY.readingSkills);
  const skillResult = writeSkillsToRepo(repoDir);
  sparkle(`Synced ${skillResult.synced} skill file(s)`);
  if (skillResult.removed > 0) {
    sparkle(`Removed ${skillResult.removed} stale skill file(s) from the pocket`);
  }

  // Push to remote
  sparkle(WITTY.pushing);

  if (config.storageType === 'gist') {
    try {
      const files = collectFilesFromDir(repoDir);
      await updateGist(config.githubToken, config.gistId!, files);
      celebrate(WITTY.pushDone);
    } catch (err) {
      oops(`Gist push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    ensureGitConfig(repoDir);
    try {
      commitAndPush(repoDir, config.githubToken, config.repoCloneUrl!, 'mcpocket: push');
      celebrate(WITTY.pushDone);
    } catch (err) {
      oops(`Push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  section('Summary');
  stat('Storage', config.storageType === 'gist' ? `gist (${config.gistUrl})` : `repo (${config.repoHtmlUrl})`);
  stat('MCPs', serverCount.toString());
  stat('Plugins', `${manifestCount} manifest file(s)`);
  stat('Agents', agentResult.synced.toString());
  stat('Skills', skillResult.synced.toString());
  console.log('');
}
