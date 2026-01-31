/**
 * API Client Module
 *
 * Provides a typed fetch wrapper for communicating with the Digital Twin API.
 * Supports GET, POST, PATCH, DELETE methods with proper error handling.
 */

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_BASE_URL = 'http://localhost:3000/api';

let baseUrl = DEFAULT_BASE_URL;

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
}

export function getBaseUrl(): string {
  return baseUrl;
}

// ============================================================================
// Error Types
// ============================================================================

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(
    public readonly cause: Error
  ) {
    super(`Network Error: ${cause.message}`);
    this.name = 'NetworkError';
  }
}

// ============================================================================
// API Response Types (matching Next.js API routes)
// ============================================================================

// Outcome types
export type OutcomeStatus = 'active' | 'dormant' | 'achieved' | 'archived';
export type GitMode = 'none' | 'local' | 'branch' | 'worktree';

export interface Outcome {
  id: string;
  name: string;
  status: OutcomeStatus;
  is_ongoing: boolean;
  brief: string | null;
  intent: string | null;
  timeline: string | null;
  capability_ready: number;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  parent_id: string | null;
  depth: number;
  working_directory: string | null;
  git_mode: GitMode;
  base_branch: string | null;
  work_branch: string | null;
  auto_commit: boolean;
  create_pr_on_complete: boolean;
}

export interface OutcomeWithCounts extends Outcome {
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  active_workers: number;
  is_converging: boolean;
}

export interface OutcomeTreeNode extends OutcomeWithCounts {
  children: OutcomeTreeNode[];
  child_count: number;
}

// Task types
export type TaskStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed';
export type TaskPhase = 'capability' | 'execution';
export type CapabilityType = 'skill' | 'tool' | 'config';

export interface Task {
  id: string;
  outcome_id: string;
  title: string;
  description: string | null;
  prd_context: string | null;
  design_context: string | null;
  status: TaskStatus;
  priority: number;
  score: number;
  attempts: number;
  max_attempts: number;
  claimed_by: string | null;
  claimed_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
  from_review: boolean;
  review_cycle: number | null;
  phase: TaskPhase;
  capability_type: CapabilityType | null;
  required_skills: string | null;
  task_intent: string | null;
  task_approach: string | null;
}

// Worker types
export type WorkerStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface Worker {
  id: string;
  outcome_id: string;
  name: string;
  status: WorkerStatus;
  current_task_id: string | null;
  iteration: number;
  last_heartbeat: number | null;
  progress_summary: string | null;
  cost: number;
  started_at: number | null;
  updated_at: number;
  worktree_path: string | null;
  branch_name: string | null;
  pid: number | null;
}

// Progress entry type
export interface ProgressEntry {
  id: number;
  outcome_id: string;
  worker_id: string;
  iteration: number;
  content: string;
  full_output: string | null;
  compacted: boolean;
  compacted_into: number | null;
  created_at: number;
}

// Skill type
export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string | null;
  path: string;
  triggers: string | null;
  requires: string | null;
  usage_count: number;
  avg_cost: number | null;
  created_at: number;
  updated_at: number;
}

// API Response wrappers
export interface OutcomesResponse {
  outcomes: Outcome[] | OutcomeWithCounts[] | OutcomeTreeNode[];
}

export interface OutcomeResponse {
  outcome: Outcome;
}

export interface TasksResponse {
  tasks: Task[];
}

export interface TaskResponse {
  task: Task;
}

export interface WorkersResponse {
  workers: Worker[];
}

export interface WorkerResponse {
  worker: Worker;
}

export interface SkillsResponse {
  skills: Skill[];
}

export interface ErrorResponse {
  error: string;
}

// Dispatch types
export type DispatchResponseType = 'quick' | 'research' | 'deep' | 'clarification' | 'outcome' | 'match_found';

export interface MatchedOutcome {
  id: string;
  name: string;
  brief: string | null;
  confidence: 'high' | 'medium';
  reason: string;
}

export interface DispatchResponse {
  type: DispatchResponseType;
  response?: string;
  questions?: string[];
  outcomeId?: string;
  navigateTo?: string;
  error?: string;
  matchedOutcomes?: MatchedOutcome[];
  originalInput?: string;
}

export interface DispatchInput {
  input: string;
  modeHint?: 'smart' | 'quick' | 'long';
  skipMatching?: boolean;
}

