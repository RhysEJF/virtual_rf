// Utility exports
export { api, ApiError, NetworkError, setBaseUrl, getBaseUrl } from '../api.js';
export type * from '../api.js';

// Flag utilities
export { addOutputFlags, handleOutput } from './flags.js';
export type { OutputOptions } from './flags.js';

// Visual utilities
export { statusDot, outcomeStatusLabel, taskStatusLabel, workerStatusLabel } from './status.js';
export { progressBar } from './progress.js';
export { drawTable } from './table.js';
export { createSpinner } from './spinner.js';

// ID resolution
export { resolveOutcomeId, resolveTaskId, resolveWorkerId } from './ids.js';
