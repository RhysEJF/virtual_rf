/**
 * Terminal Spinner Utility
 *
 * Simple spinning indicator for async operations.
 * Gracefully handles non-TTY environments (pipes).
 */

import chalk from 'chalk';

const FRAMES = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
const INTERVAL_MS = 80;

interface Spinner {
  /** Stop the spinner and optionally print a final message. */
  stop: (finalMessage?: string) => void;
}

/**
 * Creates and starts a terminal spinner.
 *
 * In non-TTY environments (e.g., piped output), the spinner is not shown.
 *
 * @param message - Text to display next to the spinner
 * @returns Object with a stop() method
 */
export function createSpinner(message: string): Spinner {
  const isTTY = process.stderr.isTTY;

  if (!isTTY) {
    // Non-TTY: don't show spinner, just provide a no-op stop
    return {
      stop: (_finalMessage?: string): void => {
        // No output in non-TTY mode
      },
    };
  }

  let frameIndex = 0;
  let stopped = false;

  const interval = setInterval(() => {
    if (stopped) return;
    const frame = chalk.cyan(FRAMES[frameIndex % FRAMES.length]);
    process.stderr.write(`\r  ${frame} ${message}`);
    frameIndex++;
  }, INTERVAL_MS);

  return {
    stop: (finalMessage?: string): void => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      // Clear the spinner line
      process.stderr.write('\r' + ' '.repeat(message.length + 10) + '\r');
      if (finalMessage) {
        process.stderr.write(`  ${finalMessage}\n`);
      }
    },
  };
}
