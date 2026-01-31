#!/usr/bin/env node

import { Command } from 'commander';
import { statusCommand, listCommand, showCommand, newCommand, startCommand, stopCommand } from './commands/index.js';

const program = new Command();

program
  .name('rf')
  .description('CLI for Digital Twin API - manage outcomes and workers')
  .version('0.1.0');

// Register commands
program.addCommand(statusCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);
program.addCommand(newCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);

program.parse(process.argv);
