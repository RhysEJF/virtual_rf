/**
 * Box-drawn Table Utilities
 *
 * Renders tables with Unicode box-drawing characters for clean CLI output.
 */

import chalk from 'chalk';

// Box drawing characters
const BOX = {
  topLeft: '\u250c',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
  horizontal: '\u2500',
  vertical: '\u2502',
  teeDown: '\u252c',
  teeUp: '\u2534',
  teeRight: '\u251c',
  teeLeft: '\u2524',
  cross: '\u253c',
} as const;

/**
 * Strips ANSI escape codes from a string to get its visual width.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Pads a string to a visual width, accounting for ANSI escape codes.
 */
function padToWidth(str: string, width: number): string {
  const visualLen = stripAnsi(str).length;
  if (visualLen >= width) return str;
  return str + ' '.repeat(width - visualLen);
}

/**
 * Truncates a string to fit within a visual width, accounting for ANSI codes.
 */
function truncateToWidth(str: string, width: number): string {
  const stripped = stripAnsi(str);
  if (stripped.length <= width) return str;
  // Simple truncation: strip ANSI, truncate, and re-apply no styling
  return stripped.substring(0, width - 1) + '\u2026';
}

interface TableOptions {
  /** Optional column widths. Auto-calculated if not provided. */
  columnWidths?: number[];
  /** Indent the table by this many spaces. Default: 2 */
  indent?: number;
}

/**
 * Renders a box-drawn table to stdout.
 *
 * @param headers - Column header strings
 * @param rows - Array of row data (each row is string[])
 * @param options - Optional configuration
 */
export function drawTable(
  headers: string[],
  rows: string[][],
  options: TableOptions = {}
): void {
  const indent = ' '.repeat(options.indent ?? 2);

  // Calculate column widths
  const widths: number[] = options.columnWidths
    ? [...options.columnWidths]
    : headers.map((h, i) => {
        const headerLen = stripAnsi(h).length;
        const maxDataLen = rows.reduce((max, row) => {
          const cellLen = row[i] ? stripAnsi(row[i]).length : 0;
          return Math.max(max, cellLen);
        }, 0);
        return Math.max(headerLen, maxDataLen) + 2; // +2 for padding
      });

  // Ensure minimum width for each column
  for (let i = 0; i < widths.length; i++) {
    widths[i] = Math.max(widths[i], stripAnsi(headers[i]).length + 2);
  }

  const dim = (s: string): string => chalk.dim(s);

  // Build horizontal lines
  const topLine = dim(BOX.topLeft) +
    widths.map(w => dim(BOX.horizontal.repeat(w))).join(dim(BOX.teeDown)) +
    dim(BOX.topRight);

  const midLine = dim(BOX.teeRight) +
    widths.map(w => dim(BOX.horizontal.repeat(w))).join(dim(BOX.cross)) +
    dim(BOX.teeLeft);

  const bottomLine = dim(BOX.bottomLeft) +
    widths.map(w => dim(BOX.horizontal.repeat(w))).join(dim(BOX.teeUp)) +
    dim(BOX.bottomRight);

  // Print top border
  console.log(`${indent}${topLine}`);

  // Print header row
  const headerCells = headers.map((h, i) => {
    const cell = ` ${padToWidth(chalk.bold(h), widths[i] - 1)}`;
    return cell;
  });
  console.log(`${indent}${dim(BOX.vertical)}${headerCells.join(dim(BOX.vertical))}${dim(BOX.vertical)}`);

  // Print header separator
  console.log(`${indent}${midLine}`);

  // Print data rows
  for (const row of rows) {
    const cells = headers.map((_h, i) => {
      const value = row[i] ?? '';
      const truncated = truncateToWidth(value, widths[i] - 2);
      const cell = ` ${padToWidth(truncated, widths[i] - 1)}`;
      return cell;
    });
    console.log(`${indent}${dim(BOX.vertical)}${cells.join(dim(BOX.vertical))}${dim(BOX.vertical)}`);
  }

  // Print bottom border
  console.log(`${indent}${bottomLine}`);
}
