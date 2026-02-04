#!/usr/bin/env node

import { Command } from 'commander';
import { statusCommand, listCommand, showCommand, newCommand, startCommand, stopCommand, updateCommand, archiveCommand, taskCommand, tasksCommand, homrCommand, escalationsCommand, answerCommand, dismissCommand, chatCommand, skillsCommand, toolsCommand, skillCommand, toolCommand, outputsCommand, filesCommand, workersCommand, workerCommand, interveneCommand, configCommand, syncCommand, retroCommand, flowPauseCommand, flowResumeCommand, flowLogsCommand } from './commands/index.js';

const program = new Command();

program
  .name('flow')
  .description('CLI for Digital Twin API - manage outcomes and workers')
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
program.addCommand(flowPauseCommand);
program.addCommand(flowResumeCommand);
program.addCommand(flowLogsCommand);

/**
 * Display all available commands with their descriptions
 */
function showHelpAll(): void {
  console.log();
  console.log('Available Commands:');
  console.log();

  // Collect all commands with their info
  interface CommandInfo {
    usage: string;
    description: string;
  }

  const commands: CommandInfo[] = [];

  // Process top-level commands
  for (const cmd of program.commands) {
    const cmdName = cmd.name();
    const cmdDesc = cmd.description() || '';

    // Get command usage (name + arguments)
    const args = cmd.registeredArguments || [];
    const argStr = args.map((arg: { required: boolean; name: () => string }) => {
      const name = arg.name();
      return arg.required ? `<${name}>` : `[${name}]`;
    }).join(' ');

    const usage = argStr ? `flow ${cmdName} ${argStr}` : `flow ${cmdName}`;
    commands.push({ usage, description: cmdDesc });

    // Check for subcommands
    const subcommands = cmd.commands || [];
    for (const subcmd of subcommands) {
      const subName = subcmd.name();
      const subDesc = subcmd.description() || '';

      const subArgs = subcmd.registeredArguments || [];
      const subArgStr = subArgs.map((arg: { required: boolean; name: () => string }) => {
        const name = arg.name();
        return arg.required ? `<${name}>` : `[${name}]`;
      }).join(' ');

      const subUsage = subArgStr
        ? `flow ${cmdName} ${subName} ${subArgStr}`
        : `flow ${cmdName} ${subName}`;
      commands.push({ usage: subUsage, description: subDesc });
    }
  }

  // Find the longest usage string for alignment
  const maxUsageLen = Math.max(...commands.map(c => c.usage.length));

  // Print commands
  for (const { usage, description } of commands) {
    const paddedUsage = usage.padEnd(maxUsageLen + 2);
    console.log(`  ${paddedUsage}${description}`);
  }

  console.log();
  console.log('Use --help with any command for more details.');
  console.log();
}

// Check for --help-all flag before Commander parses
if (process.argv.includes('--help-all')) {
  showHelpAll();
  process.exit(0);
}

program.parse(process.argv);
