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

export async function pullCommand(): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  // Pull or clone
  console.log('Pulling latest from remote...');
  try {
    pullRepo(repoDir, config.githubToken, config.repoCloneUrl);
    ensureGitConfig(repoDir);
  } catch (err) {
    console.error(`Error pulling repo: ${(err as Error).message}`);
    process.exit(1);
  }

  // Check for mcp-config.json
  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  if (!fs.existsSync(mcpConfigPath)) {
    console.log('No mcp-config.json found in remote. Run `carry-on push` on your source machine first.');
    return;
  }

  // Get passphrase for decrypting secrets
  const passphrase = await askSecret('Passphrase to decrypt secrets: ');
  if (!passphrase) {
    console.error('Error: passphrase cannot be empty.');
    process.exit(1);
  }

  // Restore MCP servers
  console.log('\nRestoring MCP servers...');
  let remoteServers: ReturnType<typeof restoreFromPortableConfig>;
  try {
    const portableConfig: PortableMcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    remoteServers = restoreFromPortableConfig(portableConfig, passphrase);
  } catch (err) {
    console.error(`Error decrypting MCPs: ${(err as Error).message}`);
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

  console.log(`  Restored ${serverCount} MCP server(s)`);

  // Apply plugin manifests
  console.log('\nRestoring plugin manifests...');
  const manifests = readPluginManifestsFromRepo(repoDir);
  const updatedManifests = applyPluginManifests(manifests);
  console.log(`  Updated ${updatedManifests.length} manifest file(s)`);

  // Apply agents
  console.log('\nRestoring agents...');
  const agentCount = applyAgentsFromRepo(repoDir);
  console.log(`  Restored ${agentCount} agent file(s)`);

  // Apply skills
  console.log('\nRestoring skills...');
  const skillCount = applySkillsFromRepo(repoDir);
  console.log(`  Restored ${skillCount} skill file(s)`);

  // Summary
  console.log('\n✓ Pull complete!\n');
  console.log('Summary:');
  console.log(`  MCPs:      ${serverCount} servers applied to ${updatedClients.length} client(s)`);
  console.log(`  Plugins:   ${updatedManifests.length} manifest file(s) updated`);
  console.log(`  Agents:    ${agentCount}`);
  console.log(`  Skills:    ${skillCount}`);

  if (updatedClients.length > 0) {
    console.log('\nUpdated clients:');
    for (const c of updatedClients) {
      console.log(`  • ${c}`);
    }
    console.log('\n⚠  Restart Claude Desktop to apply MCP changes.');
  }

  if (updatedManifests.length > 0) {
    console.log('⚠  Restart Claude Code to trigger plugin installation.');
  }
}
