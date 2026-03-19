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
import { resolveOutcomeId } from '../utils/ids.js';

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

    // Display gates
    if (task.parsed_gates && task.parsed_gates.length > 0) {
      console.log();
      console.log(chalk.bold.cyan('Gates:'));
      for (const gate of task.parsed_gates) {
        const icon = gate.status === 'satisfied' ? chalk.green('✓') : chalk.yellow('⏳');
        console.log(`  ${icon} [${gate.type}] ${gate.label}`);
        if (gate.escalation_id) {
          console.log(`      Escalation: ${chalk.gray(gate.escalation_id)}`);
        }
        if (gate.status === 'satisfied' && gate.satisfied_at) {
          console.log(`      Satisfied ${formatRelativeTime(gate.satisfied_at)}`);
        }
      }
    }

    // Display evolve mode config
    if (task.metric_command) {
      console.log();
      console.log(chalk.bold.magenta('Evolve Mode:'));
      console.log(`  Metric:    ${chalk.gray(task.metric_command)}`);
      console.log(`  Direction: ${chalk.white(task.metric_direction || 'lower')} is better`);
      console.log(`  Budget:    ${chalk.white(String(task.optimization_budget || 5))} iterations`);
      if (task.metric_baseline != null) {
        console.log(`  Baseline:  ${chalk.white(String(task.metric_baseline))}`);
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
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
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
  gate?: string[];
  metricCommand?: string;
  metricBaseline?: string;
  optimizationBudget?: string;
  metricDirection?: string;
}

const addSubcommand = new Command('add')
  .description('Add a new task to an outcome')
  .argument('<outcome-id>', 'Outcome ID to add task to')
  .argument('<title>', 'Task title')
  .option('--description <text>', 'Task description')
  .option('--priority <n>', 'Priority (1-100, lower runs first)')
  .option('--depends-on <task-ids>', 'Comma-separated task IDs this task depends on')
  .option('--gate <type:label>', 'Add a gate (repeatable, format: document_required:Label or human_approval:Label)', (val: string, prev: string[]) => {
    prev = prev || [];
    prev.push(val);
    return prev;
  }, [] as string[])
  .option('--metric-command <cmd>', 'Enable evolve mode with this metric command (shell command that outputs a number)')
  .option('--metric-baseline <n>', 'Known baseline metric value')
  .option('--optimization-budget <n>', 'Max optimization iterations (default 5)')
  .option('--metric-direction <dir>', 'Optimization direction: lower or higher (default: lower)');

addOutputFlags(addSubcommand);

addSubcommand.action(async (rawOutcomeId: string, title: string, options: AddOptions) => {
  const outcomeId = resolveOutcomeId(rawOutcomeId);
  try {
    // Prepare task data
    const taskData: { title: string; description?: string; priority?: number; depends_on?: string[]; gates?: Array<{ type: string; label: string }>; metric_command?: string; metric_baseline?: number; optimization_budget?: number; metric_direction?: string } = {
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

    if (options.gate && options.gate.length > 0) {
      const gates: Array<{ type: string; label: string }> = [];
      for (const g of options.gate) {
        const colonIdx = g.indexOf(':');
        if (colonIdx === -1) {
          console.error(chalk.red('Error:'), `Invalid gate format "${g}". Use type:label (e.g., document_required:Interview answers)`);
          process.exit(1);
        }
        const type = g.substring(0, colonIdx);
        const label = g.substring(colonIdx + 1);
        if (!['document_required', 'human_approval'].includes(type)) {
          console.error(chalk.red('Error:'), `Invalid gate type "${type}". Must be document_required or human_approval`);
          process.exit(1);
        }
        gates.push({ type, label });
      }
      taskData.gates = gates;
    }

    if (options.metricCommand) {
      taskData.metric_command = options.metricCommand;
    }
    if (options.metricBaseline) {
      const baseline = parseFloat(options.metricBaseline);
      if (isNaN(baseline)) {
        console.error(chalk.red('Error:'), 'Metric baseline must be a number');
        process.exit(1);
      }
      taskData.metric_baseline = baseline;
    }
    if (options.optimizationBudget) {
      const budget = parseInt(options.optimizationBudget, 10);
      if (isNaN(budget) || budget < 1) {
        console.error(chalk.red('Error:'), 'Optimization budget must be a positive integer');
        process.exit(1);
      }
      taskData.optimization_budget = budget;
    }
    if (options.metricDirection) {
      if (!['lower', 'higher'].includes(options.metricDirection)) {
        console.error(chalk.red('Error:'), 'Metric direction must be "lower" or "higher"');
        process.exit(1);
      }
      taskData.metric_direction = options.metricDirection;
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
    if (taskData.gates && taskData.gates.length > 0) {
      console.log(`  Gates: ${chalk.yellow(taskData.gates.map(g => `${g.type}:${g.label}`).join(', '))}`);
    }
    if (taskData.metric_command) {
      console.log(`  Evolve:   ${chalk.magenta('enabled')}`);
      console.log(`    Metric:    ${chalk.gray(taskData.metric_command)}`);
      console.log(`    Direction: ${chalk.white(taskData.metric_direction || 'lower')} is better`);
      console.log(`    Budget:    ${chalk.white(String(taskData.optimization_budget || 5))} iterations`);
      if (taskData.metric_baseline !== undefined) {
        console.log(`    Baseline:  ${chalk.white(String(taskData.metric_baseline))}`);
      }
    }

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
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
  skill?: string;
  metricCommand?: string;
  metricBaseline?: string;
  optimizationBudget?: string;
  metricDirection?: string;
}

interface DetectedCapability {
  type: 'skill' | 'tool';
  name: string;
  path: string;
  description: string;
  specification: string;
}

interface OptimizeFieldResponse {
  success: boolean;
  optimized: string;
  detectedSkills?: string[];
  detectedCapabilities?: DetectedCapability[];
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
  .option('--optimize-description', 'Re-optimize existing description via Claude')
  .option('--skill <name>', 'Inject a skill as methodology guidance for optimization')
  .option('--metric-command <cmd>', 'Set evolve mode metric command (shell command that outputs a number)')
  .option('--metric-baseline <n>', 'Set baseline metric value')
  .option('--optimization-budget <n>', 'Set max optimization iterations')
  .option('--metric-direction <dir>', 'Set optimization direction: lower or higher');

addOutputFlags(updateSubcommand);

updateSubcommand.action(async (taskId: string, options: UpdateOptions) => {
  try {
    const validStatuses = ['pending', 'completed', 'failed'];
    const hasEvolveUpdate = options.metricCommand !== undefined || options.metricBaseline !== undefined || options.optimizationBudget !== undefined || options.metricDirection !== undefined;
    const hasBasicUpdate = options.status || options.title || (options.description && !options.optimize) || options.priority !== undefined || options.dependsOn !== undefined || hasEvolveUpdate;
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

      const updatePayload: Record<string, string | number | string[] | null> = {};
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
      if (options.metricCommand !== undefined) {
        updatePayload.metric_command = options.metricCommand || null;
      }
      if (options.metricBaseline !== undefined) {
        const baseline = parseFloat(options.metricBaseline);
        if (isNaN(baseline)) {
          console.error(chalk.red('Error:'), 'Metric baseline must be a number');
          process.exit(1);
        }
        updatePayload.metric_baseline = baseline;
      }
      if (options.optimizationBudget !== undefined) {
        const budget = parseInt(options.optimizationBudget, 10);
        if (isNaN(budget) || budget < 1) {
          console.error(chalk.red('Error:'), 'Optimization budget must be a positive integer');
          process.exit(1);
        }
        updatePayload.optimization_budget = budget;
      }
      if (options.metricDirection !== undefined) {
        if (!['lower', 'higher'].includes(options.metricDirection)) {
          console.error(chalk.red('Error:'), 'Metric direction must be "lower" or "higher"');
          process.exit(1);
        }
        updatePayload.metric_direction = options.metricDirection;
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

      const optimizePayload: Record<string, string> = { field: 'intent', content: descriptionText as string };
      if (options.skill) {
        optimizePayload.skill = options.skill;
      }

      const optimizeResponse = await api.post<OptimizeFieldResponse>(
        `/tasks/${taskId}/optimize-field`,
        optimizePayload
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
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
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

// Optimize task: flow task optimize <task-id> [options]
interface OptimizeOptions extends OutputOptions {
  field?: string;
  create?: boolean;
  skill?: string;
}

const optimizeSubcommand = new Command('optimize')
  .description('AI-optimize task fields and detect needed capabilities')
  .argument('<task-id>', 'Task ID to optimize')
  .option('--field <field>', 'Field to optimize (intent or approach)', 'approach')
  .option('--skill <name>', 'Inject a skill as methodology guidance (e.g., task-refiner)')
  .option('--create', 'Auto-create detected capability tasks');

addOutputFlags(optimizeSubcommand);

optimizeSubcommand.action(async (taskId: string, options: OptimizeOptions) => {
  try {
    const field = options.field || 'approach';
    if (!['intent', 'approach'].includes(field)) {
      console.error(chalk.red('Error:'), 'Field must be "intent" or "approach"');
      process.exit(1);
    }

    // Fetch current task to get its content
    const { task } = await api.tasks.get(taskId) as { task: TaskWithDependencies };

    const content = field === 'intent'
      ? (task.task_intent || task.description || '')
      : (task.task_approach || task.description || '');

    if (!content.trim()) {
      console.error(chalk.red('Error:'), `Task has no ${field} content to optimize. Set it first with: flow task update ${taskId} --description "..."`);
      process.exit(1);
    }

    if (!options.json && !options.quiet) {
      const skillLabel = options.skill ? ` with skill "${options.skill}"` : '';
      console.log(chalk.gray(`Optimizing ${field} via Claude${skillLabel}...`));
    }

    const optimizePayload: Record<string, string> = { field, content };
    if (options.skill) {
      optimizePayload.skill = options.skill;
    }

    const optimizeResponse = await api.post<OptimizeFieldResponse>(
      `/tasks/${taskId}/optimize-field`,
      optimizePayload
    );

    if (!optimizeResponse.success) {
      console.error(chalk.red('Error:'), 'Failed to optimize');
      process.exit(1);
    }

    // Handle JSON output
    if (options.json || options.quiet) {
      if (handleOutput(optimizeResponse, options, taskId)) {
        return;
      }
    }

    // Update the task with optimized text
    const updateField = field === 'intent' ? 'task_intent' : 'task_approach';
    await api.tasks.update(taskId, { [updateField]: optimizeResponse.optimized });

    // Display results
    console.log();
    console.log(chalk.green('✓') + ` Task ${field} optimized`);
    console.log();

    const preview = optimizeResponse.optimized.split('\n').slice(0, 5).join('\n');
    console.log(chalk.bold.cyan(`Optimized ${field}:`));
    console.log(chalk.white(preview.substring(0, 300) + (optimizeResponse.optimized.length > 300 ? '...' : '')));

    if (optimizeResponse.detectedSkills && optimizeResponse.detectedSkills.length > 0) {
      console.log();
      console.log(chalk.bold.cyan('Existing skills matched:'));
      for (const skill of optimizeResponse.detectedSkills) {
        console.log(`  ${chalk.green('✓')} ${skill}`);
      }
    }

    if (optimizeResponse.detectedCapabilities && optimizeResponse.detectedCapabilities.length > 0) {
      console.log();
      console.log(chalk.bold.yellow(`New capabilities detected (${optimizeResponse.detectedCapabilities.length}):`));
      for (const cap of optimizeResponse.detectedCapabilities) {
        const typeColor = cap.type === 'skill' ? chalk.green : chalk.yellow;
        console.log(`  ${typeColor(`[${cap.type}]`)} ${chalk.white(cap.name)}`);
        if (cap.description) {
          console.log(`         ${chalk.gray(cap.description)}`);
        }
      }

      if (options.create) {
        // Auto-create capability tasks
        console.log();
        console.log(chalk.gray('Creating capability tasks...'));

        let created = 0;
        for (const cap of optimizeResponse.detectedCapabilities) {
          try {
            await api.post('/capabilities/create', {
              outcomeId: task.outcome_id,
              type: cap.type,
              name: cap.name,
              description: cap.description,
              specification: cap.specification,
            });
            console.log(`  ${chalk.green('✓')} Created: ${cap.name}`);
            created++;
          } catch (err) {
            const msg = err instanceof ApiError
              ? ((err.body as { error?: string })?.error || err.message)
              : String(err);
            console.log(`  ${chalk.red('✗')} Failed: ${cap.name} — ${chalk.gray(msg)}`);
          }
        }

        console.log();
        console.log(chalk.green(`${created}/${optimizeResponse.detectedCapabilities.length} capability tasks created`));
      } else {
        console.log();
        console.log(chalk.gray('Run with --create to auto-create capability tasks'));
      }
    }

    console.log();

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
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

// Retry task: flow task retry <task-id> or flow task retry --blocked <outcome-id>
interface RetryOptions extends OutputOptions {
  blocked?: boolean;
  all?: boolean;
  start?: boolean;
}

const retrySubcommand = new Command('retry')
  .description('Retry failed tasks')
  .argument('<id>', 'Task ID to retry, or Outcome ID with --blocked/--all')
  .option('--blocked', 'Retry all failed tasks blocking pending work (pass outcome ID)')
  .option('--all', 'Retry ALL failed tasks for the outcome (pass outcome ID)')
  .option('--start', 'Start a worker after retrying');

addOutputFlags(retrySubcommand);

retrySubcommand.addHelpText('after', `
Examples:
  $ flow task retry tsk_abc123                     Retry a single failed task
  $ flow task retry out_abc123 --blocked           Retry failed tasks blocking progress
  $ flow task retry abc123 --all                   Retry all failed tasks for an outcome
  $ flow task retry out_abc123 --blocked --start   Retry blockers and start a worker
`);

retrySubcommand.action(async (rawId: string, options: RetryOptions) => {
  try {
    if (options.blocked) {
      // Retry failed blockers for an outcome
      const outcomeId = resolveOutcomeId(rawId);

      if (!options.json && !options.quiet) {
        console.log(chalk.gray('Finding failed tasks blocking progress...'));
      }

      const response = await api.post<{ retried: Array<{ id: string; title: string }>; message: string }>(
        `/outcomes/${outcomeId}/tasks/retry-blocked`,
        {}
      );

      if (options.json) {
        handleOutput(response, options);
        return;
      }

      if (response.retried.length === 0) {
        console.log(chalk.gray('  No failed tasks blocking progress.'));
      } else {
        console.log(chalk.green(`\u2713 Reset ${response.retried.length} failed task(s) to pending:`));
        for (const t of response.retried) {
          console.log(`  ${chalk.gray(t.id)} ${chalk.white(t.title)}`);
        }
      }

      // Optionally start a worker
      if (options.start && response.retried.length > 0) {
        console.log();
        console.log(chalk.gray('Starting worker...'));
        const startResponse = await api.outcomes.start(outcomeId);
        console.log(chalk.green(`\u2713 Worker started: ${startResponse.worker.id}`));
      }

    } else if (options.all) {
      // Retry ALL failed tasks for an outcome
      const outcomeId = resolveOutcomeId(rawId);

      if (!options.json && !options.quiet) {
        console.log(chalk.gray('Finding all failed tasks...'));
      }

      // Get all failed tasks
      const tasksResponse = await api.outcomes.tasks(outcomeId);
      const failedTasks = tasksResponse.tasks.filter(t => t.status === 'failed');

      if (failedTasks.length === 0) {
        console.log(chalk.gray('  No failed tasks found.'));
        return;
      }

      const retried: Array<{ id: string; title: string }> = [];
      for (const ft of failedTasks) {
        try {
          await api.post(`/tasks/${ft.id}/retry`, {});
          retried.push({ id: ft.id, title: ft.title });
        } catch {
          // Skip tasks that can't be retried
        }
      }

      if (options.json) {
        handleOutput({ retried, total_failed: failedTasks.length }, options);
        return;
      }

      console.log(chalk.green(`\u2713 Reset ${retried.length}/${failedTasks.length} failed task(s) to pending:`));
      for (const t of retried) {
        console.log(`  ${chalk.gray(t.id)} ${chalk.white(t.title)}`);
      }

      if (options.start && retried.length > 0) {
        console.log();
        console.log(chalk.gray('Starting worker...'));
        const startResponse = await api.outcomes.start(outcomeId);
        console.log(chalk.green(`\u2713 Worker started: ${startResponse.worker.id}`));
      }

    } else {
      // Retry a single task
      const taskId = rawId.startsWith('task_') ? rawId : `task_${rawId}`;

      if (!options.json && !options.quiet) {
        console.log(chalk.gray('Retrying task...'));
      }

      const response = await api.post<{ task: Task; retried: boolean }>(`/tasks/${taskId}/retry`, {});

      if (options.json) {
        handleOutput(response, options);
        return;
      }

      console.log(chalk.green('\u2713') + ` Task reset to pending: ${chalk.white(response.task.title)}`);
      console.log(`  ${chalk.gray(response.task.id)} — attempts reset, ready for next worker`);
    }

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      if (error.status === 404) {
        console.error(chalk.red('Error:'), 'Not found:', rawId);
      } else {
        const body = error.body as { error?: string } | undefined;
        console.error(chalk.red('Error:'), body?.error || error.message);
      }
      process.exit(1);
    }
    throw error;
  }
});

// Add examples
optimizeSubcommand.addHelpText('after', `
Examples:
  $ flow task optimize tsk_abc123                         Optimize approach field
  $ flow task optimize tsk_abc123 --field intent          Optimize intent field
  $ flow task optimize tsk_abc123 --skill task-refiner    Use a skill as guidance
  $ flow task optimize tsk_abc123 --create                Auto-create detected capabilities
`);

addSubcommand.addHelpText('after', `
Examples:
  $ flow task add out_abc123 "Build the API"                         Simple task
  $ flow task add abc123 "Deploy" --gate "human_approval:Approve"    Task with gate
  $ flow task add out_abc123 "Fix bug" --priority 1                  High priority
`);

updateSubcommand.addHelpText('after', `
Examples:
  $ flow task update tsk_abc123 --status completed                   Mark done
  $ flow task update tsk_abc123 --description "new desc" --optimize  Set + optimize
  $ flow task update tsk_abc123 --optimize-description --skill task-refiner
`);

// Delete task: flow task delete <task-id> [options]
interface DeleteOptions extends OutputOptions {
  force?: boolean;
}

const deleteSubcommand = new Command('delete')
  .description('Delete a task and its subtasks')
  .argument('<task-id>', 'Task ID to delete')
  .option('--force', 'Skip confirmation prompt');

addOutputFlags(deleteSubcommand);

deleteSubcommand.addHelpText('after', `
Examples:
  $ flow task delete tsk_abc123              Delete with confirmation
  $ flow task delete tsk_abc123 --force      Delete without confirmation
`);

deleteSubcommand.action(async (taskId: string, options: DeleteOptions) => {
  try {
    // Fetch task first to show details
    const { task } = await api.tasks.get(taskId);

    if (!options.force && !options.json && !options.quiet) {
      console.log();
      console.log(`  ${chalk.bold('Task:')} ${task.title}`);
      console.log(`  ${chalk.bold('ID:')} ${chalk.cyan(task.id)}`);
      console.log(`  ${chalk.bold('Status:')} ${formatTaskStatus(task.status)}`);
      console.log();

      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow('Delete this task? (y/N) '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled.'));
        return;
      }
    }

    const result = await api.tasks.delete(taskId);

    if (options.json) {
      handleOutput(result, options);
      return;
    }

    if (!options.quiet) {
      console.log(chalk.green('Deleted:'), task.title);
    }
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Flow API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      if (error.status === 404) {
        console.error(chalk.red('Error:'), `Task not found: ${taskId}`);
      } else if (error.status === 409) {
        const msg = (error.body as { error?: string })?.error || 'Cannot delete this task';
        console.error(chalk.red('Error:'), msg);
      } else {
        console.error(chalk.red('API Error:'), error.message);
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
taskCommand.addCommand(optimizeSubcommand);
taskCommand.addCommand(retrySubcommand);
taskCommand.addCommand(deleteSubcommand);

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
