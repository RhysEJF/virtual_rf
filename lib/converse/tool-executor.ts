/**
 * Tool Executor
 *
 * Maps tool calls from Claude to their implementations.
 * Handles argument parsing and error handling.
 */

import * as statusTools from './tools/status';
import * as outcomeTools from './tools/outcomes';
import * as workerTools from './tools/workers';
import * as escalationTools from './tools/escalations';
import * as taskTools from './tools/tasks';
import * as homrTools from './tools/homr';
import type { OutcomeStatus } from '../db/schema';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute a tool call and return the result
 */
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { name, arguments: args } = call;

  try {
    switch (name) {
      // =====================================================================
      // Status Tools
      // =====================================================================
      case 'getSystemStatus': {
        const result = statusTools.getSystemStatus();
        return { success: true, data: result };
      }

      case 'getActiveOutcomes': {
        const result = statusTools.getActiveOutcomes();
        return { success: true, data: result };
      }

      case 'getAllOutcomes': {
        const status = args.status as OutcomeStatus | undefined;
        const result = statusTools.getAllOutcomes(status);
        return { success: true, data: result };
      }

      // =====================================================================
      // Outcome Tools
      // =====================================================================
      case 'getOutcome': {
        const identifier = args.identifier as string;
        if (!identifier) {
          return { success: false, error: 'identifier is required' };
        }
        const result = outcomeTools.getOutcome(identifier);
        return {
          success: result.found,
          data: result.outcome,
          error: result.error,
        };
      }

      case 'getOutcomeTasks': {
        const outcomeId = args.outcome_id as string;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        const status = args.status as string | undefined;
        const result = outcomeTools.getOutcomeTasks(outcomeId, status);
        if ('error' in result) {
          return { success: false, error: result.error };
        }
        return { success: true, data: result };
      }

      case 'getOutcomeWorkers': {
        const outcomeId = args.outcome_id as string;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        const result = outcomeTools.getOutcomeWorkers(outcomeId);
        if ('error' in result) {
          return { success: false, error: result.error };
        }
        return { success: true, data: result };
      }

      case 'createOutcome': {
        const description = args.description as string;
        if (!description) {
          return { success: false, error: 'description is required' };
        }
        const result = await outcomeTools.createOutcome(description);
        return {
          success: result.success,
          data: result.outcome,
          error: result.error,
        };
      }

      case 'iterateOnOutcome': {
        const outcomeId = args.outcome_id as string;
        const feedback = args.feedback as string;
        const startWorker = args.start_worker as boolean | undefined;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        if (!feedback) {
          return { success: false, error: 'feedback is required' };
        }
        const result = await outcomeTools.iterateOnOutcome(
          outcomeId,
          feedback,
          startWorker
        );
        return {
          success: result.success,
          data: {
            tasksCreated: result.tasksCreated,
            taskIds: result.taskIds,
          },
          error: result.error,
        };
      }

      // =====================================================================
      // Worker Tools
      // =====================================================================
      case 'getActiveWorkers': {
        const result = workerTools.getActiveWorkers();
        return { success: true, data: result };
      }

      case 'startWorker': {
        const outcomeId = args.outcome_id as string;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        const result = await workerTools.startWorker(outcomeId);
        return {
          success: result.success,
          data: {
            workerId: result.workerId,
            outcomeName: result.outcomeName,
            pendingTasks: result.pendingTasks,
          },
          error: result.error,
        };
      }

      case 'stopWorker': {
        const workerId = args.worker_id as string | undefined;
        const outcomeId = args.outcome_id as string | undefined;
        if (!workerId && !outcomeId) {
          return {
            success: false,
            error: 'Either worker_id or outcome_id is required',
          };
        }
        const result = workerTools.stopWorker(workerId, outcomeId);
        return {
          success: result.success,
          data: { stoppedCount: result.stoppedCount },
          error: result.error,
        };
      }

      // =====================================================================
      // Escalation Tools
      // =====================================================================
      case 'getPendingEscalations': {
        const outcomeId = args.outcome_id as string | undefined;
        const result = escalationTools.getPendingEscalations(outcomeId);
        return { success: true, data: result };
      }

      case 'answerEscalation': {
        const escalationId = args.escalation_id as string;
        const selectedOption = args.selected_option as string;
        const additionalContext = args.additional_context as string | undefined;
        if (!escalationId) {
          return { success: false, error: 'escalation_id is required' };
        }
        if (!selectedOption) {
          return { success: false, error: 'selected_option is required' };
        }
        const result = await escalationTools.answerEscalation(
          escalationId,
          selectedOption,
          additionalContext
        );
        return {
          success: result.success,
          data: {
            selectedOption: result.selectedOption,
            resumedTasks: result.resumedTasks,
          },
          error: result.error,
        };
      }

      // =====================================================================
      // Task Tools
      // =====================================================================
      case 'getTask': {
        const taskId = args.task_id as string;
        if (!taskId) {
          return { success: false, error: 'task_id is required' };
        }
        const result = taskTools.getTask(taskId);
        return {
          success: result.found,
          data: result.task,
          error: result.error,
        };
      }

      case 'addTask': {
        const outcomeId = args.outcome_id as string;
        const title = args.title as string;
        const description = args.description as string | undefined;
        const priority = args.priority as number | undefined;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        if (!title) {
          return { success: false, error: 'title is required' };
        }
        const result = taskTools.addTask(outcomeId, title, description, priority);
        return {
          success: result.success,
          data: {
            task: result.task,
            outcomeStats: result.outcomeStats,
          },
          error: result.error,
        };
      }

      case 'updateTask': {
        const taskId = args.task_id as string;
        if (!taskId) {
          return { success: false, error: 'task_id is required' };
        }
        const result = taskTools.updateTask(taskId, {
          title: args.title as string | undefined,
          description: args.description as string | undefined,
          prd_context: args.prd_context as string | undefined,
          design_context: args.design_context as string | undefined,
          task_intent: args.task_intent as string | undefined,
          task_approach: args.task_approach as string | undefined,
          priority: args.priority as number | undefined,
        });
        return {
          success: result.success,
          data: result.task,
          error: result.error,
        };
      }

      case 'findTask': {
        const query = args.query as string;
        if (!query) {
          return { success: false, error: 'query is required' };
        }
        const outcomeId = args.outcome_id as string | undefined;
        const result = taskTools.findTask(query, outcomeId);
        return {
          success: result.found,
          data: result.tasks,
          error: result.error,
        };
      }

      // =====================================================================
      // Worker Details Tools
      // =====================================================================
      case 'getWorkerDetails': {
        const workerId = args.worker_id as string;
        if (!workerId) {
          return { success: false, error: 'worker_id is required' };
        }
        const result = workerTools.getWorkerDetails(workerId);
        return {
          success: result.found,
          data: result.worker,
          error: result.error,
        };
      }

      case 'getWorkerProgress': {
        const workerId = args.worker_id as string;
        if (!workerId) {
          return { success: false, error: 'worker_id is required' };
        }
        const result = workerTools.getWorkerProgress(workerId);
        return {
          success: result.found,
          data: result,
          error: result.error,
        };
      }

      // =====================================================================
      // HOMR Tools
      // =====================================================================
      case 'getHomrStatus': {
        const outcomeId = args.outcome_id as string;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        const result = homrTools.getHomrStatusTool(outcomeId);
        return {
          success: result.found,
          data: result,
          error: result.error,
        };
      }

      case 'getHomrDashboard': {
        const outcomeId = args.outcome_id as string;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        const result = homrTools.getHomrDashboard(outcomeId);
        return {
          success: result.found,
          data: result,
          error: result.error,
        };
      }

      case 'runAutoResolve': {
        const outcomeId = args.outcome_id as string;
        if (!outcomeId) {
          return { success: false, error: 'outcome_id is required' };
        }
        const result = await homrTools.runAutoResolve(outcomeId);
        return {
          success: result.success,
          data: result,
          error: result.error,
        };
      }

      // =====================================================================
      // Unknown Tool
      // =====================================================================
      default:
        return {
          success: false,
          error: `Unknown tool: ${name}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : `Tool execution failed: ${String(error)}`,
    };
  }
}

/**
 * Execute multiple tool calls sequentially
 */
export async function executeTools(
  calls: ToolCall[]
): Promise<Map<string, ToolResult>> {
  const results = new Map<string, ToolResult>();

  for (const call of calls) {
    const result = await executeTool(call);
    results.set(call.name, result);
  }

  return results;
}
