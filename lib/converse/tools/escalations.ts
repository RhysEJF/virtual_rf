/**
 * Escalation Tools
 *
 * Tools for managing escalations (questions needing human answers).
 */

import {
  getPendingEscalations as dbGetPendingEscalations,
  getEscalationById,
  answerEscalation as dbAnswerEscalation,
  confirmEscalationResolution,
  rejectEscalationResolution,
  logHomrActivity,
  parseEscalation,
} from '../../db/homr';
import { getOutcomeById, getActiveOutcomes } from '../../db/outcomes';
import { resolveEscalation } from '../../homr/escalator';
import type { HomrEscalation } from '../../db/schema';

export interface EscalationInfo {
  id: string;
  outcomeId: string;
  outcomeName: string;
  status: 'pending' | 'pending_confirmation';
  question: string;
  context: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  proposedResolution?: {
    selectedOption: string;
    reasoning: string;
  };
  proposedConfidence?: number;
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

    let proposedResolution: EscalationInfo['proposedResolution'] | undefined;
    if (esc.proposed_resolution) {
      try {
        proposedResolution = JSON.parse(esc.proposed_resolution);
      } catch {
        // Invalid JSON, skip
      }
    }

    return {
      id: esc.id,
      outcomeId: esc.outcome_id,
      outcomeName: outcome?.name || 'Unknown',
      status: esc.status as 'pending' | 'pending_confirmation',
      question: esc.question_text,
      context: esc.question_context,
      options: options.map((opt: { id: string; label: string; description?: string }) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description || '',
      })),
      proposedResolution,
      proposedConfidence: esc.proposed_confidence ?? undefined,
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

  if (escalation.status === 'pending_confirmation') {
    return {
      success: false,
      error: `This escalation has a pending AI proposal. Use confirmEscalationProposal to approve or rejectEscalationProposal to dismiss it.`,
    };
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

export interface ConfirmRejectResult {
  success: boolean;
  error?: string;
  workerSpawned?: boolean;
}

/**
 * Confirm a semi-auto proposed resolution
 */
export async function confirmEscalationProposal(
  escalationId: string
): Promise<ConfirmRejectResult> {
  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    return { success: false, error: `Escalation ${escalationId} not found` };
  }

  if (escalation.status !== 'pending_confirmation') {
    return {
      success: false,
      error: `Escalation is not pending confirmation (status: ${escalation.status})`,
    };
  }

  try {
    const proposed = JSON.parse(escalation.proposed_resolution || '{}');
    if (!proposed.selectedOption) {
      return { success: false, error: 'No proposed resolution found' };
    }

    confirmEscalationResolution(escalationId);

    const resolution = await resolveEscalation(escalationId, {
      selectedOption: proposed.selectedOption,
      additionalContext: `[SEMI-AUTO CONFIRMED] ${proposed.reasoning || ''}`,
    });

    logHomrActivity({
      outcome_id: escalation.outcome_id,
      type: 'auto_resolved',
      summary: `Semi-auto confirmed via converse: ${proposed.selectedOption}`,
      details: { escalationId, selectedOption: proposed.selectedOption, confirmed: true },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to confirm resolution',
    };
  }
}

/**
 * Reject a semi-auto proposed resolution (reverts to pending)
 */
export function rejectEscalationProposal(
  escalationId: string
): ConfirmRejectResult {
  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    return { success: false, error: `Escalation ${escalationId} not found` };
  }

  if (escalation.status !== 'pending_confirmation') {
    return {
      success: false,
      error: `Escalation is not pending confirmation (status: ${escalation.status})`,
    };
  }

  try {
    rejectEscalationResolution(escalationId);

    logHomrActivity({
      outcome_id: escalation.outcome_id,
      type: 'auto_resolve_deferred',
      summary: `Semi-auto rejected via converse: proposal dismissed`,
      details: { escalationId, rejected: true },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reject resolution',
    };
  }
}
