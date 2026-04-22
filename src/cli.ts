#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { dedupeCommand } from './commands/dedupe.js';
import { cleanupCommand } from './commands/cleanup.js';
import { statusCommand } from './commands/status.js';
import { setCommand } from './commands/set.js';
import { PROVIDER_OPTION_FLAGS } from './clients/providers.js';
import { printBanner, oops } from './utils/sparkle.js';

const program = new Command();

printBanner();

program
  .name('mcpocket')
  .description('Your AI setup. Every pocket.\nSyncs agents, skills, plugins, and MCPs across all your machines like magic.')
  .version('0.3.1');

program
  .command('init')
  .description('Set up mcpocket: connect GitHub, create your sync pocket')
  .option('--ui', 'Open a browser UI on port 3000 to select individual agents, skills, and plugins')
  .option('--project', 'Initialize mcpocket for this project directory (creates mcpocket.json)')
  .action((options) => initCommand(options).catch(die));

program
  .command('push')
  .description('Tuck your AI setup into the cloud pocket')
  .option('-i, --interactive', 'Pick specific items to sync (keyboard UI)')
  .option('--ui', 'Open a browser UI on port 3000 to select items to sync')
  .option('-e, --exclude', 'Open a browser UI to select items to EXCLUDE from sync')
  .option('--project', 'Push project-level files from this directory to your pocket')

for (const provider of PROVIDER_OPTION_FLAGS) {
  program.commands.find((command) => command.name() === 'push')?.option(provider.flag, provider.description);
}

program
  .commands
  .find((command) => command.name() === 'push')
  ?.action((options) => pushCommand(options).catch(die));

program
  .command('pull')
  .description('Unpack your AI setup from the cloud pocket')
  .option('-i, --interactive', 'Assign each gist file to a destination (project > provider > tool)')
  .option('--ui', 'Open a browser UI to assign each gist file to a destination (project > provider > tool)')
  .option('-e, --exclude', 'Open a browser UI to select items to EXCLUDE from sync')
  .option('--project', 'Pull project-level files from your pocket to this directory')

for (const provider of PROVIDER_OPTION_FLAGS) {
  program.commands.find((command) => command.name() === 'pull')?.option(provider.flag, provider.description);
}

program
  .commands
  .find((command) => command.name() === 'pull')
  ?.action((options) => pullCommand(options).catch(die));

program
  .command('de-dupe')
  .alias('dedupe')
  .description('Clean stale synced files from your pocket and local folders')
  .action(() => dedupeCommand().catch(die));

program
  .command('cleanup')
  .description('Remove unwanted files from your pocket (interactive or pattern-based)')
  .option('-l, --local', 'Operate on local pocket only — no pull/push; uses patterns from mcpocket.json')
  .option('--dry-run', 'Preview which files would be deleted without making any changes')
  .option('-y, --yes', 'Skip the confirmation prompt and delete immediately')
  .action((options) => cleanupCommand(options).catch(die));

program
  .command('set')
  .description('Switch your pocket — choose a repo or gist from your GitHub account')
  .action(() => setCommand().catch(die));

program
  .command('status')
  .description('Peek inside: what\'s synced, what\'s local, what\'s remote')
  .action(() => statusCommand().catch(die));

program.parse();

function die(err: Error): void {
  oops(err.message);
  process.exit(1);
}
