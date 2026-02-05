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
import { api, ApiError, NetworkError } from '../api.js';

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

// Subcommand: config isolation-mode [mode]
const isolationModeCommand = new Command('isolation-mode')
  .description('View or set the default isolation mode for new outcomes')
  .argument('[mode]', 'Mode to set: "workspace" (isolated) or "codebase" (can modify main)');

addOutputFlags(isolationModeCommand);

isolationModeCommand.action(async (mode: string | undefined, options: OutputOptions) => {
  try {
    if (mode) {
      // Setting the mode
      if (mode !== 'workspace' && mode !== 'codebase') {
        console.error(chalk.red('Error:'), 'Invalid mode. Must be "workspace" or "codebase"');
        process.exit(1);
      }

      // Update via API
      const result = await api.config.update({ default_isolation_mode: mode });

      // Handle JSON output
      if (handleOutput(result, options)) {
        return;
      }

      const modeLabel = mode === 'workspace' ? 'Workspace (Isolated)' : 'Codebase';
      const modeColor = mode === 'workspace' ? chalk.green : chalk.yellow;
      console.log();
      console.log(chalk.green('✓'), `Default isolation mode set to: ${modeColor(modeLabel)}`);
      console.log();
      console.log(chalk.gray('New outcomes will use this mode by default.'));
      console.log(chalk.gray('Override per-outcome with: flow new --isolated or --allow-codebase'));
      console.log();
    } else {
      // Getting the current mode
      const config = await api.config.get();

      // Handle JSON output
      if (handleOutput(config, options)) {
        return;
      }

      const currentMode = config.default_isolation_mode || 'workspace';
      const modeLabel = currentMode === 'workspace' ? 'Workspace (Isolated)' : 'Codebase';
      const modeColor = currentMode === 'workspace' ? chalk.green : chalk.yellow;

      console.log();
      console.log(chalk.bold('Default Isolation Mode'));
      console.log();
      console.log(`  Current: ${modeColor(modeLabel)}`);
      console.log();
      console.log(chalk.gray('Workspace:'), 'Outcomes work in isolated workspace directories');
      console.log(chalk.gray('Codebase: '), 'Outcomes can modify the main codebase');
      console.log();
      console.log(chalk.gray('Set with: flow config isolation-mode <workspace|codebase>'));
      console.log();
    }
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      console.error(chalk.red('API Error:'), error.message);
      process.exit(1);
    }
    throw error;
  }
});

command.addCommand(isolationModeCommand);

export const configCommand = command;
export default configCommand;
