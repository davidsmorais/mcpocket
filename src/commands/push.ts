import * as fs from 'fs';
import * as path from 'path';
import { readConfig, getLocalRepoDir } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { collectFilesFromDir, updateGist } from '../storage/gist.js';
import { ALL_PROVIDERS } from '../clients/providers.js';
import { mergeMcpSources, buildPortableConfig } from '../sync/mcp.js';
import { readPluginManifests, writePluginManifestsToRepo } from '../sync/plugins.js';
import { writeAgentsToRepo } from '../sync/agents.js';
import { writeSkillsToRepo } from '../sync/skills.js';
import { prunePocketDir } from '../sync/pocket.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY } from '../utils/sparkle.js';

export async function pushCommand(options: ProviderFlagOptions = {}): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();
  const selection = resolveProviderSelection(options);

  section('Push');

  if (selection.isFiltered) {
    sparkle(`Sync scope: ${formatProviderList(selection.selected)}`);
  }

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

  // Sync plugin manifests
  let manifestCount = 0;
  let pluginResult = { synced: 0, removed: 0 };
  if (selection.syncsClaudeHomeAssets) {
    sparkle(WITTY.readingPlugins);
    const manifests = readPluginManifests();
    manifestCount = Object.keys(manifests).length;
    sparkle(`Found ${manifestCount} plugin manifest file(s)`);
    pluginResult = writePluginManifestsToRepo(manifests, repoDir);
    if (pluginResult.removed > 0) {
      sparkle(`Removed ${pluginResult.removed} stale plugin manifest file(s) from the pocket`);
    }
  } else if (selection.isFiltered) {
    sparkle('Skipping Claude home plugin manifests for this provider selection');
  }

  // Sync agents
  let agentResult = { synced: 0, removed: 0 };
  if (selection.syncsClaudeHomeAssets) {
    sparkle(WITTY.readingAgents);
    agentResult = writeAgentsToRepo(repoDir);
    sparkle(`Synced ${agentResult.synced} agent file(s)`);
    if (agentResult.removed > 0) {
      sparkle(`Removed ${agentResult.removed} stale agent file(s) from the pocket`);
    }
  } else if (selection.isFiltered) {
    sparkle('Skipping Claude home agents for this provider selection');
  }

  // Sync skills
  let skillResult = { synced: 0, removed: 0 };
  if (selection.syncsClaudeHomeAssets) {
    sparkle(WITTY.readingSkills);
    skillResult = writeSkillsToRepo(repoDir);
    sparkle(`Synced ${skillResult.synced} skill file(s)`);
    if (skillResult.removed > 0) {
      sparkle(`Removed ${skillResult.removed} stale skill file(s) from the pocket`);
    }
  } else if (selection.isFiltered) {
    sparkle('Skipping Claude home skills for this provider selection');
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
  stat('Providers', formatProviderList(selection.selected));
  stat('MCPs', serverCount.toString());
  stat('Plugins', `${manifestCount} manifest file(s)`);
  stat('Agents', agentResult.synced.toString());
  stat('Skills', skillResult.synced.toString());
  console.log('');
}
