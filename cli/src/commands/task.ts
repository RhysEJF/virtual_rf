/**
 * Task Command
 *
 * Provides task management:
 * - flow task <id>: Show task details
 * - flow task add <outcome-id> "<title>": Create a new task
 * - flow task update <id> [options]: Update task properties
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Task, TaskWithDependencies } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

/**
 * Formats task status with color
 */
function formatTaskStatus(status: string): string {
  switch (status) {
    case 'pending':
      return chalk.yellow('pending');
    case 'claimed':
      return chalk.blue('claimed');
    case 'running':
      return chalk.cyan('running');
    case 'completed':
      return chalk.green('completed');
    case 'failed':
      return chalk.red('failed');
    default:
      return status;
  }
}

/**
 * Formats task phase with color
 */
function formatPhase(phase: string): string {
  switch (phase) {
    case 'capability':
      return chalk.magenta('capability');
    case 'execution':
      return chalk.blue('execution');
    default:
      return phase;
  }
}

/**
 * Formats a timestamp to relative time
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

// Create the main task command
const taskCommand = new Command('task')
  .description('Manage tasks');

// Show task details: flow task <id>
const showSubcommand = new Command('show')
  .description('Show task details')
  .argument('<task-id>', 'Task ID to display');

addOutputFlags(showSubcommand);

showSubcommand.action(async (taskId: string, options: OutputOptions) => {
  try {
    const { task } = await api.tasks.get(taskId) as { task: TaskWithDependencies };

    // Handle JSON/quiet output
    if (options.json || options.quiet) {
      if (handleOutput(task, options, task.id)) {
        return;
      }
    }

    // Display task details
    console.log();
    console.log(chalk.bold.white(`Task: ${task.id}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Title:       ${chalk.white(task.title)}`);
    console.log(`Status:      ${formatTaskStatus(task.status)}`);
    console.log(`Priority:    ${chalk.white(task.priority.toString())}`);
    console.log(`Phase:       ${formatPhase(task.phase)}`);
    console.log(`Outcome:     ${chalk.gray(task.outcome_id)}`);
    console.log(`Created:     ${chalk.white(formatRelativeTime(task.created_at))}`);

    if (task.claimed_by) {
      console.log(`Claimed by:  ${chalk.white(task.claimed_by)}`);
    }

    if (task.completed_at) {
      console.log(`Completed:   ${chalk.white(formatRelativeTime(task.completed_at))}`);
    }

    if (task.attempts > 0) {
      console.log(`Attempts:    ${chalk.white(`${task.attempts}/${task.max_attempts}`)}`);
    }

    if (task.from_review) {
      console.log(`From review: ${chalk.yellow('yes')} ${task.review_cycle ? `(cycle ${task.review_cycle})` : ''}`);
    }

    if (task.capability_type) {
      console.log(`Cap type:    ${chalk.magenta(task.capability_type)}`);
    }

    // Display dependencies
    const hasBlockedBy = task.blocked_by && task.blocked_by.length > 0;
    const hasBlocks = task.blocks && task.blocks.length > 0;
    if (hasBlockedBy || hasBlocks) {
      console.log();
      console.log(chalk.bold.cyan('Dependencies:'));
      if (hasBlockedBy) {
        console.log(`  ${chalk.red('Blocked by:')} ${task.blocked_by.join(', ')}`);
      }
      if (hasBlocks) {
        console.log(`  ${chalk.yellow('Blocks:')} ${task.blocks.join(', ')}`);
      }
    }

    if (task.description) {
      console.log();
      console.log(chalk.bold.cyan('Description:'));
      const lines = task.description.split('\n');
      for (const line of lines) {
        console.log(`  ${chalk.white(line)}`);
      }
    }

    console.log();

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      if (error.status === 404) {
        console.error(chalk.red('Error:'), `Task not found: ${taskId}`);
      } else {
        console.error(chalk.red('API Error:'), error.message);
      }
      process.exit(1);
    }
    throw error;
  }
});

// Add task: flow task add <outcome-id> "<title>"
interface AddOptions extends OutputOptions {
  description?: string;
  priority?: string;
  dependsOn?: string;
}

const addSubcommand = new Command('add')
  .description('Add a new task to an outcome')
  .argument('<outcome-id>', 'Outcome ID to add task to')
  .argument('<title>', 'Task title')
  .option('--description <text>', 'Task description')
  .option('--priority <n>', 'Priority (1-100, lower runs first)')
  .option('--depends-on <task-ids>', 'Comma-separated task IDs this task depends on');

addOutputFlags(addSubcommand);

addSubcommand.action(async (outcomeId: string, title: string, options: AddOptions) => {
  try {
    // Prepare task data
    const taskData: { title: string; description?: string; priority?: number; depends_on?: string[] } = {
      title,
    };

    if (options.description) {
      taskData.description = options.description;
    }

    if (options.priority) {
      const priority = parseInt(options.priority, 10);
      if (isNaN(priority) || priority < 1 || priority > 100) {
        console.error(chalk.red('Error:'), 'Priority must be a number between 1 and 100');
        process.exit(1);
      }
      taskData.priority = priority;
    }

    if (options.dependsOn) {
      const dependsOn = options.dependsOn.split(',').map(id => id.trim()).filter(id => id.length > 0);
      if (dependsOn.length > 0) {
        taskData.depends_on = dependsOn;
      }
    }

    // Create the task
    const response = await api.post<{ task: Task }>(`/outcomes/${outcomeId}/tasks`, taskData);
    const { task } = response;

    // Handle JSON/quiet output
    if (options.json || options.quiet) {
      if (handleOutput(task, options, task.id)) {
        return;
      }
    }

    // Success message
    console.log(chalk.green('Task created:'), task.id);
    console.log(`  Title:    ${chalk.white(task.title)}`);
    console.log(`  Priority: ${chalk.white(task.priority.toString())}`);
    if (task.description) {
      console.log(`  Description: ${chalk.gray(task.description.substring(0, 50))}${task.description.length > 50 ? '...' : ''}`);
    }
    if (taskData.depends_on && taskData.depends_on.length > 0) {
      console.log(`  Depends on: ${chalk.yellow(taskData.depends_on.join(', '))}`);
    }

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
        const body = error.body as { error?: string } | undefined;
        console.error(chalk.red('API Error:'), body?.error || error.message);
      }
      process.exit(1);
    }
    throw error;
  }
});

// Update task: flow task update <task-id> [options]
interface UpdateOptions extends OutputOptions {
  status?: string;
  title?: string;
  description?: string;
  priority?: string;
  dependsOn?: string;
  optimize?: boolean;
  optimizeDescription?: boolean;
}

interface OptimizeFieldResponse {
  success: boolean;
  optimized: string;
  detectedSkills?: string[];
}

const updateSubcommand = new Command('update')
  .description('Update task properties')
  .argument('<task-id>', 'Task ID to update')
  .option('--status <status>', 'Set status (pending|completed|failed)')
  .option('--title <text>', 'Update title')
  .option('--description <text>', 'Update description')
  .option('--priority <n>', 'Set priority (1-100, lower runs first)')
  .option('--depends-on <task-ids>', 'Set dependencies (comma-separated task IDs, or "" to clear)')
  .option('--optimize', 'Optimize description via Claude (use with --description)')
  .option('--optimize-description', 'Re-optimize existing description via Claude');

addOutputFlags(updateSubcommand);

updateSubcommand.action(async (taskId: string, options: UpdateOptions) => {
  try {
    const validStatuses = ['pending', 'completed', 'failed'];
    const hasBasicUpdate = options.status || options.title || (options.description && !options.optimize) || options.priority !== undefined || options.dependsOn !== undefined;
    const hasOptimizeDescription = (options.description && options.optimize) || options.optimizeDescription;

    // Validate at least one option is provided
    if (!hasBasicUpdate && !hasOptimizeDescription) {
      console.error(chalk.red('Error:'), 'At least one option (--status, --title, --description, --priority, --depends-on, --optimize-description) is required');
      process.exit(1);
    }

    // Validate status value
    if (options.status && !validStatuses.includes(options.status)) {
      console.error(chalk.red('Error:'), `Invalid status "${options.status}"`);
      console.error(chalk.gray(`Valid statuses: ${validStatuses.join(', ')}`));
      process.exit(1);
    }

    // Validate priority value
    if (options.priority !== undefined) {
      const priority = parseInt(options.priority, 10);
      if (isNaN(priority) || priority < 1 || priority > 100) {
        console.error(chalk.red('Error:'), 'Priority must be a number between 1 and 100');
        process.exit(1);
      }
    }

    // Track what we're doing
    let task: Task | null = null;
    const results: Record<string, unknown> = {};

    // Basic update (status, title, raw description, priority, depends_on)
    if (hasBasicUpdate) {
      if (!options.json && !options.quiet) {
        console.log(chalk.gray('Updating task...'));
      }

      const updatePayload: Record<string, string | number | string[]> = {};
      if (options.status) updatePayload.status = options.status;
      if (options.title) updatePayload.title = options.title;
      if (options.description && !options.optimize) updatePayload.description = options.description;
      if (options.priority !== undefined) updatePayload.priority = parseInt(options.priority, 10);
      if (options.dependsOn !== undefined) {
        if (options.dependsOn === '' || options.dependsOn === '""') {
          // Clear dependencies
          updatePayload.depends_on = [];
        } else {
          // Set dependencies
          updatePayload.depends_on = options.dependsOn.split(',').map(id => id.trim()).filter(id => id.length > 0);
        }
      }

      const response = await api.tasks.update(taskId, updatePayload);
      task = response.task;
      results.updated = updatePayload;
    }

    // Optimize description (new text or re-optimize existing)
    if (hasOptimizeDescription) {
      if (!options.json && !options.quiet) {
        console.log(chalk.gray('Optimizing description via Claude...'));
      }

      let descriptionText = options.description;
      if (options.optimizeDescription && !descriptionText) {
        // Re-optimize existing: fetch the current description
        const current = await api.tasks.get(taskId);
        task = current.task;
        descriptionText = task.description || '';
        if (!descriptionText) {
          console.error(chalk.red('Error:'), 'No existing description to re-optimize');
          process.exit(1);
        }
      }

      const optimizeResponse = await api.post<OptimizeFieldResponse>(
        `/tasks/${taskId}/optimize-field`,
        { field: 'intent', content: descriptionText }
      );

      if (!optimizeResponse.success) {
        console.error(chalk.red('Error:'), 'Failed to optimize description');
        process.exit(1);
      }

      // Update the task with the optimized description
      const updateResponse = await api.tasks.update(taskId, { description: optimizeResponse.optimized });
      task = updateResponse.task;

      results.optimizedDescription = optimizeResponse.optimized;
      if (optimizeResponse.detectedSkills && optimizeResponse.detectedSkills.length > 0) {
        results.detectedSkills = optimizeResponse.detectedSkills;
      }
    }

    // Fetch final task state if we don't have it yet
    if (!task) {
      const response = await api.tasks.get(taskId);
      task = response.task;
    }

    // Handle output
    if (options.json || options.quiet) {
      const outputData = {
        task,
        ...results,
      };
      if (handleOutput(outputData, options, task.id)) {
        return;
      }
    }

    // Human-readable output
    console.log();
    console.log(chalk.green('✓') + ' Task updated successfully!');
    console.log();
    console.log(`  ${chalk.bold('ID:')} ${chalk.cyan(task.id)}`);
    console.log(`  ${chalk.bold('Title:')} ${task.title}`);
    console.log(`  ${chalk.bold('Status:')} ${formatTaskStatus(task.status)}`);

    if (results.updated) {
      console.log();
      console.log(chalk.bold.cyan('Updated fields:'));
      const updated = results.updated as Record<string, string | number | string[]>;
      for (const [key, value] of Object.entries(updated)) {
        let displayValue: string;
        if (Array.isArray(value)) {
          displayValue = value.length === 0 ? '(cleared)' : value.join(', ');
        } else if (typeof value === 'string' && value.length > 50) {
          displayValue = value.substring(0, 50) + '...';
        } else {
          displayValue = String(value);
        }
        console.log(`  ${key}: ${chalk.white(displayValue)}`);
      }
    }

    if (results.optimizedDescription) {
      console.log();
      console.log(chalk.bold.cyan('Description optimized'));
      const description = results.optimizedDescription as string;
      const preview = description.split('\n').slice(0, 3).join('\n');
      console.log(chalk.gray(preview.substring(0, 150) + (description.length > 150 ? '...' : '')));
    }

    if (results.detectedSkills) {
      const skills = results.detectedSkills as string[];
      console.log();
      console.log(chalk.yellow('!') + ` Detected ${skills.length} skill reference(s): ${skills.join(', ')}`);
    }

    console.log();

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      if (error.status === 404) {
        console.error(chalk.red('Error:'), `Task not found: ${taskId}`);
      } else {
        console.error(chalk.red('API Error:'), error.message);
        if (error.body && typeof error.body === 'object' && 'error' in error.body) {
          console.error(chalk.gray((error.body as { error: string }).error));
        }
      }
      process.exit(1);
    }
    throw error;
  }
});

// Register subcommands
taskCommand.addCommand(showSubcommand);
taskCommand.addCommand(addSubcommand);
taskCommand.addCommand(updateSubcommand);

// Also support direct task ID as argument: flow task <id>
// This is the default action when no subcommand is provided
taskCommand
  .argument('[task-id]', 'Task ID to display (shorthand for "flow task show <id>")')
  .action(async (taskId: string | undefined, _options: OutputOptions) => {
    if (!taskId) {
      // No task ID provided and no subcommand, show help
      taskCommand.help();
      return;
    }

    // Delegate to show subcommand
    await showSubcommand.parseAsync(['show', taskId, ...process.argv.slice(4)], { from: 'user' });
  });

export { taskCommand };
export default taskCommand;
