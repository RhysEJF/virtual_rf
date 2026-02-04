/**
 * HOMR Command
 *
 * Displays HOMЯ status for an outcome including:
 * - Discoveries (patterns, constraints, insights, blockers)
 * - Decisions made
 * - Pending escalations count
 *
 * Flags:
 * --supervise: Enter live watch mode, polling every 5 seconds
 * --yolo: Auto-resolve escalations and show decisions (implies --supervise)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, HomrEscalation } from '../api.js';
import { addOutputFlags, OutputOptions } from '../utils/flags.js';

/**
 * Formats a timestamp to relative time (e.g., "2h ago", "3d ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Formats discovery type with color
 */
function formatDiscoveryType(type: string): string {
  switch (type) {
    case 'pattern':
      return chalk.blue('[PATTERN]');
    case 'constraint':
      return chalk.yellow('[CONSTRAINT]');
    case 'insight':
      return chalk.cyan('[INSIGHT]');
    case 'blocker':
      return chalk.red('[BLOCKER]');
    default:
      return chalk.gray(`[${type.toUpperCase()}]`);
  }
}

/**
 * Clear terminal and move cursor to top
 */
function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[0f');
}

/**
 * Format timestamp for display
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

interface HomrOptions extends OutputOptions {
  supervise?: boolean;
  yolo?: boolean;
}

/**
 * Display the HOMЯ status (used in both one-shot and supervise modes)
 */
async function displayHomrStatus(
  outcomeId: string,
  options: HomrOptions,
  isSuperviseMode: boolean = false,
  yoloResults?: { resolved: number; deferred: number; lastDecision?: string }
): Promise<{ pendingCount: number; escalations: HomrEscalation[] }> {
  // Fetch HOMЯ context for the outcome
  const context = await api.homr.context(outcomeId);

  // Also fetch escalations to get pending count and details
  const escalationsData = await api.homr.escalations(outcomeId, { pending: true });

  // Handle JSON output (only in non-supervise mode)
  if (options.json && !isSuperviseMode) {
    const data = {
      ...context,
      pendingEscalations: escalationsData.pendingCount,
    };
    console.log(JSON.stringify(data, null, 2));
    return { pendingCount: escalationsData.pendingCount, escalations: escalationsData.escalations };
  }

  // Handle quiet output - summary only (only in non-supervise mode)
  if (options.quiet && !isSuperviseMode) {
    const discoveryCount = context.discoveries.length;
    const decisionCount = context.decisions.length;
    const pendingCount = escalationsData.pendingCount;
    console.log(`${outcomeId}: ${discoveryCount} discoveries, ${decisionCount} decisions, ${pendingCount} pending escalations`);
    return { pendingCount: escalationsData.pendingCount, escalations: escalationsData.escalations };
  }

  // Normal output
  if (isSuperviseMode) {
    clearScreen();
    const modeLabel = options.yolo
      ? chalk.bgYellow.black(' YOLO MODE ')
      : chalk.bgCyan.black(' SUPERVISE ');
    console.log(`${modeLabel} ${chalk.gray(`Last updated: ${formatTime(new Date())} • Ctrl+C to exit`)}`);
    console.log();
  }

  console.log(chalk.bold.white(`HOMЯ Status: ${outcomeId}`));
  console.log();

  // YOLO mode status
  if (options.yolo && yoloResults) {
    console.log(chalk.bold.yellow('🎲 YOLO Auto-Resolve:'));
    console.log(`  ${chalk.green('✓')} Resolved: ${yoloResults.resolved}`);
    console.log(`  ${chalk.gray('○')} Deferred to human: ${yoloResults.deferred}`);
    if (yoloResults.lastDecision) {
      console.log(`  ${chalk.cyan('Last decision:')} ${yoloResults.lastDecision}`);
    }
    console.log();
  }

  // Pending escalations (show first in supervise mode - most important)
  const pendingCount = escalationsData.pendingCount;
  if (isSuperviseMode) {
    if (pendingCount > 0) {
      console.log(chalk.bold.red(`⚠ Pending Escalations: ${pendingCount}`));
      for (const esc of escalationsData.escalations.slice(0, 3)) {
        const question = esc.question?.text || 'Unknown question';
        console.log(`  ${chalk.yellow('•')} ${question.substring(0, 80)}${question.length > 80 ? '...' : ''}`);
        if (esc.question?.options) {
          const optionLabels = esc.question.options.map((o: { label: string }) => o.label).join(' | ');
          console.log(`    ${chalk.gray('Options:')} ${optionLabels}`);
        }
      }
      if (!options.yolo) {
        console.log(chalk.gray(`  Run \`flow escalations --outcome=${outcomeId}\` to respond`));
      }
    } else {
      console.log(chalk.bold.green('✓ No Pending Escalations'));
    }
    console.log();
  }

  // Discoveries section
  const discoveries = context.discoveries;
  console.log(chalk.bold.cyan(`Discoveries (${discoveries.length}):`));
  if (discoveries.length === 0) {
    console.log(chalk.gray('  No discoveries yet'));
  } else {
    const displayCount = isSuperviseMode ? 5 : discoveries.length;
    for (const discovery of discoveries.slice(0, displayCount)) {
      const typeLabel = formatDiscoveryType(discovery.type);
      console.log(`  ${chalk.gray('•')} ${typeLabel} ${chalk.white(discovery.content)}`);
    }
    if (isSuperviseMode && discoveries.length > displayCount) {
      console.log(chalk.gray(`  ... and ${discoveries.length - displayCount} more`));
    }
  }
  console.log();

  // Decisions section
  const decisions = context.decisions;
  console.log(chalk.bold.cyan(`Decisions (${decisions.length}):`));
  if (decisions.length === 0) {
    console.log(chalk.gray('  No decisions made yet'));
  } else {
    const displayCount = isSuperviseMode ? 3 : decisions.length;
    for (const decision of decisions.slice(0, displayCount)) {
      const timeAgo = formatRelativeTime(decision.decidedAt);
      console.log(`  ${chalk.gray('•')} ${chalk.white(decision.answer)} ${chalk.gray(`(${timeAgo})`)}`);
    }
    if (isSuperviseMode && decisions.length > displayCount) {
      console.log(chalk.gray(`  ... and ${decisions.length - displayCount} more`));
    }
  }
  console.log();

  // Pending escalations (at bottom in normal mode)
  if (!isSuperviseMode) {
    console.log(chalk.bold.cyan(`Pending Escalations: ${pendingCount}`));
    if (pendingCount > 0) {
      console.log(chalk.gray(`  Run \`flow escalations --outcome=${outcomeId}\` to view`));
    }
    console.log();
  }

  return { pendingCount: escalationsData.pendingCount, escalations: escalationsData.escalations };
}

