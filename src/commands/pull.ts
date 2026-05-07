import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir, resolveToken } from '../config.js';
import { pullRepo, ensureGitConfig } from '../storage/github.js';
import { fetchGist, writeGistFilesToDir } from '../storage/gist.js';
import { additiveMerge, restoreFromPortableConfig } from '../sync/mcp.js';
import type { PortableMcpConfig } from '../sync/mcp.js';
import type { McpServersMap, ProviderDefinition } from '../clients/types.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { readManifest } from '../sync/manifest.js';
import type { ManifestEntry } from '../sync/manifest.js';
import { chooseDestinations } from './destination-chooser.js';
import { askSecret } from '../utils/prompt.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY, c, subItem } from '../utils/sparkle.js';
import { synthesizeManifestFromLegacyPocket } from '../sync/legacy-manifest.js';

export async function pullCommand(
  options: ProviderFlagOptions & {
    interactive?: boolean;
    ui?: boolean;
    exclude?: boolean;
    project?: boolean;
    global?: boolean;
    yes?: boolean;
  } = {},
): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();
  const selection = resolveProviderSelection(options, config.syncProviders);

  section('Pull');
  if (selection.isFiltered) {
    sparkle(`MCP scope: ${formatProviderList(selection.selected)}`);
  }

  sparkle(WITTY.pulling);
  await syncPocketToLocal(repoDir, config);

  // ── Read manifest (or synthesize from legacy layout) ───────────────────────
  let manifest = readManifest(repoDir);
  if (!manifest) {
    sparkle('No manifest found — synthesizing from legacy pocket layout...');
    manifest = synthesizeManifestFromLegacyPocket(repoDir);
  }

  const entries = manifest.entries;
  if (entries.length === 0) {
    heads_up('Pocket is empty — nothing to restore.');
  } else {
    sparkle(`Found ${entries.length} item(s) in the pocket`);
  }

  // ── Choose destinations ────────────────────────────────────────────────────
  const forceScope: 'project' | 'global' | undefined = options.project ? 'project' : options.global ? 'global' : undefined;
  const ctx = { cwd: process.cwd(), forceScope };
  const routed = await chooseDestinations(entries, ctx, { acceptAll: options.yes });

  // ── Write each routed item ─────────────────────────────────────────────────
  let written = 0;
  for (const r of routed) {
    const sourceAbs = path.join(repoDir, ...r.entry.pocketPath.split('/'));
    if (!fs.existsSync(sourceAbs)) continue;
    if (!r.destination.absPath) continue;
    fs.mkdirSync(path.dirname(r.destination.absPath), { recursive: true });
    fs.copyFileSync(sourceAbs, r.destination.absPath);
    written++;
  }

  // ── MCPs ───────────────────────────────────────────────────────────────────
  const mcpConfigPath = path.join(repoDir, 'mcp-config.json');
  let serverCount = 0;
  let updatedClients: string[] = [];
  if (fs.existsSync(mcpConfigPath) && !options.project) {
    try {
      const passphrase = await promptForPullPassphrase();
      sparkle(WITTY.decrypting);
      const portableConfig: PortableMcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      const remoteServers = restoreFromPortableConfig(portableConfig, passphrase);
      serverCount = Object.keys(remoteServers).length;
      updatedClients = applyServersToProviders(selection.selected, remoteServers);
      sparkle(`Restored ${serverCount} MCP server(s)`);
    } catch (err) {
      heads_up(`MCPs skipped: ${(err as Error).message}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  celebrate(WITTY.pullDone);
  section('Summary');
  subItem('Files restored', { check: written > 0, value: `${written} file(s)` });
  subItem('MCPs', { check: serverCount > 0, value: `${serverCount} server(s) → ${updatedClients.length} client(s)` });
  if (updatedClients.length > 0) {
    console.log(`\n  ${c.bold('Updated clients:')}`);
    for (const client of updatedClients) sparkle(c.cyan(client));
    heads_up('Restart affected apps to apply MCP changes.');
  }
  console.log('');
}

async function syncPocketToLocal(
  repoDir: string,
  config: ReturnType<typeof readConfig>,
): Promise<void> {
  if (config.storageType === 'gist') {
    try {
      const { files: gistFiles, truncated } = await fetchGist(resolveToken(config), config.gistId!);
      fs.mkdirSync(repoDir, { recursive: true });
      writeGistFilesToDir(repoDir, gistFiles);
      if (truncated) {
        heads_up(
          'Your gist has more than 300 files — GitHub only returns the first 300 via its API.\n' +
          '  Some agents, skills, or plugins may not be synced. Consider switching to repo storage.',
        );
      }
      return;
    } catch (err) {
      oops((err as Error).message);
      process.exit(1);
    }
  }
  try {
    pullRepo(repoDir, resolveToken(config), config.repoCloneUrl!);
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

function applyServersToProviders(
  providers: ProviderDefinition[],
  remoteServers: McpServersMap,
): string[] {
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
