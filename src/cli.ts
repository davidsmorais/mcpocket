#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { dedupeCommand } from './commands/dedupe.js';
import { statusCommand } from './commands/status.js';
import { PROVIDER_OPTION_FLAGS } from './clients/providers.js';
import { printBanner, oops } from './utils/sparkle.js';

const program = new Command();

printBanner();

program
  .name('mcpocket')
  .description('Your AI setup. Every pocket.\nSyncs agents, skills, plugins, and MCPs across all your machines like magic.')
  .version('0.1.0');

program
  .command('init')
  .description('Set up mcpocket: connect GitHub, create your sync pocket')
  .action(() => initCommand().catch(die));

program
  .command('push')
  .description('Tuck your AI setup into the cloud pocket')

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
  .command('status')
  .description('Peek inside: what\'s synced, what\'s local, what\'s remote')
  .action(() => statusCommand().catch(die));

program.parse();

function die(err: Error): void {
  oops(err.message);
  process.exit(1);
}
