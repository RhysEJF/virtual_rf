/**
 * Escalation Tools
 *
 * Tools for managing escalations (questions needing human answers).
 */

import {
  getPendingEscalations as dbGetPendingEscalations,
  getEscalationById,
  answerEscalation as dbAnswerEscalation,
  parseEscalation,
} from '../../db/homr';
import { getOutcomeById, getActiveOutcomes } from '../../db/outcomes';
import { resolveEscalation } from '../../homr/escalator';
import type { HomrEscalation } from '../../db/schema';

export interface EscalationInfo {
  id: string;
  outcomeId: string;
  outcomeName: string;
  question: string;
  context: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  createdAt: number;
}

export interface PendingEscalationsResult {
  count: number;
  escalations: EscalationInfo[];
}

/**
 * Get pending escalations, optionally filtered by outcome
 */
export function getPendingEscalations(
  outcomeId?: string
): PendingEscalationsResult {
  let escalations: HomrEscalation[] = [];

  if (outcomeId) {
    // Get escalations for specific outcome
    escalations = dbGetPendingEscalations(outcomeId);
  } else {
    // Get escalations across all active outcomes
    const activeOutcomes = getActiveOutcomes();
    for (const outcome of activeOutcomes) {
      const outcomeEscalations = dbGetPendingEscalations(outcome.id);
      escalations.push(...outcomeEscalations);
    }
  }

  const formattedEscalations: EscalationInfo[] = escalations.map((esc) => {
    const outcome = getOutcomeById(esc.outcome_id);
    let options: Array<{ id: string; label: string; description: string }> = [];

    try {
      options = JSON.parse(esc.question_options);
    } catch {
      options = [];
    }

    return {
      id: esc.id,
      outcomeId: esc.outcome_id,
      outcomeName: outcome?.name || 'Unknown',
      question: esc.question_text,
      context: esc.question_context,
      options: options.map((opt: { id: string; label: string; description?: string }) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description || '',
      })),
      createdAt: esc.created_at,
    };
  });

  return {
    count: escalations.length,
    escalations: formattedEscalations,
  };
}

export interface AnswerEscalationResult {
  success: boolean;
  selectedOption?: string;
  resumedTasks?: number;
  error?: string;
}

/**
 * Answer an escalation by selecting an option
 */
export async function answerEscalation(
  escalationId: string,
  selectedOption: string,
  additionalContext?: string
): Promise<AnswerEscalationResult> {
  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    return { success: false, error: `Escalation ${escalationId} not found` };
  }

  if (escalation.status !== 'pending') {
    return {
      success: false,
      error: `Escalation is already ${escalation.status}`,
    };
  }

  // Parse options to validate the selected option
  let options: Array<{ id: string; label: string }> = [];
  try {
    options = JSON.parse(escalation.question_options);
  } catch {
    return { success: false, error: 'Could not parse escalation options' };
  }

  // Find the selected option (by ID or label, case-insensitive)
  const lowerSelected = selectedOption.toLowerCase();
  const matchedOption = options.find(
    (opt) =>
      opt.id.toLowerCase() === lowerSelected ||
      opt.label.toLowerCase() === lowerSelected ||
      opt.label.toLowerCase().includes(lowerSelected)
  );

  if (!matchedOption) {
    return {
      success: false,
      error: `Invalid option "${selectedOption}". Available options: ${options
        .map((o) => o.label)
        .join(', ')}`,
    };
  }

  try {
    // Use the HOMЯ escalator to resolve
    const resolution = await resolveEscalation(escalationId, {
      selectedOption: matchedOption.id,
      additionalContext: additionalContext,
    });

    return {
      success: true,
      selectedOption: matchedOption.label,
      resumedTasks: resolution.resumedTasks?.length || 0,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to resolve escalation',
    };
  }
}
