/**
 * Serve Command
 *
 * Manages dev servers for workspace apps.
 * Lists, starts, and stops servers for outcome workspaces.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, DetectedApp, RunningServer } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

// ============================================================================
// Helper Functions
// ============================================================================

function formatStatus(status: string): string {
  switch (status) {
    case 'running':
      return chalk.green(status);
    case 'starting':
      return chalk.yellow(status);
    case 'stopped':
      return chalk.gray(status);
    case 'error':
      return chalk.red(status);
    default:
      return status;
  }
}

function formatType(type: string, framework?: string): string {
  if (framework) {
    return chalk.cyan(framework);
  }
  return type === 'node' ? chalk.blue('Node.js') : chalk.magenta('Static');
}

function displayApp(app: DetectedApp, server?: RunningServer): void {
  const status = server ? formatStatus(server.status) : chalk.gray('stopped');
  const type = formatType(app.type, app.framework);

  console.log(`  ${chalk.bold(app.name)}`);
  console.log(`    ${chalk.gray('ID:')} ${app.id}`);
  console.log(`    ${chalk.gray('Type:')} ${type}`);
  console.log(`    ${chalk.gray('Path:')} ${app.path}`);
  console.log(`    ${chalk.gray('Status:')} ${status}`);

  if (server && server.status === 'running') {
    console.log(`    ${chalk.gray('URL:')} ${chalk.cyan(server.url)}`);
    console.log(`    ${chalk.gray('PID:')} ${server.pid}`);
  }

  if (server?.error) {
    console.log(`    ${chalk.gray('Error:')} ${chalk.red(server.error)}`);
  }

  console.log();
}

// ============================================================================
// Main Command
// ============================================================================

const command = new Command('serve')
  .description('Manage dev servers for workspace apps');

addOutputFlags(command);

// Default action: list servers for an outcome
command
  .argument('<outcome>', 'Outcome ID to manage servers for')
  .action(async (outcomeId: string, options: OutputOptions) => {
    try {
      const result = await api.servers.get(outcomeId);

      // Handle JSON output
      if (handleOutput(result, options)) {
        return;
      }

      console.log();
      console.log(chalk.bold(`Workspace Apps for ${chalk.cyan(outcomeId)}`));
      console.log();

      if (result.apps.length === 0) {
        console.log(chalk.gray('  No apps detected in workspace'));
        console.log();
        return;
      }

      // Match servers to apps
      const serverMap = new Map(result.servers.map(s => [s.appId, s]));

      for (const app of result.apps) {
        const server = serverMap.get(app.id);
        displayApp(app, server);
      }

      // Summary
      const runningCount = result.servers.filter(s => s.status === 'running').length;
      if (runningCount > 0) {
        console.log(chalk.green(`${runningCount} server(s) running`));
      } else {
        console.log(chalk.gray('No servers running'));
        console.log(chalk.gray(`Start with: flow serve start ${outcomeId}`));
      }
      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('API Error:'), error.message);
        if (error.status === 404) {
          console.error(chalk.gray('Outcome not found'));
        }
        process.exit(1);
      }
      throw error;
    }
  });

// ============================================================================
// Subcommand: serve start
// ============================================================================

interface StartOptions extends OutputOptions {
  app?: string;
}

const startCommand = new Command('start')
  .description('Start a dev server for a workspace app')
  .argument('<outcome>', 'Outcome ID')
  .option('-a, --app <appId>', 'Specific app ID to start (defaults to first app)');

addOutputFlags(startCommand);

startCommand.action(async (outcomeId: string, options: StartOptions) => {
  try {
    if (!options.json && !options.quiet) {
      console.log();
      console.log(chalk.gray('Starting server...'));
    }

    const result = await api.servers.start(outcomeId, options.app);

    // Handle JSON output
    if (handleOutput(result, options)) {
      return;
    }

    if (result.success) {
      console.log();
      console.log(chalk.green('✓'), result.message);

      if (result.server.status === 'running') {
        console.log();
        console.log(`  ${chalk.gray('URL:')} ${chalk.cyan(result.server.url)}`);
        console.log(`  ${chalk.gray('PID:')} ${result.server.pid}`);
      } else if (result.server.status === 'starting') {
        console.log();
        console.log(chalk.yellow('  Server is starting up...'));
        console.log(`  ${chalk.gray('Check with:')} flow serve ${outcomeId}`);
      }

      console.log();
    } else {
      console.error(chalk.red('Failed to start server'));
      process.exit(1);
    }

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      console.error(chalk.red('API Error:'), error.message);
      if (error.status === 404) {
        console.error(chalk.gray('Outcome not found'));
      } else if (error.status === 400) {
        console.error(chalk.gray('No apps found in workspace or invalid app ID'));
      }
      process.exit(1);
    }
    throw error;
  }
});

command.addCommand(startCommand);

// ============================================================================
// Subcommand: serve stop
// ============================================================================

interface StopOptions extends OutputOptions {
  app?: string;
  all?: boolean;
}

const stopCommand = new Command('stop')
  .description('Stop a running dev server')
  .argument('<outcome>', 'Outcome ID')
  .option('-a, --app <appId>', 'Specific app ID to stop')
  .option('--all', 'Stop all servers for this outcome');

addOutputFlags(stopCommand);

stopCommand.action(async (outcomeId: string, options: StopOptions) => {
  try {
    if (!options.json && !options.quiet) {
      console.log();
      console.log(chalk.gray('Stopping server...'));
    }

    // If --all or no specific app, stop all for outcome
    const appId = options.all ? undefined : options.app;
    const result = await api.servers.stop(outcomeId, appId);

    // Handle JSON output
    if (handleOutput(result, options)) {
      return;
    }

    console.log();
    if (result.success) {
      console.log(chalk.green('✓'), result.message);
    } else {
      console.log(chalk.yellow('ℹ'), result.message);
    }
    console.log();

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

command.addCommand(stopCommand);

// ============================================================================
// Subcommand: serve list (alias for default)
// ============================================================================

const listCommand = new Command('list')
  .description('List apps and servers for an outcome')
  .argument('<outcome>', 'Outcome ID');

addOutputFlags(listCommand);

listCommand.action(async (outcomeId: string, options: OutputOptions) => {
  // Delegate to main command action
  try {
    const result = await api.servers.get(outcomeId);

    // Handle JSON output
    if (handleOutput(result, options)) {
      return;
    }

    console.log();
    console.log(chalk.bold(`Workspace Apps for ${chalk.cyan(outcomeId)}`));
    console.log();

    if (result.apps.length === 0) {
      console.log(chalk.gray('  No apps detected in workspace'));
      console.log();
      return;
    }

    const serverMap = new Map(result.servers.map(s => [s.appId, s]));

    for (const app of result.apps) {
      const server = serverMap.get(app.id);
      displayApp(app, server);
    }

    const runningCount = result.servers.filter(s => s.status === 'running').length;
    if (runningCount > 0) {
      console.log(chalk.green(`${runningCount} server(s) running`));
    } else {
      console.log(chalk.gray('No servers running'));
    }
    console.log();

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      process.exit(1);
    }
    if (error instanceof ApiError) {
      console.error(chalk.red('API Error:'), error.message);
      process.exit(1);
    }
    throw error;
  }
});

command.addCommand(listCommand);

export const serveCommand = command;
export default serveCommand;
