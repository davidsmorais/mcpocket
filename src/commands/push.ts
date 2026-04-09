import * as fs from 'fs';
import * as path from 'path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { readClaudeDesktopMcpServers } from '../clients/claude-desktop.js';
import { readClaudeCodeMcpServers } from '../clients/claude-code.js';
import { readOpenCodeMcpServers } from '../clients/opencode.js';
import { mergeMcpSources, buildPortableConfig } from '../sync/mcp.js';
import { readPluginManifests, writePluginManifestsToRepo } from '../sync/plugins.js';
import { writeAgentsToRepo } from '../sync/agents.js';
import { writeSkillsToRepo } from '../sync/skills.js';
import { askSecret } from '../utils/prompt.js';

export async function pushCommand(): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  // Pull latest first to avoid conflicts
  console.log('Pulling latest from remote...');
  try {
    pullRepo(repoDir, config.githubToken, config.repoCloneUrl);
  } catch (err) {
    console.warn(`Warning: could not pull latest — ${(err as Error).message}`);
  }

  // Get passphrase for encrypting secrets
  const passphrase = await askSecret('Passphrase to encrypt secrets: ');
  if (!passphrase) {
    console.error('Error: passphrase cannot be empty.');
    process.exit(1);
  }
  const confirm = await askSecret('Confirm passphrase: ');
  if (passphrase !== confirm) {
    console.error('Error: passphrases do not match.');
    process.exit(1);
  }

  console.log('\nReading MCP configurations...');
  const desktop = readClaudeDesktopMcpServers();
  const claudeCode = readClaudeCodeMcpServers();
  const opencode = readOpenCodeMcpServers();
  const merged = mergeMcpSources(desktop, claudeCode, opencode);
  const serverCount = Object.keys(merged).length;
  console.log(`  Found ${serverCount} MCP server(s) across all clients`);

  // Write mcp-config.json
  const portableConfig = buildPortableConfig(merged, passphrase);
  fs.writeFileSync(
    path.join(repoDir, 'mcp-config.json'),
    JSON.stringify(portableConfig, null, 2),
    'utf8'
  );

  // Sync plugin manifests
  console.log('\nReading plugin manifests...');
  const manifests = readPluginManifests();
  const manifestCount = Object.keys(manifests).length;
  console.log(`  Found ${manifestCount} plugin manifest file(s)`);
  writePluginManifestsToRepo(manifests, repoDir);

  // Sync agents
  console.log('\nSyncing agents...');
  const agentCount = writeAgentsToRepo(repoDir);
  console.log(`  Synced ${agentCount} agent file(s)`);

  // Sync skills
  console.log('\nSyncing skills...');
  const skillCount = writeSkillsToRepo(repoDir);
  console.log(`  Synced ${skillCount} skill file(s)`);

  // Commit and push
  console.log('\nPushing to GitHub...');
  ensureGitConfig(repoDir);
  try {
    commitAndPush(repoDir, config.githubToken, config.repoCloneUrl, 'carry-on: push');
    console.log(`\n✓ Pushed to ${config.repoHtmlUrl}`);
  } catch (err) {
    console.error(`Error pushing: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log('\nSummary:');
  console.log(`  MCPs:      ${serverCount}`);
  console.log(`  Plugins:   ${manifestCount} manifest file(s)`);
  console.log(`  Agents:    ${agentCount}`);
  console.log(`  Skills:    ${skillCount}`);
}
