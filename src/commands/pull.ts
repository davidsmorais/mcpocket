import * as fs from 'fs';
import * as path from 'path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo, ensureGitConfig } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir } from '../storage/gist.js';
import { ALL_PROVIDERS } from '../clients/providers.js';
import {
  additiveMerge,
  restoreFromPortableConfig,
} from '../sync/mcp.js';
import type { PortableMcpConfig } from '../sync/mcp.js';
import { readPluginManifestsFromRepo, applyPluginManifests } from '../sync/plugins.js';
import { applyAgentsFromRepo } from '../sync/agents.js';
import { applySkillsFromRepo } from '../sync/skills.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY } from '../utils/sparkle.js';

export async function pullCommand(options: ProviderFlagOptions = {}): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();
  const selection = resolveProviderSelection(options);

  // Pull or clone
  section('Pull');
  if (selection.isFiltered) {
    sparkle(`Sync scope: ${formatProviderList(selection.selected)}`);
  }
  sparkle(WITTY.pulling);

  if (config.storageType === 'gist') {
    try {
      const gistFiles = await fetchGist(config.githubToken, config.gistId!);
      fs.mkdirSync(repoDir, { recursive: true });
      writeGistFilesToDir(repoDir, gistFiles);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
  } else {
    try {
      pullRepo(repoDir, config.githubToken, config.repoCloneUrl!);
      ensureGitConfig(repoDir);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
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

  for (const provider of selection.selected) {
    const localServers = provider.readMcpServers();
    const mergedServers = additiveMerge(localServers, remoteServers);
    if (Object.keys(mergedServers).length > Object.keys(localServers).length) {
      provider.writeMcpServers(mergedServers);
      updatedClients.push(`${provider.displayName} (${provider.getConfigPath()})`);
    }
  }

  sparkle(`Restored ${serverCount} MCP server(s)`);

  // Apply plugin manifests
  let updatedManifests: string[] = [];
  if (selection.syncsClaudeHomeAssets) {
    sparkle(WITTY.readingPlugins);
    const manifests = readPluginManifestsFromRepo(repoDir);
    updatedManifests = applyPluginManifests(manifests);
    sparkle(`Updated ${updatedManifests.length} manifest file(s)`);
  } else if (selection.isFiltered) {
    sparkle('Skipping Claude home plugin manifests for this provider selection');
  }

  // Apply agents
  let agentResult = { synced: 0, removed: 0 };
  if (selection.syncsClaudeHomeAssets) {
    sparkle(WITTY.readingAgents);
    agentResult = applyAgentsFromRepo(repoDir);
    sparkle(`Restored ${agentResult.synced} agent file(s)`);
    if (agentResult.removed > 0) {
      sparkle(`Removed ${agentResult.removed} stale local agent file(s)`);
    }
  } else if (selection.isFiltered) {
    sparkle('Skipping Claude home agents for this provider selection');
  }

  // Apply skills
  let skillResult = { synced: 0, removed: 0 };
  if (selection.syncsClaudeHomeAssets) {
    sparkle(WITTY.readingSkills);
    skillResult = applySkillsFromRepo(repoDir);
    sparkle(`Restored ${skillResult.synced} skill file(s)`);
    if (skillResult.removed > 0) {
      sparkle(`Removed ${skillResult.removed} stale local skill file(s)`);
    }
  } else if (selection.isFiltered) {
    sparkle('Skipping Claude home skills for this provider selection');
  }

  // Summary
  celebrate(WITTY.pullDone);

  section('Summary');
  stat('Providers', formatProviderList(selection.selected));
  stat('MCPs', `${serverCount} servers → ${updatedClients.length} client(s)`);
  stat('Plugins', `${updatedManifests.length} manifest file(s)`);
  stat('Agents', agentResult.synced.toString());
  stat('Skills', skillResult.synced.toString());

  if (updatedClients.length > 0) {
    console.log('\n  Updated clients:');
    for (const c of updatedClients) {
      sparkle(c);
    }
    heads_up('Restart affected apps to apply MCP changes.');
  }
  console.log('');
}
