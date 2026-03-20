/**
 * Converse2 Command
 *
 * A polished terminal chat interface for Flow.
 * Launches a full-screen TUI with chat area, input, and status bar.
 */

import { Command } from 'commander';
import { FlowTUI } from '../tui/app.js';

export const converse2Command = new Command('converse2')
  .description('Start the Flow chat interface (TUI)')
  .option('--yolo', 'Skip all permission checks (dangerously-skip-permissions)')
  .action(async (options: { yolo?: boolean }) => {
    const tui = new FlowTUI({ yolo: options.yolo });
    await tui.start();
  });

export default converse2Command;
