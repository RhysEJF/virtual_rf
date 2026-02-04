#!/usr/bin/env node

import { Command } from 'commander';
import { statusCommand, listCommand, showCommand, newCommand, startCommand, stopCommand, updateCommand } from './commands/index.js';

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

program.parse(process.argv);
