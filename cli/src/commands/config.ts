/**
 * Config Command
 *
 * View and modify CLI configuration settings stored in ~/.flowconfig
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

const CONFIG_PATH = join(homedir(), '.flowconfig');

interface FlowConfig {
  api_url?: string;
  default_format?: string;
  color?: boolean;
  [key: string]: unknown;
}

const DEFAULT_CONFIG: FlowConfig = {
  api_url: 'http://localhost:3000/api',
  default_format: 'table',
  color: true,
};

function loadConfig(): FlowConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: FlowConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function parseValue(value: string): unknown {
  // Try to parse as JSON (handles booleans, numbers, etc.)
  try {
    return JSON.parse(value);
  } catch {
    // Return as string if not valid JSON
    return value;
  }
}

const command = new Command('config')
  .description('View and modify CLI configuration');

addOutputFlags(command);

// Main config command - show all settings
command.action(async (options: OutputOptions) => {
  const config = loadConfig();

  // Handle JSON output
  if (handleOutput(config, options)) {
    return;
  }

  // Display configuration
  console.log();
  console.log(chalk.bold(`Configuration (${CONFIG_PATH})`));
  console.log();

  // Find longest key for alignment
  const keys = Object.keys(config);
  const maxKeyLength = Math.max(...keys.map(k => k.length));

  for (const [key, value] of Object.entries(config)) {
    const paddedKey = key.padEnd(maxKeyLength + 2);
    const displayValue = typeof value === 'boolean'
      ? (value ? chalk.green('true') : chalk.red('false'))
      : chalk.white(String(value));
    console.log(`  ${chalk.cyan(paddedKey)}${displayValue}`);
  }

  console.log();
});

// Subcommand: config set <key> <value>
const setCommand = new Command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key to set')
  .argument('<value>', 'Value to set');

addOutputFlags(setCommand);

setCommand.action(async (key: string, value: string, options: OutputOptions) => {
  const config = loadConfig();
  const parsedValue = parseValue(value);

  config[key] = parsedValue;
  saveConfig(config);

  // Handle JSON output
  if (handleOutput({ key, value: parsedValue, config }, options)) {
    return;
  }

  console.log();
  console.log(chalk.green('✓'), `Set ${chalk.cyan(key)} = ${chalk.white(String(parsedValue))}`);
  console.log();
});

command.addCommand(setCommand);

export const configCommand = command;
export default configCommand;
