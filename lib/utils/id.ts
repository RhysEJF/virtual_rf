/**
 * ID generation utilities
 */

import { nanoid } from 'nanoid';

/**
 * Generate a unique ID with a prefix.
 * @param prefix - Short prefix (e.g., 'out', 'task', 'wrk')
 * @param length - Length of the random part (default: 12)
 */
export function generateId(prefix: string, length: number = 12): string {
  return `${prefix}_${nanoid(length)}`;
}

// Convenience functions for common entity types

export function generateOutcomeId(): string {
  return generateId('out');
}

export function generateTaskId(): string {
  return generateId('task');
}

export function generateWorkerId(): string {
  return generateId('wrk');
}

export function generateDesignDocId(): string {
  return generateId('design');
}

export function generateCollaboratorId(): string {
  return generateId('collab');
}

export function generateReviewCycleId(): string {
  return generateId('review');
}

export function generateSkillId(): string {
  return generateId('skill');
}

// Legacy aliases (for backwards compatibility)
export function generateProjectId(): string {
  return generateId('proj');
}
