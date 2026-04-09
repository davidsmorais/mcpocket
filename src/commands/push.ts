import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { collectFilesFromDir, updateGist } from '../storage/gist.js';
import { mergeMcpSources, buildPortableConfig } from '../sync/mcp.js';
import { readPluginManifests, writePluginManifestsToRepo } from '../sync/plugins.js';
import { writeAgentsToRepo } from '../sync/agents.js';
import { writeSkillsToRepo } from '../sync/skills.js';
import { prunePocketDir } from '../sync/pocket.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY } from '../utils/sparkle.js';

interface AssetSyncSummary {
  manifestCount: number;
  pluginResult: { synced: number; removed: number };
  agentResult: { synced: number; removed: number };
  skillResult: { synced: number; removed: number };
}

export async function pushCommand(options: ProviderFlagOptions = {}): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();
  const selection = resolveProviderSelection(options);

  section('Push');

  if (selection.isFiltered) {
    sparkle(`Sync scope: ${formatProviderList(selection.selected)}`);
  }

  preparePocketDirectory(config.storageType, repoDir, config.githubToken, config.repoCloneUrl);

  const prunedEntries = prunePocketDir(repoDir);
  if (prunedEntries > 0) {
    sparkle(`Removed ${prunedEntries} stale pocket entr${prunedEntries === 1 ? 'y' : 'ies'}`);
  }

  const passphrase = await promptForPushPassphrase();

  sparkle(WITTY.readingMCP);
  const merged = mergeMcpSources(...selection.selected.map((provider) => provider.readMcpServers()));
  const serverCount = Object.keys(merged).length;
  sparkle(`Found ${serverCount} MCP server(s) across ${selection.selected.length} provider(s)`);

  // Write mcp-config.json
  sparkle(WITTY.encrypting);
  const portableConfig = buildPortableConfig(merged, passphrase);
  fs.writeFileSync(
    path.join(repoDir, 'mcp-config.json'),
    JSON.stringify(portableConfig, null, 2),
    'utf8'
  );

  const assetSummary = syncClaudeHomeAssetsToPocket(repoDir, selection.syncsClaudeHomeAssets, selection.isFiltered);

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
  stat('Providers', formatProviderList(selection.selected));
  stat('MCPs', serverCount.toString());
  stat('Plugins', `${assetSummary.manifestCount} manifest file(s)`);
  stat('Agents', assetSummary.agentResult.synced.toString());
  stat('Skills', assetSummary.skillResult.synced.toString());
  console.log('');
}

function preparePocketDirectory(
  storageType: 'repo' | 'gist',
  repoDir: string,
  githubToken: string,
  repoCloneUrl?: string
): void {
  if (storageType === 'gist') {
    fs.mkdirSync(repoDir, { recursive: true });
    return;
  }

  sparkle(WITTY.pulling);
  try {
    pullRepo(repoDir, githubToken, repoCloneUrl!);
  } catch (err) {
    heads_up(`Could not pull latest — ${(err as Error).message}`);
  }
}

async function promptForPushPassphrase(): Promise<string> {
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

  return passphrase;
}

function syncClaudeHomeAssetsToPocket(
  repoDir: string,
  shouldSync: boolean,
  showSkipMessage: boolean
): AssetSyncSummary {
  if (!shouldSync) {
    if (showSkipMessage) {
      sparkle('Skipping Claude home plugin manifests for this provider selection');
      sparkle('Skipping Claude home agents for this provider selection');
      sparkle('Skipping Claude home skills for this provider selection');
    }

    return {
      manifestCount: 0,
      pluginResult: { synced: 0, removed: 0 },
      agentResult: { synced: 0, removed: 0 },
      skillResult: { synced: 0, removed: 0 },
    };
  }

  sparkle(WITTY.readingPlugins);
  const manifests = readPluginManifests();
  const manifestCount = Object.keys(manifests).length;
  sparkle(`Found ${manifestCount} plugin manifest file(s)`);
  const pluginResult = writePluginManifestsToRepo(manifests, repoDir);
  if (pluginResult.removed > 0) {
    sparkle(`Removed ${pluginResult.removed} stale plugin manifest file(s) from the pocket`);
  }

  sparkle(WITTY.readingAgents);
  const agentResult = writeAgentsToRepo(repoDir);
  sparkle(`Synced ${agentResult.synced} agent file(s)`);
  if (agentResult.removed > 0) {
    sparkle(`Removed ${agentResult.removed} stale agent file(s) from the pocket`);
  }

  sparkle(WITTY.readingSkills);
  const skillResult = writeSkillsToRepo(repoDir);
  sparkle(`Synced ${skillResult.synced} skill file(s)`);
  if (skillResult.removed > 0) {
    sparkle(`Removed ${skillResult.removed} stale skill file(s) from the pocket`);
  }

  return { manifestCount, pluginResult, agentResult, skillResult };
}
