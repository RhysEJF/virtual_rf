/**
 * Command Management
 *
 * flow commands                                      List all synced commands
 * flow commands rename <integration> <cmd> <new>     Rename a command
 * flow commands exclude <integration> <cmd>          Exclude a command
 * flow commands include <integration> <cmd>          Re-include a command
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  scanIntegrations,
  getCommandRegistry,
  excludeCommand,
  includeCommand,
  renameCommand,
  unreNameCommand,
} from '../tui/integrations.js';

export const commandsCommand = new Command('commands')
  .description('Manage integration commands')
  .action(() => {
    listCommands();
  });

commandsCommand
  .command('rename <integration> <command> <new-name>')
  .description('Rename a command (e.g., /capture → /tw-capture)')
  .action((integration: string, command: string, newName: string) => {
    if (renameCommand(integration, command, newName)) {
      console.log();
      console.log(chalk.green('  ✓'), `Renamed /${command} → /${newName} (from ${integration})`);
      console.log(chalk.gray(`  Takes effect next time you launch flow`));
      console.log();
    } else {
      console.error(chalk.red('  Error:'), `Integration "${integration}" not found`);
      process.exit(1);
    }
  });

commandsCommand
  .command('unrename <integration> <command>')
  .description('Revert a command to its original name')
  .action((integration: string, command: string) => {
    if (unreNameCommand(integration, command)) {
      console.log();
      console.log(chalk.green('  ✓'), `Reverted /${command} to original name (from ${integration})`);
      console.log();
    } else {
      console.log(chalk.gray(`  No rename found for /${command} in ${integration}`));
    }
  });

commandsCommand
  .command('exclude <integration> <command>')
  .description('Exclude a command without disabling the whole integration')
  .action((integration: string, command: string) => {
    if (excludeCommand(integration, command)) {
      console.log();
      console.log(chalk.gray('  ○'), `Excluded /${command} from ${integration}`);
      console.log(chalk.gray(`  Takes effect next time you launch flow`));
      console.log();
    } else {
      console.error(chalk.red('  Error:'), `Integration "${integration}" not found`);
      process.exit(1);
    }
  });

commandsCommand
  .command('include <integration> <command>')
  .description('Re-include a previously excluded command')
  .action((integration: string, command: string) => {
    if (includeCommand(integration, command)) {
      console.log();
      console.log(chalk.green('  ●'), `Re-included /${command} from ${integration}`);
      console.log();
    } else {
      console.log(chalk.gray(`  Not found or not excluded`));
    }
  });

// ============================================================================
// List
// ============================================================================

function listCommands(): void {
  const integrations = scanIntegrations();
  const registry = getCommandRegistry();
  const activeNames = Object.keys(registry).sort();

  console.log();
  console.log(chalk.bold('  Commands'));
  console.log();

  if (activeNames.length === 0 && integrations.every(i => i.commands.length === 0)) {
    console.log(chalk.gray('  No commands from integrations.'));
    console.log(chalk.gray(`  Add commands_source to an integration's skill.md.`));
    console.log();
    return;
  }

  // Show active commands
  if (activeNames.length > 0) {
    console.log(chalk.bold('  Active:'));
    for (const name of activeNames) {
      const owner = registry[name];
      console.log(`    ${chalk.green('●')} ${chalk.bold(`/${name}`)}  ${chalk.gray(`from ${owner}`)}`);
    }
    console.log();
  }

  // Show excluded/renamed commands
  const excluded: Array<{ cmd: string; integration: string; type: 'excluded' | 'renamed'; renamedTo?: string }> = [];

  for (const integration of integrations) {
    if (integration.disabled) continue;

    // Read commands.json for this integration
    const configPath = join(integration.path, 'commands.json');

    let config: { exclude?: string[]; rename?: Record<string, string> } = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch { /* */ }
    }

    if (config.exclude) {
      for (const cmd of config.exclude) {
        excluded.push({ cmd, integration: integration.name, type: 'excluded' });
      }
    }

    if (config.rename) {
      for (const [from, to] of Object.entries(config.rename)) {
        excluded.push({ cmd: from, integration: integration.name, type: 'renamed', renamedTo: to });
      }
    }
  }

  if (excluded.length > 0) {
    console.log(chalk.bold('  Modified:'));
    for (const e of excluded) {
      if (e.type === 'renamed') {
        console.log(`    ${chalk.yellow('↻')} /${e.cmd} → ${chalk.bold(`/${e.renamedTo}`)}  ${chalk.gray(`from ${e.integration}`)}`);
      } else {
        console.log(`    ${chalk.gray('○')} ${chalk.strikethrough(`/${e.cmd}`)}  ${chalk.gray(`from ${e.integration} (excluded)`)}`);
      }
    }
    console.log();
  }

  console.log(chalk.gray('  Manage:'));
  console.log(chalk.gray(`    flow commands rename <integration> <cmd> <new-name>`));
  console.log(chalk.gray(`    flow commands exclude <integration> <cmd>`));
  console.log(chalk.gray(`    flow commands include <integration> <cmd>`));
  console.log();
}
