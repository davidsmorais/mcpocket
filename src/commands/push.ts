import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig, getLocalRepoDir, resolveToken, writeConfig } from '../config.js';
import { pullRepo, commitAndPush, ensureGitConfig } from '../storage/github.js';
import { collectFilesFromDir, updateGist } from '../storage/gist.js';
import { mergeMcpSources, buildPortableConfig } from '../sync/mcp.js';
import type { McpServersMap } from '../clients/types.js';
import { discoverGlobalInventory, discoverProjectInventory } from '../sync/inventory.js';
import type { InventoryItem } from '../sync/inventory.js';
import { writeInventoryItems, prunePocketUsingManifest } from '../sync/inventory-writer.js';
import { readManifest, writeManifest, emptyManifest } from '../sync/manifest.js';
import { pickInventoryItems } from './tree-select.js';
import { formatProviderList, resolveProviderSelection } from './provider-options.js';
import type { ProviderFlagOptions } from './provider-options.js';
import { askSecret, ask } from '../utils/prompt.js';
import { readProjectConfig, PROJECT_CONFIG_FILENAME } from '../sync/project.js';
import { sparkle, celebrate, section, stat, oops, heads_up, WITTY, c, subItem } from '../utils/sparkle.js';

export async function pushCommand(
  options: ProviderFlagOptions & {
    interactive?: boolean;
    ui?: boolean;
    exclude?: boolean;
    project?: boolean;
    all?: boolean;
  } = {},
): Promise<void> {
  const config = readConfig();
  const repoDir = getLocalRepoDir();

  const selection = resolveProviderSelection(options, config.syncProviders);

  section('Push');
  if (selection.isFiltered) {
    sparkle(`MCP scope: ${formatProviderList(selection.selected)}`);
  }

  preparePocketDirectory(config.storageType, repoDir, resolveToken(config), config.repoCloneUrl);

  // ── Discover inventory ─────────────────────────────────────────────────────
  sparkle('Scanning local AI configs...');
  const globalItems = discoverGlobalInventory();

  let projectItems: InventoryItem[] = [];
  let projectName: string | undefined;
  const cwd = process.cwd();
  const projectConfigPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
  if (options.project || fs.existsSync(projectConfigPath)) {
    let defaultName = path.basename(cwd);
    if (fs.existsSync(projectConfigPath)) {
      try {
        defaultName = readProjectConfig().projectName || defaultName;
      } catch {
        // Invalid project config should not block explicit --project discovery.
      }
    }
    const answer = options.all ? defaultName : await ask(`  Project name [${defaultName}]: `);
    projectName = (answer || '').trim() || defaultName;
    projectItems = discoverProjectInventory(cwd, projectName);
  }

  const allItems = [...globalItems, ...projectItems];
  sparkle(`Found ${globalItems.length} global item(s)${projectItems.length ? ` + ${projectItems.length} project item(s)` : ''}`);

  // ── Pick items ─────────────────────────────────────────────────────────────
  let selectedIds: Set<string>;
  if (options.all) {
    selectedIds = new Set(allItems.map((i) => i.id));
  } else {
    selectedIds = await pickInventoryItems('What would you like to sync?', allItems);
    if (selectedIds.size === 0) {
      heads_up('Nothing selected — exiting without pushing.');
      return;
    }
  }
  const selectedItems = allItems.filter((i) => selectedIds.has(i.id));

  // ── Copy to pocket + write manifest ────────────────────────────────────────
  sparkle(`Copying ${selectedItems.length} file(s) into the pocket...`);
  const previousManifest = readManifest(repoDir);
  const { copied, entries } = writeInventoryItems(selectedItems, repoDir);
  const removed = prunePocketUsingManifest(repoDir, previousManifest, entries);

  const manifest = emptyManifest();
  manifest.entries = entries;
  writeManifest(repoDir, manifest);

  if (removed > 0) {
    sparkle(`Pruned ${removed} stale pocket entr${removed === 1 ? 'y' : 'ies'}`);
  }

  // ── MCPs (kept on legacy path: encrypt + write mcp-config.json) ────────────
  let serverCount = 0;
  // MCPs are pushed alongside selected items unless the user explicitly excluded
  // them via provider flags. The tree picker is for files; MCPs ride along.
  const includeMcps = true;
  if (includeMcps) {
    sparkle(WITTY.readingMCP);
    const allMcps: McpServersMap = mergeMcpSources(...selection.selected.map((p) => p.readMcpServers()));
    serverCount = Object.keys(allMcps).length;
    if (serverCount > 0) {
      const passphrase = await promptForPushPassphrase();
      sparkle(WITTY.encrypting);
      const portableConfig = buildPortableConfig(allMcps, passphrase);
      fs.writeFileSync(path.join(repoDir, 'mcp-config.json'), JSON.stringify(portableConfig, null, 2), 'utf8');
    }
  }

  // ── Persist project name in global config ──────────────────────────────────
  if (projectName && projectItems.length > 0) {
    const updatedConfig = {
      ...config,
      projects: {
        ...(config.projects || {}),
        [projectName]: projectItems.map((i) => i.pocketPath),
      },
    };
    writeConfig(updatedConfig);
  }

  // ── Push to remote ─────────────────────────────────────────────────────────
  sparkle(WITTY.pushing);
  if (config.storageType === 'gist') {
    try {
      const files = collectFilesFromDir(repoDir);
      await updateGist(resolveToken(config), config.gistId!, files);
      celebrate(WITTY.pushDone);
      heads_up(`Pocket URL: ${c.cyan(config.gistUrl!)}  ← save this to connect from another machine!`);
    } catch (err) {
      oops(`Gist push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    ensureGitConfig(repoDir);
    try {
      commitAndPush(repoDir, resolveToken(config), config.repoCloneUrl!, 'mcpocket: push');
      celebrate(WITTY.pushDone);
    } catch (err) {
      oops(`Push failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  section('Summary');
  stat('Storage', config.storageType === 'gist' ? `gist (${config.gistUrl})` : `repo (${config.repoHtmlUrl})`);
  subItem('Items copied', { check: copied > 0, value: `${copied} file(s)` });
  subItem('MCPs', { check: serverCount > 0, value: `${serverCount} server(s)` });
  subItem('Manifest', { check: true, value: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` });
  console.log('');
}

function preparePocketDirectory(
  storageType: 'repo' | 'gist',
  repoDir: string,
  githubToken: string,
  repoCloneUrl?: string,
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
    oops("Passphrases don't match. Give it another whirl!");
    process.exit(1);
  }
  return passphrase;
}
