/**
 * Server Command
 *
 * Start the Digital Twin Next.js dev server from anywhere.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

// Find the project root (CLI is at /project/cli, so root is one level up)
function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // From cli/dist/commands/server.js -> cli/dist -> cli -> project root
  const projectRoot = resolve(__dirname, '..', '..', '..');
  return projectRoot;
}

export const serverCommand = new Command('server')
  .description('Start the Digital Twin dev server')
  .option('-p, --port <port>', 'Port to run on', '3000')
  .action(async (options: { port: string }) => {
    const projectRoot = getProjectRoot();
    const packageJson = resolve(projectRoot, 'package.json');

    if (!existsSync(packageJson)) {
      console.error(chalk.red('Error:'), 'Could not find project root');
      console.error(chalk.gray(`Expected at: ${projectRoot}`));
      process.exit(1);
    }

    console.log(chalk.cyan('Starting Digital Twin server...'));
    console.log(chalk.gray(`Directory: ${projectRoot}`));
    console.log(chalk.gray(`Port: ${options.port}`));
    console.log();
    console.log(chalk.gray('Press Ctrl+C to stop'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log();

    // Spawn npm run dev in the project root
    const server = spawn('npm', ['run', 'dev'], {
      cwd: projectRoot,
      stdio: 'inherit', // Pass through all output
      env: {
        ...process.env,
        PORT: options.port,
      },
      shell: true,
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      server.kill('SIGINT');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      server.kill('SIGTERM');
      process.exit(0);
    });

    server.on('close', (code) => {
      process.exit(code || 0);
    });

    server.on('error', (err) => {
      console.error(chalk.red('Error:'), `Failed to start server: ${err.message}`);
      process.exit(1);
    });
  });

export default serverCommand;
