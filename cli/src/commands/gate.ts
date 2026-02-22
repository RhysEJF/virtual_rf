/**
 * Gate Command
 *
 * Manages task gates (human-in-the-loop checkpoints):
 * - flow gate list <task-id>: List gates on a task
 * - flow gate add <task-id> --type <type> --label <text>: Add a gate
 * - flow gate satisfy <task-id> <gate-id>: Satisfy a gate
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

interface TaskGate {
  id: string;
  type: string;
  label: string;
  description: string;
  status: string;
  escalation_id: string | null;
  satisfied_at: number | null;
  satisfied_by: string | null;
  response_data: string | null;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// Create the main gate command
const gateCommand = new Command('gate')
  .description('Manage task gates (human-in-the-loop checkpoints)');

// List gates: flow gate list <task-id>
const listSubcommand = new Command('list')
  .description('List gates on a task')
  .argument('<task-id>', 'Task ID');

addOutputFlags(listSubcommand);

listSubcommand.action(async (taskId: string, options: OutputOptions) => {
  try {
    const { gates } = await api.get<{ gates: TaskGate[] }>(`/tasks/${taskId}/gates`);

    if (options.json || options.quiet) {
      if (handleOutput(gates, options, `${gates.length} gates`)) return;
    }

    if (gates.length === 0) {
      console.log(chalk.gray('No gates on this task.'));
      return;
    }

    console.log();
    console.log(chalk.bold.white(`Gates for ${taskId}`));
    console.log(chalk.gray('─'.repeat(60)));

    for (const gate of gates) {
      const icon = gate.status === 'satisfied' ? chalk.green('✓') : chalk.yellow('⏳');
      console.log(`  ${icon} [${gate.type}] ${gate.label}`);
      console.log(`      ID: ${chalk.gray(gate.id)}`);
      if (gate.escalation_id) {
        console.log(`      Escalation: ${chalk.gray(gate.escalation_id)}`);
      }
      if (gate.status === 'satisfied' && gate.satisfied_at) {
        console.log(`      Satisfied ${formatRelativeTime(gate.satisfied_at)}${gate.satisfied_by ? ` by ${gate.satisfied_by}` : ''}`);
      }
    }
    console.log();
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
      process.exit(1);
    }
    if (error instanceof ApiError) {
      console.error(chalk.red('API Error:'), error.message);
      process.exit(1);
    }
    throw error;
  }
});

// Add gate: flow gate add <task-id> --type <type> --label <text>
interface AddGateOptions extends OutputOptions {
  type: string;
  label: string;
  description?: string;
}

const addSubcommand = new Command('add')
  .description('Add a gate to a task')
  .argument('<task-id>', 'Task ID')
  .requiredOption('--type <type>', 'Gate type (document_required or human_approval)')
  .requiredOption('--label <text>', 'Gate label')
  .option('--description <text>', 'Detailed description');

addOutputFlags(addSubcommand);

addSubcommand.action(async (taskId: string, options: AddGateOptions) => {
  try {
    if (!['document_required', 'human_approval'].includes(options.type)) {
      console.error(chalk.red('Error:'), 'Gate type must be document_required or human_approval');
      process.exit(1);
    }

    const { gate } = await api.post<{ gate: TaskGate }>(`/tasks/${taskId}/gates`, {
      type: options.type,
      label: options.label,
      description: options.description,
    });

    if (options.json || options.quiet) {
      if (handleOutput(gate, options, gate.id)) return;
    }

    console.log(chalk.green('Gate added:'), gate.id);
    console.log(`  Type:  ${gate.type}`);
    console.log(`  Label: ${gate.label}`);
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
      process.exit(1);
    }
    if (error instanceof ApiError) {
      const body = error.body as { error?: string } | undefined;
      console.error(chalk.red('API Error:'), body?.error || error.message);
      process.exit(1);
    }
    throw error;
  }
});

// Satisfy gate: flow gate satisfy <task-id> <gate-id>
interface SatisfyGateOptions extends OutputOptions {
  response?: string;
}

const satisfySubcommand = new Command('satisfy')
  .description('Satisfy a gate')
  .argument('<task-id>', 'Task ID')
  .argument('<gate-id>', 'Gate ID')
  .option('--response <text>', 'Response data / human input');

addOutputFlags(satisfySubcommand);

satisfySubcommand.action(async (taskId: string, gateId: string, options: SatisfyGateOptions) => {
  try {
    const { gate } = await api.post<{ gate: TaskGate }>(`/tasks/${taskId}/gates/${gateId}/satisfy`, {
      response_data: options.response,
    });

    if (options.json || options.quiet) {
      if (handleOutput(gate, options, gate.id)) return;
    }

    console.log(chalk.green('Gate satisfied:'), gate.id);
    console.log(`  Label: ${gate.label}`);
    console.log(`  Status: ${chalk.green('satisfied')}`);
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
      process.exit(1);
    }
    if (error instanceof ApiError) {
      const body = error.body as { error?: string } | undefined;
      console.error(chalk.red('API Error:'), body?.error || error.message);
      process.exit(1);
    }
    throw error;
  }
});

gateCommand.addCommand(listSubcommand);
gateCommand.addCommand(addSubcommand);
gateCommand.addCommand(satisfySubcommand);

export { gateCommand };
export default gateCommand;
