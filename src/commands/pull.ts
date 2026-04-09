import * as fs from 'fs';
import * as path from 'path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo, cloneRepo, ensureGitConfig } from '../storage/github.js';
import { writeClaudeDesktopMcpServers, getConfigPath as desktopPath } from '../clients/claude-desktop.js';
import { writeClaudeCodeMcpServers, getSettingsPath } from '../clients/claude-code.js';
import { writeOpenCodeMcpServers, getConfigPath as opencodePath } from '../clients/opencode.js';
import {
  additiveMerge,
  restoreFromPortableConfig,
} from '../sync/mcp.js';
import type { PortableMcpConfig } from '../sync/mcp.js';
import { readClaudeDesktopMcpServers } from '../clients/claude-desktop.js';
import { readClaudeCodeMcpServers } from '../clients/claude-code.js';
import { readOpenCodeMcpServers } from '../clients/opencode.js';
import { readPluginManifestsFromRepo, applyPluginManifests } from '../sync/plugins.js';
import { applyAgentsFromRepo } from '../sync/agents.js';
import { applySkillsFromRepo } from '../sync/skills.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY } from '../utils/sparkle.js';

export async function pullCommand(): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  // Pull or clone
  section('Pull');
  sparkle(WITTY.pulling);
  try {
    pullRepo(repoDir, config.githubToken, config.repoCloneUrl);
    ensureGitConfig(repoDir);
  } catch (err) {
    oops((err as Error).message);
    process.exit(1);
  }

  // Check for mcp-config.json
  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  if (!fs.existsSync(mcpConfigPath)) {
    heads_up('No config found in the pocket yet. Run `mcpocket push` on your source machine first!');
    return;
  }

  // Get passphrase for decrypting secrets
  const passphrase = await askSecret('  🔓 Passphrase to decrypt secrets: ');
  if (!passphrase) {
    oops('Passphrase cannot be empty.');
    process.exit(1);
  }

  // Restore MCP servers
  sparkle(WITTY.decrypting);
  let remoteServers: ReturnType<typeof restoreFromPortableConfig>;
  try {
    const portableConfig: PortableMcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    remoteServers = restoreFromPortableConfig(portableConfig, passphrase);
  } catch (err) {
    oops(`Decryption failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const serverCount = Object.keys(remoteServers).length;
  const updatedClients: string[] = [];

  // Apply to Claude Desktop
  const localDesktop = readClaudeDesktopMcpServers();
  const mergedDesktop = additiveMerge(localDesktop, remoteServers);
  if (Object.keys(mergedDesktop).length > Object.keys(localDesktop).length) {
    writeClaudeDesktopMcpServers(mergedDesktop);
    updatedClients.push(`Claude Desktop (${desktopPath()})`);
  }

  // Apply to Claude Code
  const localCode = readClaudeCodeMcpServers();
  const mergedCode = additiveMerge(localCode, remoteServers);
  if (Object.keys(mergedCode).length > Object.keys(localCode).length) {
    writeClaudeCodeMcpServers(mergedCode);
    updatedClients.push(`Claude Code (${getSettingsPath()})`);
  }

  // Apply to OpenCode
  const localOpenCode = readOpenCodeMcpServers();
  const mergedOpenCode = additiveMerge(localOpenCode, remoteServers);
  if (Object.keys(mergedOpenCode).length > Object.keys(localOpenCode).length) {
    writeOpenCodeMcpServers(mergedOpenCode);
    updatedClients.push(`OpenCode (${opencodePath()})`);
  }

  sparkle(`Restored ${serverCount} MCP server(s)`);

  // Apply plugin manifests
  sparkle(WITTY.readingPlugins);
  const manifests = readPluginManifestsFromRepo(repoDir);
  const updatedManifests = applyPluginManifests(manifests);
  sparkle(`Updated ${updatedManifests.length} manifest file(s)`);

  // Apply agents
  sparkle(WITTY.readingAgents);
  const agentCount = applyAgentsFromRepo(repoDir);
  sparkle(`Restored ${agentCount} agent file(s)`);

  // Apply skills
  sparkle(WITTY.readingSkills);
  const skillCount = applySkillsFromRepo(repoDir);
  sparkle(`Restored ${skillCount} skill file(s)`);

  // Summary
  celebrate(WITTY.pullDone);

  section('Summary');
  stat('MCPs', `${serverCount} servers → ${updatedClients.length} client(s)`);
  stat('Plugins', `${updatedManifests.length} manifest file(s)`);
  stat('Agents', agentCount.toString());
  stat('Skills', skillCount.toString());

  if (updatedClients.length > 0) {
    console.log('\n  Updated clients:');
    for (const c of updatedClients) {
      sparkle(c);
    }
    heads_up('Restart Claude Desktop to apply MCP changes.');
  }
  console.log('');
}
