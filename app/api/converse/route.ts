/**
 * Conversational API Route
 *
 * POST /api/converse - Multi-turn chat endpoint for natural language interaction
 *
 * Uses intent classification to map user messages to existing system actions
 * (creating outcomes, starting workers, answering escalations, etc.)
 *
 * Request body:
 * - message: string - The user's message
 * - session_id?: string - Optional session ID for multi-turn context
 *
 * Response:
 * - type: 'action' | 'response' | 'clarification' | 'error'
 * - message: string - Response message to display
 * - session_id: string - Session ID for follow-up messages
 * - intent: object - Classified intent with type, confidence, entities
 * - actions_taken: array - List of actions performed
 * - follow_up_questions?: array - Questions for clarification
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  classifyIntent,
  type IntentClassification,
  type IntentType,
  requiresOutcomeContext,
  getIntentDescription,
} from '@/lib/agents/intent-classifier';
import {
  createSession,
  getSessionById,
  getSessionByIdParsed,
  updateSessionContext,
  updateSessionOutcome,
  createMessage,
  getRecentMessages,
  isSessionValid,
  buildEnrichedContext,
  updateSessionAfterClassification,
  enrichedContextToClassifierContext,
  enrichedContextToFullClassifierContext,
  type EnrichedContext,
} from '@/lib/db/sessions';
import type { ParsedConversationSession } from '@/lib/db/schema';
import { getOutcomeById, getActiveOutcomes, getAllOutcomes, createOutcome } from '@/lib/db/outcomes';
import { getTasksByOutcome, getTaskStats } from '@/lib/db/tasks';
import { getWorkersByOutcome, pauseWorker } from '@/lib/db/workers';
import { startRalphWorker, stopRalphWorker, getRalphWorkerStatus } from '@/lib/ralph/worker';
import { getPendingEscalations, getEscalationById } from '@/lib/db/homr';
import { resolveEscalation } from '@/lib/homr/escalator';
import { generateBrief } from '@/lib/agents/briefer';
import { createTask } from '@/lib/db/tasks';
import { claudeComplete } from '@/lib/claude/client';

// ============================================================================
// Types
// ============================================================================

interface ConverseRequest {
  message: string;
  session_id?: string;
}

interface ActionTaken {
  action: string;
  target?: string;
  result?: string;
  success: boolean;
}

interface ConverseResponse {
  type: 'action' | 'response' | 'clarification' | 'error';
  message: string;
  session_id: string;
  intent: {
    type: IntentType;
    confidence: number;
    entities: Record<string, string | undefined>;
    description: string;
  };
  actions_taken: ActionTaken[];
  follow_up_questions?: string[];
  data?: Record<string, unknown>;
}

// ============================================================================
// Session Context Helpers
// ============================================================================

interface SessionContext {
  hasActiveOutcome: boolean;
  activeOutcomeId?: string;
  hasPendingEscalations: boolean;
  lastEscalationQuestion?: string;
  pendingEscalationId?: string;
}

function getSessionContext(session: ParsedConversationSession | null): SessionContext {
  const context: SessionContext = {
    hasActiveOutcome: false,
    hasPendingEscalations: false,
  };

  if (session?.current_outcome_id) {
    context.hasActiveOutcome = true;
    context.activeOutcomeId = session.current_outcome_id;

    // Check for pending escalations
    const escalations = getPendingEscalations(session.current_outcome_id);
    if (escalations.length > 0) {
      context.hasPendingEscalations = true;
      context.lastEscalationQuestion = escalations[0].question_text;
      context.pendingEscalationId = escalations[0].id;
    }
  }

  // Check session context for stored state
  if (session?.context) {
    if (session.context.lastEscalationQuestion) {
      context.lastEscalationQuestion = session.context.lastEscalationQuestion as string;
    }
    if (session.context.pendingEscalationId) {
      context.pendingEscalationId = session.context.pendingEscalationId as string;
    }
  }

  return context;
}

// ============================================================================
// Intent Handlers
// ============================================================================

async function handleCreateOutcome(
  classification: IntentClassification,
  session: ParsedConversationSession
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  const description = classification.entities.description || classification.entities.query;

  if (!description) {
    return {
      message: 'What would you like to create? Please describe your goal or project.',
      actions: [],
    };
  }

  // Use briefer to generate outcome structure
  const brief = await generateBrief(description);

  if (!brief) {
    return {
      message: 'I had trouble understanding that request. Could you provide more details about what you want to build?',
      actions: [{ action: 'generate_brief', success: false }],
    };
  }

  // Create the outcome
  const outcome = createOutcome({
    name: brief.title,
    brief: description,
    intent: JSON.stringify({
      summary: brief.objective,
      items: brief.prd.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        acceptance_criteria: [],
        priority: item.priority <= 3 ? 'high' : item.priority <= 6 ? 'medium' : 'low',
        status: 'pending',
      })),
      success_criteria: brief.deliverables,
    }),
  });

  // Create tasks from PRD items
  for (const item of brief.prd) {
    createTask({
      outcome_id: outcome.id,
      title: item.title,
      description: item.description,
      prd_context: JSON.stringify(item),
      priority: item.priority * 10,
    });
  }

  // Update session to track this outcome
  updateSessionOutcome(session.id, outcome.id);

  return {
    message: `I've created the outcome "${brief.title}" with ${brief.prd.length} tasks.\n\n**Objective:** ${brief.objective}\n\nWould you like me to start a worker to begin executing the tasks?`,
    actions: [
      { action: 'create_outcome', target: outcome.id, result: brief.title, success: true },
      { action: 'create_tasks', target: outcome.id, result: `${brief.prd.length} tasks`, success: true },
    ],
    data: {
      outcomeId: outcome.id,
      outcomeName: brief.title,
      taskCount: brief.prd.length,
    },
  };
}

async function handleCheckStatus(
  session: ParsedConversationSession
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  const activeOutcomes = getActiveOutcomes();
  const actions: ActionTaken[] = [{ action: 'check_status', success: true }];

  if (activeOutcomes.length === 0) {
    return {
      message: "You don't have any active outcomes right now. Would you like to create one?",
      actions,
      data: { activeOutcomes: 0 },
    };
  }

  // Build status summary
  const summaries = activeOutcomes.slice(0, 5).map(outcome => {
    const stats = getTaskStats(outcome.id);
    const workers = getWorkersByOutcome(outcome.id);
    const runningWorkers = workers.filter(w => w.status === 'running').length;

    return `- **${outcome.name}**: ${stats.completed}/${stats.total} tasks (${runningWorkers} worker${runningWorkers !== 1 ? 's' : ''} running)`;
  });

  const message = `**System Status**\n\n${summaries.join('\n')}${activeOutcomes.length > 5 ? `\n\n...and ${activeOutcomes.length - 5} more outcomes` : ''}`;

  return {
    message,
    actions,
    data: {
      activeOutcomes: activeOutcomes.length,
      outcomes: activeOutcomes.slice(0, 5).map(o => ({ id: o.id, name: o.name })),
    },
  };
}

async function handleListOutcomes(): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  const outcomes = getAllOutcomes();
  const actions: ActionTaken[] = [{ action: 'list_outcomes', success: true }];

  if (outcomes.length === 0) {
    return {
      message: "You don't have any outcomes yet. Would you like to create one?",
      actions,
      data: { total: 0 },
    };
  }

  const summaries = outcomes.slice(0, 10).map(outcome => {
    const statusEmoji = outcome.status === 'active' ? '🔵' : outcome.status === 'achieved' ? '✅' : '⏸️';
    return `${statusEmoji} **${outcome.name}** (${outcome.status})`;
  });

  const message = `**Your Outcomes** (${outcomes.length} total)\n\n${summaries.join('\n')}${outcomes.length > 10 ? `\n\n...and ${outcomes.length - 10} more` : ''}`;

  return {
    message,
    actions,
    data: {
      total: outcomes.length,
      outcomes: outcomes.slice(0, 10).map(o => ({ id: o.id, name: o.name, status: o.status })),
    },
  };
}

async function handleShowOutcome(
  classification: IntentClassification,
  session: ParsedConversationSession,
  enrichedContext?: EnrichedContext | null
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  let outcomeId = classification.entities.outcome_id || session.current_outcome_id;

  // If we have an outcome name but no ID, try to find it
  if (!outcomeId && classification.entities.outcome_name) {
    const outcomes = getAllOutcomes();
    const match = outcomes.find(o =>
      o.name.toLowerCase().includes(classification.entities.outcome_name!.toLowerCase())
    );
    if (match) outcomeId = match.id;
  }

  // Check resolved entities from context if no outcome specified
  if (!outcomeId && enrichedContext?.referencedEntities?.outcome?.id) {
    outcomeId = enrichedContext.referencedEntities.outcome.id;
  }

  if (!outcomeId) {
    return {
      message: 'Which outcome would you like to see? Please specify the outcome name or ID.',
      actions: [{ action: 'show_outcome', success: false }],
    };
  }

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      message: `I couldn't find that outcome. Please check the ID and try again.`,
      actions: [{ action: 'show_outcome', target: outcomeId, success: false }],
    };
  }

  const stats = getTaskStats(outcomeId);
  const workers = getWorkersByOutcome(outcomeId);
  const runningWorkers = workers.filter(w => w.status === 'running');
  const escalations = getPendingEscalations(outcomeId);

  // Update session to track this outcome
  updateSessionOutcome(session.id, outcomeId);

  let message = `**${outcome.name}** (${outcome.status})\n\n`;
  message += `**Tasks:** ${stats.completed}/${stats.total} completed`;
  if (stats.running > 0) message += `, ${stats.running} in progress`;
  if (stats.pending > 0) message += `, ${stats.pending} pending`;
  message += '\n';

  if (runningWorkers.length > 0) {
    message += `**Workers:** ${runningWorkers.length} running\n`;
  }

  if (escalations.length > 0) {
    message += `\n⚠️ **${escalations.length} escalation${escalations.length > 1 ? 's' : ''} need${escalations.length === 1 ? 's' : ''} your attention:**\n`;
    message += `"${escalations[0].question_text}"`;
  }

  return {
    message,
    actions: [{ action: 'show_outcome', target: outcomeId, result: outcome.name, success: true }],
    data: {
      outcomeId,
      outcomeName: outcome.name,
      status: outcome.status,
      stats,
      runningWorkers: runningWorkers.length,
      pendingEscalations: escalations.length,
    },
  };
}

async function handleListTasks(
  classification: IntentClassification,
  session: ParsedConversationSession,
  enrichedContext?: EnrichedContext | null
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  let outcomeId = classification.entities.outcome_id || session.current_outcome_id;

  // Check resolved entities from context if no outcome specified
  if (!outcomeId && enrichedContext?.referencedEntities?.outcome?.id) {
    outcomeId = enrichedContext.referencedEntities.outcome.id;
  }

  if (!outcomeId) {
    return {
      message: 'Which outcome would you like to see tasks for? Please specify or select an outcome first.',
      actions: [{ action: 'list_tasks', success: false }],
    };
  }

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      message: `I couldn't find that outcome.`,
      actions: [{ action: 'list_tasks', target: outcomeId, success: false }],
    };
  }

  const tasks = getTasksByOutcome(outcomeId);
  const stats = getTaskStats(outcomeId);

  if (tasks.length === 0) {
    return {
      message: `**${outcome.name}** has no tasks yet.`,
      actions: [{ action: 'list_tasks', target: outcomeId, success: true }],
      data: { total: 0 },
    };
  }

  const taskList = tasks.slice(0, 10).map(task => {
    const statusEmoji = task.status === 'completed' ? '✅' : task.status === 'running' ? '🔄' : '⬜';
    return `${statusEmoji} ${task.title}`;
  });

  let message = `**Tasks for ${outcome.name}** (${stats.completed}/${stats.total} done)\n\n`;
  message += taskList.join('\n');
  if (tasks.length > 10) {
    message += `\n\n...and ${tasks.length - 10} more tasks`;
  }

  return {
    message,
    actions: [{ action: 'list_tasks', target: outcomeId, result: `${tasks.length} tasks`, success: true }],
    data: {
      outcomeId,
      total: tasks.length,
      stats,
      tasks: tasks.slice(0, 10).map(t => ({ id: t.id, title: t.title, status: t.status })),
    },
  };
}

async function handleStartWorker(
  classification: IntentClassification,
  session: ParsedConversationSession,
  enrichedContext?: EnrichedContext | null
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  let outcomeId = classification.entities.outcome_id || session.current_outcome_id;

  // Check resolved entities from context if no outcome specified
  // This enables "start worker" after showing an outcome (pronoun resolution)
  if (!outcomeId && enrichedContext?.referencedEntities?.outcome?.id) {
    outcomeId = enrichedContext.referencedEntities.outcome.id;
  }

  if (!outcomeId) {
    return {
      message: 'Which outcome should I start a worker for? Please specify or select an outcome first.',
      actions: [{ action: 'start_worker', success: false }],
    };
  }

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      message: `I couldn't find that outcome.`,
      actions: [{ action: 'start_worker', target: outcomeId, success: false }],
    };
  }

  try {
    const result = await startRalphWorker({ outcomeId });

    if (!result.started) {
      return {
        message: `Couldn't start worker: ${result.error || 'Unknown error'}`,
        actions: [{ action: 'start_worker', target: outcomeId, success: false }],
      };
    }

    const stats = getTaskStats(outcomeId);

    return {
      message: `Started a worker for **${outcome.name}**. It will work through ${stats.pending} pending task${stats.pending !== 1 ? 's' : ''}.`,
      actions: [{ action: 'start_worker', target: outcomeId, result: result.workerId, success: true }],
      data: {
        outcomeId,
        workerId: result.workerId,
        pendingTasks: stats.pending,
      },
    };
  } catch (error) {
    return {
      message: `Failed to start worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
      actions: [{ action: 'start_worker', target: outcomeId, success: false }],
    };
  }
}

async function handleStopWorker(
  classification: IntentClassification,
  session: ParsedConversationSession,
  enrichedContext?: EnrichedContext | null
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  let workerId = classification.entities.worker_id;
  let outcomeId = classification.entities.outcome_id || session.current_outcome_id;

  // Check resolved entities from context if no worker or outcome specified
  if (!workerId && enrichedContext?.referencedEntities?.worker?.id) {
    workerId = enrichedContext.referencedEntities.worker.id;
  }
  if (!outcomeId && enrichedContext?.referencedEntities?.outcome?.id) {
    outcomeId = enrichedContext.referencedEntities.outcome.id;
  }

  if (workerId) {
    const stopped = stopRalphWorker(workerId);
    return {
      message: stopped ? `Stopped worker ${workerId}.` : `Couldn't find or stop worker ${workerId}.`,
      actions: [{ action: 'stop_worker', target: workerId, success: stopped }],
    };
  }

  if (outcomeId) {
    const workers = getWorkersByOutcome(outcomeId);
    const runningWorkers = workers.filter(w => w.status === 'running');

    if (runningWorkers.length === 0) {
      return {
        message: 'No workers are currently running for this outcome.',
        actions: [{ action: 'stop_worker', target: outcomeId, success: false }],
      };
    }

    let stoppedCount = 0;
    for (const worker of runningWorkers) {
      if (stopRalphWorker(worker.id)) stoppedCount++;
    }

    return {
      message: `Stopped ${stoppedCount} worker${stoppedCount !== 1 ? 's' : ''}.`,
      actions: [{ action: 'stop_worker', target: outcomeId, result: `${stoppedCount} stopped`, success: true }],
      data: { stoppedCount },
    };
  }

  return {
    message: 'Which worker would you like to stop? Please specify the worker or outcome.',
    actions: [{ action: 'stop_worker', success: false }],
  };
}

async function handlePauseWorker(
  classification: IntentClassification,
  session: ParsedConversationSession,
  enrichedContext?: EnrichedContext | null
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  let workerId = classification.entities.worker_id;
  let outcomeId = classification.entities.outcome_id || session.current_outcome_id;

  // Check resolved entities from context if no worker or outcome specified
  if (!workerId && enrichedContext?.referencedEntities?.worker?.id) {
    workerId = enrichedContext.referencedEntities.worker.id;
  }
  if (!outcomeId && enrichedContext?.referencedEntities?.outcome?.id) {
    outcomeId = enrichedContext.referencedEntities.outcome.id;
  }

  if (workerId) {
    const paused = pauseWorker(workerId);
    return {
      message: paused ? `Paused worker ${workerId}.` : `Couldn't find or pause worker ${workerId}.`,
      actions: [{ action: 'pause_worker', target: workerId, success: !!paused }],
    };
  }

  if (outcomeId) {
    const workers = getWorkersByOutcome(outcomeId);
    const runningWorkers = workers.filter(w => w.status === 'running');

    if (runningWorkers.length === 0) {
      return {
        message: 'No workers are currently running for this outcome.',
        actions: [{ action: 'pause_worker', target: outcomeId, success: false }],
      };
    }

    let pausedCount = 0;
    for (const worker of runningWorkers) {
      if (pauseWorker(worker.id)) pausedCount++;
    }

    return {
      message: `Paused ${pausedCount} worker${pausedCount !== 1 ? 's' : ''}.`,
      actions: [{ action: 'pause_worker', target: outcomeId, result: `${pausedCount} paused`, success: true }],
      data: { pausedCount },
    };
  }

  return {
    message: 'Which worker would you like to pause? Please specify the worker or outcome.',
    actions: [{ action: 'pause_worker', success: false }],
  };
}

async function handleAnswerEscalation(
  classification: IntentClassification,
  session: ParsedConversationSession
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  const answer = classification.entities.answer || classification.entities.query;
  const escalationId = classification.entities.escalation_id ||
    (session.context?.pendingEscalationId as string | undefined);

  if (!escalationId) {
    // Check if there's a pending escalation in the current outcome
    if (session.current_outcome_id) {
      const escalations = getPendingEscalations(session.current_outcome_id);
      if (escalations.length > 0) {
        // Store this escalation ID in session for next message
        updateSessionContext(session.id, {
          pendingEscalationId: escalations[0].id,
          lastEscalationQuestion: escalations[0].question_text,
        });

        if (answer) {
          // User provided an answer, try to match to an option
          try {
            const escalation = escalations[0];
            const options = JSON.parse(escalation.question_options);

            // Try to find a matching option
            const lowerAnswer = answer.toLowerCase();
            const matchedOption = options.find((opt: { id: string; label: string }) =>
              lowerAnswer.includes(opt.label.toLowerCase()) ||
              lowerAnswer.includes(opt.id.toLowerCase())
            );

            if (matchedOption) {
              const resolution = await resolveEscalation(escalation.id, {
                selectedOption: matchedOption.id,
                additionalContext: answer,
              });

              // Clear the pending escalation from session
              updateSessionContext(session.id, {
                pendingEscalationId: null,
                lastEscalationQuestion: null,
              });

              return {
                message: `Got it! I've recorded your choice: "${matchedOption.label}". ${resolution.resumedTasks.length > 0 ? `Resumed ${resolution.resumedTasks.length} task(s).` : ''}`,
                actions: [{ action: 'answer_escalation', target: escalation.id, result: matchedOption.id, success: true }],
                data: {
                  escalationId: escalation.id,
                  selectedOption: matchedOption.id,
                  resumedTasks: resolution.resumedTasks,
                },
              };
            }

            // Couldn't match - show options
            const optionsList = options.map((opt: { id: string; label: string; description?: string }) =>
              `- **${opt.label}**: ${opt.description || ''}`
            ).join('\n');

            return {
              message: `I couldn't match your answer to an option. Please choose one:\n\n${optionsList}`,
              actions: [{ action: 'answer_escalation', success: false }],
            };
          } catch (error) {
            return {
              message: `Failed to process your answer: ${error instanceof Error ? error.message : 'Unknown error'}`,
              actions: [{ action: 'answer_escalation', success: false }],
            };
          }
        }
      }
    }

    return {
      message: 'There are no pending questions to answer right now.',
      actions: [{ action: 'answer_escalation', success: false }],
    };
  }

  // We have an escalation ID and an answer
  if (!answer) {
    const escalation = getEscalationById(escalationId);
    if (escalation) {
      const options = JSON.parse(escalation.question_options);
      const optionsList = options.map((opt: { id: string; label: string; description?: string }) =>
        `- **${opt.label}**: ${opt.description || ''}`
      ).join('\n');

      return {
        message: `**${escalation.question_text}**\n\nPlease choose one of these options:\n\n${optionsList}`,
        actions: [],
      };
    }
    return {
      message: 'Please provide your answer.',
      actions: [],
    };
  }

  try {
    const escalation = getEscalationById(escalationId);
    if (!escalation) {
      return {
        message: 'That escalation no longer exists.',
        actions: [{ action: 'answer_escalation', target: escalationId, success: false }],
      };
    }

    const options = JSON.parse(escalation.question_options);
    const lowerAnswer = answer.toLowerCase();
    const matchedOption = options.find((opt: { id: string; label: string }) =>
      lowerAnswer.includes(opt.label.toLowerCase()) ||
      lowerAnswer.includes(opt.id.toLowerCase())
    ) || options[0]; // Default to first option if no match

    const resolution = await resolveEscalation(escalationId, {
      selectedOption: matchedOption.id,
      additionalContext: answer,
    });

    // Clear the pending escalation from session
    updateSessionContext(session.id, {
      pendingEscalationId: null,
      lastEscalationQuestion: null,
    });

    return {
      message: `Recorded your answer. ${resolution.resumedTasks.length > 0 ? `Resumed ${resolution.resumedTasks.length} task(s).` : ''}`,
      actions: [{ action: 'answer_escalation', target: escalationId, result: matchedOption.id, success: true }],
      data: {
        escalationId,
        selectedOption: matchedOption.id,
        resumedTasks: resolution.resumedTasks,
      },
    };
  } catch (error) {
    return {
      message: `Failed to record your answer: ${error instanceof Error ? error.message : 'Unknown error'}`,
      actions: [{ action: 'answer_escalation', target: escalationId, success: false }],
    };
  }
}

async function handleShowEscalations(
  session: ParsedConversationSession
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  // Check current outcome first, then all outcomes
  let escalations: ReturnType<typeof getPendingEscalations> = [];
  let sourceDescription = '';

  if (session.current_outcome_id) {
    escalations = getPendingEscalations(session.current_outcome_id);
    const outcome = getOutcomeById(session.current_outcome_id);
    sourceDescription = outcome ? ` for ${outcome.name}` : '';
  }

  // If no current outcome or no escalations, check all active outcomes
  if (escalations.length === 0) {
    const activeOutcomes = getActiveOutcomes();
    for (const outcome of activeOutcomes) {
      const outcomeEscalations = getPendingEscalations(outcome.id);
      escalations.push(...outcomeEscalations);
    }
    sourceDescription = ' across all outcomes';
  }

  if (escalations.length === 0) {
    return {
      message: 'No pending escalations need your attention right now.',
      actions: [{ action: 'show_escalations', success: true }],
      data: { count: 0 },
    };
  }

  const escalationList = escalations.slice(0, 5).map((esc, i) => {
    return `${i + 1}. **${esc.question_text}**`;
  });

  let message = `**Pending Escalations${sourceDescription}** (${escalations.length})\n\n`;
  message += escalationList.join('\n\n');

  if (escalations.length === 1) {
    // Store the first escalation ID for easy answering
    updateSessionContext(session.id, {
      pendingEscalationId: escalations[0].id,
      lastEscalationQuestion: escalations[0].question_text,
    });

    // Show options for single escalation
    const options = JSON.parse(escalations[0].question_options);
    const optionsList = options.map((opt: { id: string; label: string; description?: string }) =>
      `- **${opt.label}**: ${opt.description || ''}`
    ).join('\n');
    message += `\n\nOptions:\n${optionsList}\n\nYou can answer directly by telling me your choice.`;
  }

  return {
    message,
    actions: [{ action: 'show_escalations', success: true }],
    data: {
      count: escalations.length,
      escalations: escalations.slice(0, 5).map(e => ({
        id: e.id,
        question: e.question_text,
        outcomeId: e.outcome_id,
      })),
    },
  };
}

async function handleIterate(
  classification: IntentClassification,
  session: ParsedConversationSession,
  enrichedContext?: EnrichedContext | null
): Promise<{ message: string; actions: ActionTaken[]; data?: Record<string, unknown> }> {
  const feedback = classification.entities.description || classification.entities.query;
  let outcomeId = classification.entities.outcome_id || session.current_outcome_id;

  // Check resolved entities from context if no outcome specified
  if (!outcomeId && enrichedContext?.referencedEntities?.outcome?.id) {
    outcomeId = enrichedContext.referencedEntities.outcome.id;
  }

  if (!outcomeId) {
    return {
      message: 'Which outcome would you like to provide feedback for? Please select an outcome first.',
      actions: [{ action: 'iterate', success: false }],
    };
  }

  if (!feedback) {
    return {
      message: 'What changes would you like to make? Please describe your feedback.',
      actions: [{ action: 'iterate', success: false }],
    };
  }

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      message: `I couldn't find that outcome.`,
      actions: [{ action: 'iterate', target: outcomeId, success: false }],
    };
  }

  // Use Claude to parse feedback into tasks
  const prompt = `Convert this feedback into specific tasks for the project "${outcome.name}":

Feedback: ${feedback}

Respond with ONLY a JSON array:
[{"title": "Task title", "description": "What to do", "priority": 1}]

Priority: 1=critical, 2=important, 3=nice-to-have`;

  const result = await claudeComplete({ prompt, timeout: 30000 });

  let tasks: Array<{ title: string; description: string; priority: number }> = [];
  try {
    const jsonMatch = result.text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      tasks = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fallback to single task
    tasks = [{ title: 'Address feedback', description: feedback, priority: 1 }];
  }

  // Create tasks
  const createdIds: string[] = [];
  for (const task of tasks) {
    const created = createTask({
      outcome_id: outcomeId,
      title: task.title,
      description: task.description,
      priority: task.priority || 2,
      from_review: true,
    });
    if (created) createdIds.push(created.id);
  }

  return {
    message: `Created ${createdIds.length} task${createdIds.length !== 1 ? 's' : ''} from your feedback. Would you like me to start a worker to implement these changes?`,
    actions: [{ action: 'iterate', target: outcomeId, result: `${createdIds.length} tasks created`, success: true }],
    data: {
      outcomeId,
      tasksCreated: createdIds.length,
      taskIds: createdIds,
    },
  };
}

async function handleHelp(): Promise<{ message: string; actions: ActionTaken[] }> {
  const message = `**Digital Twin - Conversational Interface**

Here's what I can help you with:

**Creating & Managing Outcomes**
- "Create a landing page for my product"
- "Show my outcomes" / "List projects"
- "Show me the landing page project"

**Tasks & Workers**
- "Show tasks for [outcome]"
- "Start a worker" / "Begin working"
- "Stop the worker" / "Pause work"

**Escalations (Questions from Workers)**
- "Any questions?" / "Show escalations"
- Just answer directly when I show you a question

**Feedback & Iteration**
- "The button should be blue"
- "Add validation to the form"

**Status**
- "Status" / "What's happening?"

You can reference outcomes by name or ID. I'll remember your current context across messages.`;

  return {
    message,
    actions: [{ action: 'help', success: true }],
  };
}

async function handleGeneralQuery(
  classification: IntentClassification,
  session: ParsedConversationSession
): Promise<{ message: string; actions: ActionTaken[] }> {
  const query = classification.entities.query || 'How can I help you?';

  // For general queries, provide a helpful response with context
  let contextInfo = '';
  if (session.current_outcome_id) {
    const outcome = getOutcomeById(session.current_outcome_id);
    if (outcome) {
      contextInfo = `\n\nYou're currently viewing **${outcome.name}**.`;
    }
  }

  return {
    message: `I'm not sure how to help with that specific request.${contextInfo}\n\nTry asking me to:\n- Create an outcome/project\n- Check status\n- Start or stop workers\n- Show or answer escalations\n\nOr say "help" for more options.`,
    actions: [{ action: 'general_query', success: true }],
  };
}

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<ConverseResponse>> {
  try {
    const body = (await request.json()) as ConverseRequest;
    const { message, session_id } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({
        type: 'error',
        message: 'Message is required',
        session_id: session_id || '',
        intent: {
          type: 'general_query',
          confidence: 0,
          entities: {},
          description: 'Invalid request',
        },
        actions_taken: [],
      }, { status: 400 });
    }

    // Get or create session
    let session: ParsedConversationSession;

    if (session_id && isSessionValid(session_id)) {
      const existing = getSessionByIdParsed(session_id);
      if (existing) {
        session = existing;
      } else {
        // Session ID provided but not found - create new
        const newSession = createSession({});
        session = {
          ...newSession,
          context: JSON.parse(newSession.context) as Record<string, unknown>,
        };
      }
    } else {
      // No session ID or invalid - create new session
      const newSession = createSession({});
      session = {
        ...newSession,
        context: JSON.parse(newSession.context) as Record<string, unknown>,
      };
    }

    // Store user message
    createMessage({
      sessionId: session.id,
      role: 'user',
      content: message,
    });

    // Build enriched context for classification
    // This aggregates: session state, intent history, referenced entities, message history
    const pendingEscalations = session.current_outcome_id
      ? getPendingEscalations(session.current_outcome_id).map(e => ({
          id: e.id,
          question_text: e.question_text,
        }))
      : [];

    const enrichedContext = buildEnrichedContext(session.id, {
      pendingEscalations,
      recentMessageCount: 5,
    });

    // Convert to full classifier context (includes previous intents for disambiguation)
    const classifierContext = enrichedContext
      ? enrichedContextToFullClassifierContext(enrichedContext)
      : getSessionContext(session);

    // Classify intent with enriched context (including previous intents for disambiguation)
    const classification = await classifyIntent(message, classifierContext);

    // Update session context with the classified intent (for next turn)
    // This tracks intent history and referenced entities
    updateSessionAfterClassification(session.id, {
      type: classification.type,
      confidence: classification.confidence,
      entities: classification.entities as Record<string, string | undefined>,
    });

    // Route to appropriate handler
    // Pass enrichedContext to handlers that may need resolved entity references
    let result: { message: string; actions: ActionTaken[]; data?: Record<string, unknown> };

    switch (classification.type) {
      case 'create_outcome':
        result = await handleCreateOutcome(classification, session);
        break;
      case 'check_status':
        result = await handleCheckStatus(session);
        break;
      case 'list_outcomes':
        result = await handleListOutcomes();
        break;
      case 'show_outcome':
        result = await handleShowOutcome(classification, session, enrichedContext);
        break;
      case 'list_tasks':
        result = await handleListTasks(classification, session, enrichedContext);
        break;
      case 'start_worker':
        result = await handleStartWorker(classification, session, enrichedContext);
        break;
      case 'stop_worker':
        result = await handleStopWorker(classification, session, enrichedContext);
        break;
      case 'pause_worker':
        result = await handlePauseWorker(classification, session, enrichedContext);
        break;
      case 'answer_escalation':
        result = await handleAnswerEscalation(classification, session);
        break;
      case 'show_escalations':
        result = await handleShowEscalations(session);
        break;
      case 'iterate':
        result = await handleIterate(classification, session, enrichedContext);
        break;
      case 'help':
        result = await handleHelp();
        break;
      case 'general_query':
      default:
        result = await handleGeneralQuery(classification, session);
        break;
    }

    // Store assistant response with full context for debugging
    // Include resolved context so we can trace how entities were resolved
    const resolvedContext = enrichedContext ? {
      previousIntents: enrichedContext.recentIntentTypes?.slice(0, 3),
      conversationTopic: enrichedContext.conversationTopic,
      referencedEntities: {
        outcome: enrichedContext.referencedEntities?.outcome?.id,
        worker: enrichedContext.referencedEntities?.worker?.id,
        task: enrichedContext.referencedEntities?.task?.id,
        escalation: enrichedContext.referencedEntities?.escalation?.id,
      },
      currentOutcomeId: enrichedContext.currentOutcomeId,
      messageCount: enrichedContext.messageCount,
    } : null;

    createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: result.message,
      metadata: {
        intent: classification.type,
        confidence: classification.confidence,
        actions: result.actions,
        resolvedContext, // Full context for debugging
      },
    });

    // Determine response type
    const hasSuccessfulAction = result.actions.some(a => a.success);
    const responseType: ConverseResponse['type'] = hasSuccessfulAction
      ? 'action'
      : result.actions.length > 0
        ? 'clarification'
        : 'response';

    return NextResponse.json({
      type: responseType,
      message: result.message,
      session_id: session.id,
      intent: {
        type: classification.type,
        confidence: classification.confidence,
        entities: classification.entities as Record<string, string | undefined>,
        description: getIntentDescription(classification.type),
      },
      actions_taken: result.actions,
      data: result.data,
    });

  } catch (error) {
    console.error('[Converse API] Error:', error);

    return NextResponse.json({
      type: 'error',
      message: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      session_id: '',
      intent: {
        type: 'general_query',
        confidence: 0,
        entities: {},
        description: 'Error occurred',
      },
      actions_taken: [],
    }, { status: 500 });
  }
}

// ============================================================================
// GET - Session info
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  }

  const session = getSessionByIdParsed(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const messages = getRecentMessages(sessionId, 20);

  return NextResponse.json({
    session: {
      id: session.id,
      current_outcome_id: session.current_outcome_id,
      created_at: session.created_at,
      last_activity_at: session.last_activity_at,
    },
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    })),
  });
}
