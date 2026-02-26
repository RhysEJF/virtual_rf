/**
 * Telegram Command
 *
 * Start/stop the Telegram bot from anywhere.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';

const TELEGRAM_DIR = process.env.HOME + '/claude-code-telegram';
const LOG_FILE = '/tmp/telegram-bot.log';

function findBotProcess(): number | null {
  try {
    const output = execSync('ps aux', { encoding: 'utf-8' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('-m src.main') && !line.includes('grep')) {
        const parts = line.trim().split(/\s+/);
        return parseInt(parts[1], 10);
      }
    }
  } catch {
    // ps failed
  }
  return null;
}

export const telegramCommand = new Command('telegram')
  .description('Manage the Telegram bot')
  .addCommand(
    new Command('start')
      .description('Start the Telegram bot')
      .action(async () => {
        if (!existsSync(TELEGRAM_DIR)) {
          console.error(chalk.red('Error:'), 'Telegram bot not found');
          console.error(chalk.gray(`Expected at: ${TELEGRAM_DIR}`));
          process.exit(1);
        }

        const existing = findBotProcess();
        if (existing) {
          console.log(chalk.yellow('Telegram bot is already running'), chalk.gray(`(PID ${existing})`));
          return;
        }

        console.log(chalk.cyan('Starting Telegram bot...'));

        const bot = spawn('poetry', ['run', 'python', '-m', 'src.main'], {
          cwd: TELEGRAM_DIR,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            CLAUDECODE: '', // Must unset or Claude CLI refuses to spawn
          },
          shell: true,
        });

        // Redirect output to log file
        const fs = await import('fs');
        const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
        bot.stdout?.pipe(logStream);
        bot.stderr?.pipe(logStream);

        bot.unref();

        // Give it a moment to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        const pid = findBotProcess();
        if (pid) {
          console.log(chalk.green('Telegram bot started'), chalk.gray(`(PID ${pid})`));
          console.log(chalk.gray(`Logs: ${LOG_FILE}`));
        } else {
          console.error(chalk.red('Bot may have failed to start.'), chalk.gray(`Check ${LOG_FILE}`));
        }
      })
  )
  .addCommand(
    new Command('stop')
      .description('Stop the Telegram bot')
      .action(() => {
        const pid = findBotProcess();
        if (!pid) {
          console.log(chalk.yellow('Telegram bot is not running.'));
          return;
        }

        try {
          process.kill(pid, 'SIGTERM');
          console.log(chalk.green('Telegram bot stopped'), chalk.gray(`(PID ${pid})`));
        } catch (err) {
          console.error(chalk.red('Failed to stop bot:'), err);
        }
      })
  )
  .addCommand(
    new Command('status')
      .description('Check if the Telegram bot is running')
      .action(() => {
        const pid = findBotProcess();
        if (pid) {
          console.log(chalk.green('● Running'), chalk.gray(`(PID ${pid})`));
        } else {
          console.log(chalk.gray('○ Stopped'));
        }
      })
  )
  .action(() => {
    // Default action (no subcommand) — show status then start if not running
    const pid = findBotProcess();
    if (pid) {
      console.log(chalk.green('● Telegram bot is running'), chalk.gray(`(PID ${pid})`));
    } else {
      console.log(chalk.gray('Telegram bot is not running.'));
      console.log(chalk.gray('Use'), chalk.cyan('flow telegram start'), chalk.gray('to start it.'));
    }
  });

export default telegramCommand;