// Supervisor types
export interface AlertStats {
  total: number;
  active: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface SupervisorStatus {
  running: boolean;
  checkIntervalMs: number;
  alerts: AlertStats;
}

export interface ProgressResponse {
  entries: ProgressEntry[];
}

// Create/Update input types
export interface CreateOutcomeInput {
  name: string;
  brief?: string;
  intent?: string;
  timeline?: string;
  is_ongoing?: boolean;
  parent_id?: string;
  working_directory?: string;
  git_mode?: GitMode;
  base_branch?: string;
  work_branch?: string;
  auto_commit?: boolean;
  create_pr_on_complete?: boolean;
}

export interface UpdateOutcomeInput {
  name?: string;
  status?: OutcomeStatus;
  is_ongoing?: boolean;
  brief?: string;
  intent?: string;
  timeline?: string;
  capability_ready?: number;
  parent_id?: string | null;
  working_directory?: string | null;
  git_mode?: GitMode;
  base_branch?: string | null;
  work_branch?: string | null;
  auto_commit?: boolean;
  create_pr_on_complete?: boolean;
}

// ============================================================================
// HTTP Methods
// ============================================================================

interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  // Add timeout using AbortController
  const controller = new AbortController();
  const timeout = options.timeout ?? 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  fetchOptions.signal = controller.signal;

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    // Parse response body
    let responseBody: unknown;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    // Check for error responses
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText, responseBody);
    }

    return responseBody as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new NetworkError(new Error(`Request timed out after ${timeout}ms`));
      }
      throw new NetworkError(error);
    }

    throw new NetworkError(new Error(String(error)));
  }
}

// ============================================================================
// Public API Methods
// ============================================================================

export const api = {
  // GET request
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, options);
  },

  // POST request
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', path, body, options);
  },

  // PATCH request
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, options);
  },

  // DELETE request
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, options);
  },

  // ========================================================================
  // Typed API Endpoints
  // ========================================================================

  outcomes: {
    // List all outcomes
    list(params?: {
      counts?: boolean;
      tree?: boolean;
      roots_only?: boolean;
      parent_id?: string;
      status?: OutcomeStatus;
    }): Promise<OutcomesResponse> {
      const searchParams = new URLSearchParams();
      if (params?.counts) searchParams.set('counts', 'true');
      if (params?.tree) searchParams.set('tree', 'true');
      if (params?.roots_only) searchParams.set('roots_only', 'true');
      if (params?.parent_id) searchParams.set('parent_id', params.parent_id);
      if (params?.status) searchParams.set('status', params.status);
      const query = searchParams.toString();
      return api.get<OutcomesResponse>(`/outcomes${query ? `?${query}` : ''}`);
    },

    // Get single outcome
    get(id: string): Promise<OutcomeResponse> {
      return api.get<OutcomeResponse>(`/outcomes/${id}`);
    },

    // Create outcome
    create(input: CreateOutcomeInput): Promise<OutcomeResponse> {
      return api.post<OutcomeResponse>('/outcomes', input);
    },

    // Update outcome
    update(id: string, input: UpdateOutcomeInput): Promise<OutcomeResponse> {
      return api.patch<OutcomeResponse>(`/outcomes/${id}`, input);
    },

    // Delete outcome
    delete(id: string): Promise<{ success: boolean }> {
      return api.delete<{ success: boolean }>(`/outcomes/${id}`);
    },

    // Get outcome tasks
    tasks(id: string): Promise<TasksResponse> {
      return api.get<TasksResponse>(`/outcomes/${id}/tasks`);
    },

    // Get outcome progress
    progress(id: string): Promise<ProgressResponse> {
      return api.get<ProgressResponse>(`/outcomes/${id}/progress`);
    },

    // Start worker for outcome
    start(id: string): Promise<WorkerResponse> {
      return api.post<WorkerResponse>(`/outcomes/${id}/start`);
    },
  },

  workers: {
    // Get worker by ID
    get(id: string): Promise<WorkerResponse> {
      return api.get<WorkerResponse>(`/workers/${id}`);
    },

    // Update worker
    update(id: string, input: { status?: WorkerStatus }): Promise<WorkerResponse> {
      return api.patch<WorkerResponse>(`/workers/${id}`, input);
    },

    // Get worker logs
    logs(id: string): Promise<ProgressResponse> {
      return api.get<ProgressResponse>(`/workers/${id}/logs`);
    },

    // Send intervention to worker
    intervene(id: string, message: string): Promise<{ success: boolean }> {
      return api.post<{ success: boolean }>(`/workers/${id}/interventions`, { message });
    },
  },

  tasks: {
    // Get task by ID
    get(id: string): Promise<TaskResponse> {
      return api.get<TaskResponse>(`/tasks/${id}`);
    },

    // Update task
    update(id: string, input: Partial<Task>): Promise<TaskResponse> {
      return api.patch<TaskResponse>(`/tasks/${id}`, input);
    },
  },

  skills: {
    // List all skills
    list(): Promise<SkillsResponse> {
      return api.get<SkillsResponse>('/skills');
    },
  },

  // Dispatch - smart request routing
  dispatch: {
    // Send a request to the dispatcher (smart routing)
    send(input: string, options?: { modeHint?: 'smart' | 'quick' | 'long'; skipMatching?: boolean }): Promise<DispatchResponse> {
      const body: DispatchInput = { input, ...options };
      return api.post<DispatchResponse>('/dispatch', body);
    },

    // Create new outcome (bypasses matching)
    createNew(input: string, modeHint: 'long' | 'smart' = 'long'): Promise<DispatchResponse> {
      return api.post<DispatchResponse>('/dispatch', { input, modeHint, skipMatching: true });
    },
  },

  // Supervisor
  supervisor: {
    // Get supervisor status
    status(): Promise<SupervisorStatus> {
      return api.get<SupervisorStatus>('/supervisor');
    },
  },
};

export default api;
