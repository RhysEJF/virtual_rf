/**
 * ID generation utilities
 */

import { nanoid } from 'nanoid';

/**
 * Generate a unique project ID
 */
export function generateProjectId(): string {
  return `proj_${nanoid(12)}`;
}

/**
 * Generate a unique worker ID
 */
export function generateWorkerId(): string {
  return `work_${nanoid(12)}`;
}

/**
 * Generate a unique skill ID
 */
export function generateSkillId(): string {
  return `skill_${nanoid(12)}`;
}
