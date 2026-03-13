/**
 * ID Resolution Utilities
 *
 * Handles prefix normalization so users can pass bare IDs from `flow list`.
 */

/**
 * Ensures an outcome ID has the `out_` prefix.
 * Allows users to copy the bare ID from `flow list` and use it directly.
 */
export function resolveOutcomeId(id: string): string {
  if (id.startsWith('out_')) return id;
  return `out_${id}`;
}

/**
 * Ensures a task ID has the `tsk_` prefix.
 */
export function resolveTaskId(id: string): string {
  if (id.startsWith('tsk_')) return id;
  return `tsk_${id}`;
}

/**
 * Ensures a worker ID has the `wrk_` prefix.
 */
export function resolveWorkerId(id: string): string {
  if (id.startsWith('wrk_')) return id;
  return `wrk_${id}`;
}
