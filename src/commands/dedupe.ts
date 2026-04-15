import * as fs from 'fs';
import { readConfig, getLocalRepoDir, resolveToken } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir, collectFilesFromDir, updateGist } from '../storage/gist.js';
import {
  readPluginManifests,
  writePluginManifestsToRepo,
  readPluginManifestsFromRepo,
  applyPluginManifests,
} from '../sync/plugins.js';
import { writeAgentsToRepo, applyAgentsFromRepo } from '../sync/agents.js';
import { writeSkillsToRepo, applySkillsFromRepo } from '../sync/skills.js';
import { prunePocketDir } from '../sync/pocket.js';
import { sparkle, celebrate, section, stat, oops, WITTY } from '../utils/sparkle.js';

export async function dedupeCommand(): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  section('De-dupe');
  sparkle(WITTY.pulling);

  if (config.storageType === 'gist') {
    try {
      const { files: gistFiles } = await fetchGist(resolveToken(config), config.gistId!);
      fs.mkdirSync(repoDir, { recursive: true });
      writeGistFilesToDir(repoDir, gistFiles);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
  } else {
    try {
      pullRepo(repoDir, resolveToken(config), config.repoCloneUrl!);
      ensureGitConfig(repoDir);
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
  }

  const prunedEntries = prunePocketDir(repoDir);

  sparkle(WITTY.readingPlugins);
  const manifests = readPluginManifests();
  const pluginPocket = writePluginManifestsToRepo(manifests, repoDir);

  sparkle(WITTY.readingAgents);
  const agentPocket = writeAgentsToRepo(repoDir);

  sparkle(WITTY.readingSkills);
  const skillPocket = writeSkillsToRepo(repoDir);

  const pocketFiles = collectFilesFromDir(repoDir);
  if (config.storageType === 'gist') {
    try {
      await updateGist(resolveToken(config), config.gistId!, pocketFiles);
    } catch (err) {
      oops(`Gist de-dupe failed: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    try {
      commitAndPush(repoDir, resolveToken(config), config.repoCloneUrl!, 'mcpocket: dedupe');
    } catch (err) {
      oops(`De-dupe push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const updatedManifests = applyPluginManifests(readPluginManifestsFromRepo(repoDir));
  const agentLocal = applyAgentsFromRepo(repoDir);
  const skillLocal = applySkillsFromRepo(repoDir);

  celebrate('Pocket duplicates cleaned up.');

  section('Summary');
  stat('Pocket entries pruned', prunedEntries);
  stat('Plugin manifests synced', pluginPocket.synced);
  stat('Plugin manifests removed', pluginPocket.removed);
  stat('Pocket agents removed', agentPocket.removed);
  stat('Pocket skills removed', skillPocket.removed);
  stat('Local plugin manifests updated', updatedManifests.length);
  stat('Local agents removed', agentLocal.removed);
  stat('Local skills removed', skillLocal.removed);
  console.log('');
}