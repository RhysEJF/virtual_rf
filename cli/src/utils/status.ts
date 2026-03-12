/**
 * Status Display Utilities
 *
 * Consistent color-coded status dots and labels for outcomes, tasks, and workers.
 */

import chalk from 'chalk';

/**
 * Returns a color-coded status dot for any status string.
 */
export function statusDot(status: string): string {
  switch (status) {
    // Active/running states
    case 'active':
    case 'running':
      return chalk.green('\u25cf'); // filled circle
    // Paused/warning states
    case 'paused':
    case 'warning':
      return chalk.yellow('\u25d0'); // half circle
    // Idle/dormant/stopped states
    case 'idle':
    case 'dormant':
    case 'stopped':
    case 'archived':
      return chalk.gray('\u25cb'); // empty circle
    // Completed/achieved states
    case 'completed':
    case 'achieved':
      return chalk.green('\u2713'); // checkmark
    // Failed states
    case 'failed':
      return chalk.red('\u2717'); // x mark
    // Claimed/building states
    case 'claimed':
    case 'building':
      return chalk.cyan('\u25c9'); // fisheye
    // Pending
    case 'pending':
      return chalk.yellow('\u25cb'); // empty circle yellow
    default:
      return chalk.gray('\u25cb');
  }
}

/**
 * Returns a color-coded outcome status label with dot.
 */
export function outcomeStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return `${chalk.green('\u25cf')} ${chalk.green('active')}`;
    case 'dormant':
      return `${chalk.gray('\u25cb')} ${chalk.gray('dormant')}`;
    case 'achieved':
      return `${chalk.green('\u2713')} ${chalk.green('achieved')}`;
    case 'archived':
      return `${chalk.gray('\u25cb')} ${chalk.gray('archived')}`;
    default:
      return `${chalk.gray('\u25cb')} ${chalk.gray(status)}`;
  }
}

/**
 * Returns a color-coded task status label with dot.
 */
export function taskStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return `${chalk.yellow('\u25cb')} ${chalk.yellow('pending')}`;
    case 'claimed':
      return `${chalk.cyan('\u25c9')} ${chalk.cyan('claimed')}`;
    case 'running':
      return `${chalk.green('\u25cf')} ${chalk.green('running')}`;
    case 'completed':
      return `${chalk.green('\u2713')} ${chalk.green('completed')}`;
    case 'failed':
      return `${chalk.red('\u2717')} ${chalk.red('failed')}`;
    default:
      return `${chalk.gray('\u25cb')} ${chalk.gray(status)}`;
  }
}

/**
 * Returns a color-coded worker status label with dot.
 */
export function workerStatusLabel(status: string): string {
  switch (status) {
    case 'idle':
      return `${chalk.gray('\u25cb')} ${chalk.gray('idle')}`;
    case 'running':
      return `${chalk.green('\u25cf')} ${chalk.green('running')}`;
    case 'paused':
      return `${chalk.yellow('\u25d0')} ${chalk.yellow('paused')}`;
    case 'completed':
      return `${chalk.green('\u2713')} ${chalk.green('completed')}`;
    case 'failed':
      return `${chalk.red('\u2717')} ${chalk.red('failed')}`;
    default:
      return `${chalk.gray('\u25cb')} ${chalk.gray(status)}`;
  }
}
