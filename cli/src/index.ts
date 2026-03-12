#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { statusCommand, listCommand, showCommand, newCommand, startCommand, stopCommand, updateCommand, archiveCommand, taskCommand, tasksCommand, homrCommand, escalationsCommand, answerCommand, dismissCommand, confirmCommand, rejectCommand, chatCommand, skillsCommand, toolsCommand, skillCommand, toolCommand, outputsCommand, filesCommand, workersCommand, workerCommand, interveneCommand, configCommand, syncCommand, retroCommand, reviewCommand, flowPauseCommand, flowResumeCommand, flowLogsCommand, inspectCommand, flowAuditCommand, converseCommand, capabilityCommand, serverCommand, serveCommand, gateCommand, telegramCommand, docsCommand, refineCommand, healthCommand } from './commands/index.js';

const program = new Command();

program
  .name('flow')
  .description('CLI for Flow - manage outcomes and workers')
  .version('0.1.0');

// Register commands
program.addCommand(statusCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);
program.addCommand(newCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(updateCommand);
program.addCommand(archiveCommand);
program.addCommand(taskCommand);
program.addCommand(tasksCommand);
program.addCommand(homrCommand);
program.addCommand(escalationsCommand);
program.addCommand(answerCommand);
program.addCommand(dismissCommand);
program.addCommand(confirmCommand);
program.addCommand(rejectCommand);
program.addCommand(chatCommand);
program.addCommand(skillsCommand);
program.addCommand(toolsCommand);
program.addCommand(skillCommand);
program.addCommand(toolCommand);
program.addCommand(outputsCommand);
program.addCommand(filesCommand);
program.addCommand(workersCommand);
program.addCommand(workerCommand);
program.addCommand(interveneCommand);
program.addCommand(configCommand);
program.addCommand(syncCommand);
program.addCommand(retroCommand);
program.addCommand(reviewCommand);
program.addCommand(flowPauseCommand);
program.addCommand(flowResumeCommand);
program.addCommand(flowLogsCommand);
program.addCommand(inspectCommand);
program.addCommand(flowAuditCommand);
program.addCommand(converseCommand);
program.addCommand(capabilityCommand);
program.addCommand(serverCommand);
program.addCommand(serveCommand);
program.addCommand(gateCommand);
program.addCommand(telegramCommand);
program.addCommand(docsCommand);
program.addCommand(refineCommand);
program.addCommand(healthCommand);

// Command group definitions for --help-all
const COMMAND_GROUPS: Array<{ label: string; commands: string[] }> = [
  {
    label: 'Outcomes',
    commands: ['list', 'show', 'new', 'update', 'archive'],
  },
  {
    label: 'Tasks',
    commands: ['tasks', 'task', 'gate', 'refine'],
  },
  {
    label: 'Workers',
    commands: ['start', 'stop', 'workers', 'worker', 'intervene', 'pause', 'resume', 'logs'],
  },
  {
    label: 'HOMR',
    commands: ['homr', 'escalations', 'answer', 'dismiss', 'confirm', 'reject'],
  },
  {
    label: 'Resources',
    commands: ['skills', 'skill', 'tools', 'tool', 'outputs', 'files', 'docs'],
  },
  {
    label: 'System',
    commands: ['status', 'config', 'sync', 'retro', 'review', 'inspect', 'audit', 'health'],
  },
  {
    label: 'Integrations',
    commands: ['telegram', 'serve', 'server', 'capability'],
  },
  {
    label: 'Interactive',
    commands: ['chat', 'converse'],
  },
];

/**
 * Builds a usage string for a command, including its arguments.
 */
function buildUsage(cmd: Command, prefix: string): string {
  const args = cmd.registeredArguments || [];
  const argStr = args.map((arg: { required: boolean; name: () => string }) => {
    const name = arg.name();
    return arg.required ? `<${name}>` : `[${name}]`;
  }).join(' ');
  return argStr ? `${prefix} ${argStr}` : prefix;
}

interface CommandEntry {
  usage: string;
  description: string;
}

/**
 * Collects a command and its subcommands into entries.
 */
function collectCommandEntries(cmd: Command): CommandEntry[] {
  const entries: CommandEntry[] = [];
  const cmdName = cmd.name();
  const cmdDesc = cmd.description() || '';

  entries.push({
    usage: buildUsage(cmd, `flow ${cmdName}`),
    description: cmdDesc,
  });

  // Check for subcommands
  const subcommands = cmd.commands || [];
  for (const subcmd of subcommands) {
    const subName = subcmd.name();
    const subDesc = subcmd.description() || '';
    entries.push({
      usage: buildUsage(subcmd, `flow ${cmdName} ${subName}`),
      description: subDesc,
    });
  }

  return entries;
}

/**
 * Display all available commands grouped by category.
 */
function showHelpAll(): void {
  console.log();
  console.log(chalk.bold.white('  Flow CLI \u2014 All Commands'));
  console.log();

  // Build a lookup: command name -> Command object
  const cmdMap = new Map<string, Command>();
  for (const cmd of program.commands) {
    cmdMap.set(cmd.name(), cmd);
  }

  // Track which commands have been grouped
  const grouped = new Set<string>();

  // Collect all entries across all groups to find max usage width
  const allGroupEntries: Array<{ label: string; entries: CommandEntry[] }> = [];

  for (const group of COMMAND_GROUPS) {
    const entries: CommandEntry[] = [];
    for (const cmdName of group.commands) {
      const cmd = cmdMap.get(cmdName);
      if (cmd) {
        entries.push(...collectCommandEntries(cmd));
        grouped.add(cmdName);
      }
    }
    if (entries.length > 0) {
      allGroupEntries.push({ label: group.label, entries });
    }
  }

  // Collect ungrouped commands
  const ungrouped: CommandEntry[] = [];
  for (const cmd of program.commands) {
    if (!grouped.has(cmd.name())) {
      ungrouped.push(...collectCommandEntries(cmd));
    }
  }

  // Find max usage width across everything
  const allEntries = allGroupEntries.flatMap(g => g.entries).concat(ungrouped);
  const maxUsageLen = Math.max(...allEntries.map(e => e.usage.length));

  // Print grouped commands
  for (const { label, entries } of allGroupEntries) {
    console.log(chalk.bold.cyan(`  ${label}`));
    for (const { usage, description } of entries) {
      const paddedUsage = usage.padEnd(maxUsageLen + 2);
      console.log(`    ${paddedUsage}${chalk.gray(description)}`);
    }
    console.log();
  }

  // Print ungrouped commands if any
  if (ungrouped.length > 0) {
    console.log(chalk.bold.cyan('  Other'));
    for (const { usage, description } of ungrouped) {
      const paddedUsage = usage.padEnd(maxUsageLen + 2);
      console.log(`    ${paddedUsage}${chalk.gray(description)}`);
    }
    console.log();
  }

  console.log(chalk.gray('  Use --help with any command for more details.'));
  console.log();
}

// Check for --help-all flag before Commander parses
if (process.argv.includes('--help-all')) {
  showHelpAll();
  process.exit(0);
}

program.parse(process.argv);
