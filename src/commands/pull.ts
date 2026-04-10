import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo, ensureGitConfig } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir } from '../storage/gist.js';
import {
  additiveMerge,
  restoreFromPortableConfig,
} from '../sync/mcp.js';
import type { PortableMcpConfig } from '../sync/mcp.js';
import type { McpServersMap, ProviderDefinition } from '../clients/types.js';
import { readPluginManifestsFromRepo, applyPluginManifests } from '../sync/plugins.js';
import { applyAgentsFromRepo } from '../sync/agents.js';
import { applySkillsFromRepo } from '../sync/skills.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY } from '../utils/sparkle.js';

interface RestoredAssetSummary {
  updatedManifests: string[];
  agentResult: { synced: number; removed: number };
  skillResult: { synced: number; removed: number };
}

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
  await syncPocketToLocal(repoDir, config);

  // Check for mcp-config.json
  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  if (!fs.existsSync(mcpConfigPath)) {
    heads_up('No config found in the pocket yet. Run `mcpocket push` on your source machine first!');
    return;
  }

  const passphrase = await promptForPullPassphrase();

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
  const updatedClients = applyServersToProviders(selection.selected, remoteServers);

  sparkle(`Restored ${serverCount} MCP server(s)`);

  const restoredAssets = restoreClaudeHomeAssetsFromPocket(
    repoDir,
    selection.syncsClaudeHomeAssets,
    selection.isFiltered
  );

  // Summary
  celebrate(WITTY.pullDone);

  section('Summary');
  stat('Providers', formatProviderList(selection.selected));
  stat('MCPs', `${serverCount} servers → ${updatedClients.length} client(s)`);
  stat('Plugins', `${restoredAssets.updatedManifests.length} manifest file(s)`);
  stat('Agents', restoredAssets.agentResult.synced.toString());
  stat('Skills', restoredAssets.skillResult.synced.toString());

  if (updatedClients.length > 0) {
    console.log('\n  Updated clients:');
    for (const c of updatedClients) {
      sparkle(c);
    }
    heads_up('Restart affected apps to apply MCP changes.');
  }
  console.log('');
}

async function syncPocketToLocal(repoDir: string, config: ReturnType<typeof readConfig>): Promise<void> {
  if (config.storageType === 'gist') {
    try {
      const { files: gistFiles, truncated } = await fetchGist(config.githubToken, config.gistId!);
      fs.mkdirSync(repoDir, { recursive: true });
      writeGistFilesToDir(repoDir, gistFiles);
      if (truncated) {
        heads_up(
          'Your gist has more than 300 files — GitHub only returns the first 300 via its API.\n' +
          '  Some agents, skills, or plugins may not be synced. Consider switching to repo storage.'
        );
      }
      return;
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
  }

  try {
    pullRepo(repoDir, config.githubToken, config.repoCloneUrl!);
    ensureGitConfig(repoDir);
  } catch (err) {
    oops((err as Error).message);
    process.exit(1);
  }
}

async function promptForPullPassphrase(): Promise<string> {
  const passphrase = await askSecret('  🔓 Passphrase to decrypt secrets: ');
  if (!passphrase) {
    oops('Passphrase cannot be empty.');
    process.exit(1);
  }
  return passphrase;
}

function applyServersToProviders(providers: ProviderDefinition[], remoteServers: McpServersMap): string[] {
  const updatedClients: string[] = [];

  for (const provider of providers) {
    const localServers = provider.readMcpServers();
    const mergedServers = additiveMerge(localServers, remoteServers);
    if (Object.keys(mergedServers).length > Object.keys(localServers).length) {
      provider.writeMcpServers(mergedServers);
      updatedClients.push(`${provider.displayName} (${provider.getConfigPath()})`);
    }
  }

  return updatedClients;
}

function restoreClaudeHomeAssetsFromPocket(
  repoDir: string,
  shouldRestore: boolean,
  showSkipMessage: boolean
): RestoredAssetSummary {
  if (!shouldRestore) {
    if (showSkipMessage) {
      sparkle('Skipping Claude home plugin manifests for this provider selection');
      sparkle('Skipping Claude home agents for this provider selection');
      sparkle('Skipping Claude home skills for this provider selection');
    }

    return {
      updatedManifests: [],
      agentResult: { synced: 0, removed: 0 },
      skillResult: { synced: 0, removed: 0 },
    };
  }

  sparkle(WITTY.readingPlugins);
  const manifests = readPluginManifestsFromRepo(repoDir);
  const updatedManifests = applyPluginManifests(manifests);
  sparkle(`Updated ${updatedManifests.length} manifest file(s)`);

  sparkle(WITTY.readingAgents);
  const agentResult = applyAgentsFromRepo(repoDir);
  sparkle(`Restored ${agentResult.synced} agent file(s)`);
  if (agentResult.removed > 0) {
    sparkle(`Removed ${agentResult.removed} stale local agent file(s)`);
  }

  sparkle(WITTY.readingSkills);
  const skillResult = applySkillsFromRepo(repoDir);
  sparkle(`Restored ${skillResult.synced} skill file(s)`);
  if (skillResult.removed > 0) {
    sparkle(`Removed ${skillResult.removed} stale local skill file(s)`);
  }

  return { updatedManifests, agentResult, skillResult };
}
