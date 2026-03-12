/**
 * Progress Bar Utilities
 *
 * Renders inline progress bars using block characters.
 */

import chalk from 'chalk';

const BAR_WIDTH = 16;
const FILLED_CHAR = '\u2588'; // full block
const EMPTY_CHAR = '\u2591'; // light shade

/**
 * Renders an inline progress bar.
 *
 * Example output: ████████░░░░░░░░ 50% (6/12)
 *
 * @param completed - Number of completed items
 * @param total - Total number of items
 * @returns Formatted progress bar string
 */
export function progressBar(completed: number, total: number): string {
  if (total === 0) {
    return chalk.gray(`${EMPTY_CHAR.repeat(BAR_WIDTH)} 0%`);
  }

  const ratio = Math.min(completed / total, 1);
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const percent = Math.round(ratio * 100);

  const filledStr = chalk.green(FILLED_CHAR.repeat(filled));
  const emptyStr = chalk.gray(EMPTY_CHAR.repeat(empty));

  return `${filledStr}${emptyStr} ${percent}% (${completed}/${total})`;
}