const command = new Command('homr')
  .description('Show HOMЯ status for an outcome')
  .argument('<outcome-id>', 'Outcome ID to show HOMЯ status for')
  .option('--supervise', 'Enter live watch mode, polling every 5 seconds')
  .option('--yolo', 'Auto-resolve escalations and show decisions (implies --supervise)');

addOutputFlags(command);

export const homrCommand = command
  .action(async (outcomeId: string, options: HomrOptions) => {
    try {
      // YOLO implies supervise
      if (options.yolo) {
        options.supervise = true;
      }

      // One-shot mode (no supervise)
      if (!options.supervise) {
        await displayHomrStatus(outcomeId, options, false);
        return;
      }

      // Supervise mode - live watch with polling
      console.log(chalk.cyan('Entering supervise mode... Press Ctrl+C to exit'));

      let yoloResults = { resolved: 0, deferred: 0, lastDecision: undefined as string | undefined };

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        console.log();
        console.log(chalk.gray('Exiting supervise mode...'));
        process.exit(0);
      });

      // Initial display
      await displayHomrStatus(outcomeId, options, true, options.yolo ? yoloResults : undefined);

      // Poll every 5 seconds
      setInterval(async () => {
        try {
          // If YOLO mode, try to auto-resolve any pending escalations first
          if (options.yolo) {
            try {
              const autoResult = await api.homr.autoResolve(outcomeId);
              if (autoResult.resolved > 0) {
                yoloResults.resolved += autoResult.resolved;
                // Get the last decision made
                const lastResolved = autoResult.results.find(r => r.resolved);
                if (lastResolved) {
                  yoloResults.lastDecision = `${lastResolved.selectedOption} (${Math.round((lastResolved.confidence || 0) * 100)}% confidence)`;
                }
              }
              yoloResults.deferred += autoResult.deferred;
            } catch {
              // Auto-resolve failed, continue with display
            }
          }

          await displayHomrStatus(outcomeId, options, true, options.yolo ? yoloResults : undefined);
        } catch (error) {
          // On error, show error but keep polling
          console.error(chalk.red('Error fetching status:'), error instanceof Error ? error.message : 'Unknown error');
        }
      }, 5000);

      // Keep the process alive
      await new Promise(() => {}); // Never resolves - exits via SIGINT

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome not found: ${outcomeId}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default homrCommand;
