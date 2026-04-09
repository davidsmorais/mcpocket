#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('carry-on')
  .description('Your AI setup. Everywhere you work.\nSyncs Claude Code agents, skills, plugins, and MCPs across machines.')
  .version('0.1.0');

program
  .command('init')
  .description('Set up carry-on: connect GitHub, create sync repo')
  .action(() => initCommand().catch(die));

program
  .command('push')
  .description('Upload your current AI setup to the cloud')
  .action(() => pushCommand().catch(die));

program
  .command('pull')
  .description('Restore your AI setup from the cloud')
  .action(() => pullCommand().catch(die));

program
  .command('status')
  .description('Show what\'s synced vs. local-only vs. remote-only')
  .action(() => statusCommand().catch(die));

program.parse();

function die(err: Error): void {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
}
