/**
 * Gate Tools
 *
 * Tools for managing task gates (human-in-the-loop checkpoints).
 */

import {
  getTaskById,
  parseGates,
  addGateToTask,
  satisfyGate,
  getTasksWithPendingGates,
  createEscalationsForPendingGates,
} from '../../db/tasks';
import { getTasksByOutcome } from '../../db/tasks';
import type { TaskGate, GateType } from '../../db/schema';

export interface GateInfo {
  id: string;
  taskId: string;
  taskTitle: string;
  type: GateType;
  label: string;
  description: string;
  status: string;
  escalationId: string | null;
  satisfiedAt: number | null;
  satisfiedBy: string | null;
  responseData: string | null;
}

export interface ListGatesResult {
  count: number;
  gates: GateInfo[];
}

/**
 * List gates on a specific task or across an outcome
 */
export function listGates(
  taskId?: string,
  outcomeId?: string
): ListGatesResult {
  const gates: GateInfo[] = [];

  if (taskId) {
    const task = getTaskById(taskId);
    if (!task) {
      return { count: 0, gates: [] };
    }
    const parsed = parseGates(task.gates);
    for (const gate of parsed) {
      gates.push({
        id: gate.id,
        taskId: task.id,
        taskTitle: task.title,
        type: gate.type,
        label: gate.label,
        description: gate.description,
        status: gate.status,
        escalationId: gate.escalation_id,
        satisfiedAt: gate.satisfied_at,
        satisfiedBy: gate.satisfied_by,
        responseData: gate.response_data,
      });
    }
  } else if (outcomeId) {
    const tasksWithGates = getTasksWithPendingGates(outcomeId);
    for (const { task, pendingGates } of tasksWithGates) {
      for (const gate of pendingGates) {
        gates.push({
          id: gate.id,
          taskId: task.id,
          taskTitle: task.title,
          type: gate.type,
          label: gate.label,
          description: gate.description,
          status: gate.status,
          escalationId: gate.escalation_id,
          satisfiedAt: gate.satisfied_at,
          satisfiedBy: gate.satisfied_by,
          responseData: gate.response_data,
        });
      }
    }
  }

  return { count: gates.length, gates };
}

export interface AddGateResult {
  success: boolean;
  gate?: GateInfo;
  error?: string;
}

/**
 * Add a gate to a task
 */
export function addGate(
  taskId: string,
  type: GateType,
  label: string,
  description?: string
): AddGateResult {
  const task = getTaskById(taskId);
  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` };
  }

  if (task.status !== 'pending') {
    return { success: false, error: `Gates can only be added to pending tasks (current status: ${task.status})` };
  }

  const validTypes: GateType[] = ['document_required', 'human_approval'];
  if (!validTypes.includes(type)) {
    return { success: false, error: `Invalid gate type: ${type}. Must be one of: ${validTypes.join(', ')}` };
  }

  const gate = addGateToTask(taskId, { type, label, description });
  if (!gate) {
    return { success: false, error: 'Failed to add gate' };
  }

  // Auto-create escalation
  createEscalationsForPendingGates(taskId, task.outcome_id);

  return {
    success: true,
    gate: {
      id: gate.id,
      taskId,
      taskTitle: task.title,
      type: gate.type,
      label: gate.label,
      description: gate.description,
      status: gate.status,
      escalationId: gate.escalation_id,
      satisfiedAt: gate.satisfied_at,
      satisfiedBy: gate.satisfied_by,
      responseData: gate.response_data,
    },
  };
}

export interface SatisfyGateResult {
  success: boolean;
  gate?: GateInfo;
  error?: string;
}

/**
 * Satisfy a gate on a task
 */
export function satisfyGateAction(
  taskId: string,
  gateId: string,
  responseData?: string
): SatisfyGateResult {
  const task = getTaskById(taskId);
  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` };
  }

  const gates = parseGates(task.gates);
  const gate = gates.find(g => g.id === gateId);
  if (!gate) {
    return { success: false, error: `Gate not found: ${gateId}` };
  }

  if (gate.status === 'satisfied') {
    return { success: false, error: 'Gate is already satisfied' };
  }

  const updatedGate = satisfyGate(taskId, gateId, responseData, 'human');
  if (!updatedGate) {
    return { success: false, error: 'Failed to satisfy gate' };
  }

  return {
    success: true,
    gate: {
      id: updatedGate.id,
      taskId,
      taskTitle: task.title,
      type: updatedGate.type,
      label: updatedGate.label,
      description: updatedGate.description,
      status: updatedGate.status,
      escalationId: updatedGate.escalation_id,
      satisfiedAt: updatedGate.satisfied_at,
      satisfiedBy: updatedGate.satisfied_by,
      responseData: updatedGate.response_data,
    },
  };
}
