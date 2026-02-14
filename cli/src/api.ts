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
  depends_on: string | null;  // JSON array of task IDs
}

// Extended task with parsed dependency info (returned by API)
export interface TaskWithDependencies extends Task {
  dependency_ids: string[];     // Parsed depends_on
  blocked_by: string[];         // Task IDs that are blocking this task
  blocks: string[];             // Task IDs that this task blocks
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

// Progress entry observation (from HOMЯ)
export interface ProgressObservation {
  quality: string;
  alignmentScore: number;
  onTrack: boolean;
  // Verbosity >= 2
  discoveries?: Array<{ type: string; content: string }>;
  drift?: Array<{ type: string; description: string; severity: string }>;
  issues?: Array<{ type: string; description: string; severity: string }>;
  hasAmbiguity?: boolean;
  ambiguityData?: { type: string; description: string } | null;
}

// Progress entry type
export interface ProgressEntry {
  id: number;
  outcome_id: string;
  worker_id: string;
  iteration: number;
  content: string;
  full_output: string | null;
  task_id: string | null;
  compacted: boolean;
  compacted_into: number | null;
  created_at: number;
  // Enriched fields (when verbosity >= 1)
  taskTitle?: string;
  observation?: ProgressObservation | null;
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

// Iterate response
export interface IterateResponse {
  success: boolean;
  tasksCreated: number;
  taskIds: string[];
  workerId: string | null;
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
  isolationMode?: IsolationMode;
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

// HOMЯ types
export type HomrDiscoveryType = 'pattern' | 'constraint' | 'insight' | 'blocker';

export interface HomrDiscovery {
  type: HomrDiscoveryType;
  content: string;
  source: string;
  createdAt: number;
}

export interface HomrDecision {
  id: string;
  content: string;
  madeBy: string;
  madeAt: number;
  context: string;
  affectedAreas: string[];
}

export interface HomrConstraint {
  rule: string;
  reason: string;
  addedAt: number;
}

export interface HomrContextInjection {
  taskId: string;
  injectedAt: number;
  content: string;
}

export interface HomrObservation {
  id: string;
  outcomeId: string;
  taskId: string;
  workerOutput: string;
  analysis: {
    summary: string;
    discoveries: HomrDiscovery[];
    concerns: string[];
    nextSteps: string[];
  };
  createdAt: number;
}

export interface HomrEscalationOption {
  id: string;
  label: string;
  description: string;
  implications: string;
}

export interface HomrEscalation {
  id: string;
  outcomeId: string;
  status: 'pending' | 'answered' | 'dismissed';
  trigger: {
    type: string;
    taskId: string;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: HomrEscalationOption[];
  };
  answer?: {
    selectedOption: string;
    additionalContext?: string;
    answeredAt: number;
  };
  createdAt: number;
}

export interface HomrActivity {
  id: number;
  outcomeId: string;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface HomrStatusResponse {
  tasksObserved: number;
  discoveriesExtracted: number;
  escalationsCreated: number;
  steeringActions: number;
  recentObservations: HomrObservation[];
  pendingEscalations: HomrEscalation[];
  recentActivity: HomrActivity[];
}

export interface HomrContextResponse {
  outcomeId: string;
  discoveries: HomrDiscovery[];
  decisions: HomrDecision[];
  constraints: HomrConstraint[];
  injections: HomrContextInjection[];
  stats: {
    tasksObserved: number;
    discoveriesExtracted: number;
    escalationsCreated: number;
    steeringActions: number;
  };
  createdAt: number | null;
  updatedAt: number | null;
}

export interface HomrEscalationsResponse {
  outcomeId: string;
  escalations: HomrEscalation[];
  pendingCount: number;
  total: number;
}

export interface HomrActivityResponse {
  outcomeId: string;
  activity: HomrActivity[];
  total: number;
}

export interface HomrAggregateOutcome {
  outcomeId: string;
  outcomeName: string;
  workersRunning: number;
  workersTotal: number;
  totalCost: number;
  pendingEscalations: number;
  failedTasks: number;
}

export interface HomrAggregateEscalation {
  id: string;
  outcomeId: string;
  outcomeName: string;
  createdAt: number;
  status: string;
  trigger: {
    type: string;
    taskId: string;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: HomrEscalationOption[];
  };
}

export interface HomrAggregateResponse {
  totalWorkersRunning: number;
  totalWorkers: number;
  totalCost: number;
  totalPending: number;
  totalFailed: number;
  outcomes: HomrAggregateOutcome[];
  escalations: HomrAggregateEscalation[];
}

export interface AutoResolveResult {
  escalationId: string;
  resolved: boolean;
  reasoning: string;
  selectedOption?: string;
  confidence?: number;
}

export interface AutoResolveResponse {
  total: number;
  resolved: number;
  deferred: number;
  results: AutoResolveResult[];
}

// Converse API types
export type ConverseResponseType = 'action' | 'response' | 'clarification' | 'error';
export type IntentType =
  | 'create_outcome'
  | 'check_status'
  | 'list_outcomes'
  | 'show_outcome'
  | 'list_tasks'
  | 'start_worker'
  | 'stop_worker'
  | 'pause_worker'
  | 'answer_escalation'
  | 'show_escalations'
  | 'iterate'
  | 'audit_outcome'
  | 'review_outcome'
  | 'help'
  | 'general_query';

export interface ActionTaken {
  action: string;
  target?: string;
  result?: string;
  success: boolean;
}

export interface ConverseIntent {
  type: IntentType;
  confidence: number;
  entities: Record<string, string | undefined>;
  description: string;
}

export interface ConverseRequest {
  message: string;
  session_id?: string;
}

export interface ConverseResponse {
  type: ConverseResponseType;
  message: string;
  session_id: string;
  intent: ConverseIntent;
  actions_taken: ActionTaken[];
  follow_up_questions?: string[];
  data?: Record<string, unknown>;
}

export interface ConversationMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export interface ConverseSession {
  id: string;
  current_outcome_id: string | null;
  created_at: number;
  last_activity_at: number;
}

export interface ConverseSessionResponse {
  session: ConverseSession;
  messages: ConversationMessage[];
}

// System config types
export type IsolationMode = 'workspace' | 'codebase';

export interface SystemConfigResponse {
  default_isolation_mode: IsolationMode;
}

export interface SystemConfigUpdate {
  default_isolation_mode?: IsolationMode;
}

// Workspace server types
export type AppType = 'node' | 'static';

export interface DetectedApp {
  id: string;
  type: AppType;
  name: string;
  path: string;
  absolutePath: string;
  framework?: string;
  entryPoint: string;
  scripts?: {
    dev?: boolean;
    start?: boolean;
    build?: boolean;
  };
}

export interface RunningServer {
  id: string;
  outcomeId: string;
  appId: string;
  type: AppType;
  pid: number;
  port: number;
  command: string;
  url: string;
  startedAt: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
}

export interface AppServerResponse {
  outcomeId: string;
  apps: DetectedApp[];
  servers: RunningServer[];
  hasRunningServers: boolean;
}

export interface StartServerResponse {
  success: boolean;
  server: RunningServer;
  message: string;
}

export interface StopServerResponse {
  success: boolean;
  stopped: number;
  message: string;
}

// Converse Agent API types (new agentic endpoint)
export type ConverseAgentResponseType = 'action' | 'response' | 'error';

export interface ConverseAgentToolCall {
  name: string;
  success: boolean;
}

export interface ConverseAgentRequest {
  message: string;
  session_id?: string;
}

export interface ConverseAgentResponse {
  type: ConverseAgentResponseType;
  message: string;
  session_id: string;
  tool_calls?: ConverseAgentToolCall[];
  data?: Record<string, unknown>;
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
    // List all workers with optional outcome filter
    list(params?: { outcome?: string }): Promise<WorkersResponse> {
      const searchParams = new URLSearchParams();
      if (params?.outcome) searchParams.set('outcome', params.outcome);
      const query = searchParams.toString();
      return api.get<WorkersResponse>(`/workers${query ? `?${query}` : ''}`);
    },

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

  // Iterate - create tasks from user feedback
  iterate: {
    // Submit feedback to create new tasks
    submit(outcomeId: string, feedback: string, options?: { startWorker?: boolean }): Promise<IterateResponse> {
      return api.post<IterateResponse>(`/outcomes/${outcomeId}/iterate`, {
        feedback,
        ...options,
      });
    },
  },

  // Dispatch - smart request routing
  dispatch: {
    // Send a request to the dispatcher (smart routing)
    send(input: string, options?: { modeHint?: 'smart' | 'quick' | 'long'; skipMatching?: boolean; isolationMode?: IsolationMode }): Promise<DispatchResponse> {
      const body: DispatchInput = { input, ...options };
      return api.post<DispatchResponse>('/dispatch', body);
    },

    // Create new outcome (bypasses matching)
    createNew(input: string, modeHint: 'long' | 'smart' = 'long', isolationMode?: IsolationMode): Promise<DispatchResponse> {
      const body: DispatchInput = { input, modeHint, skipMatching: true };
      if (isolationMode) {
        body.isolationMode = isolationMode;
      }
      return api.post<DispatchResponse>('/dispatch', body);
    },
  },

  // Supervisor
  supervisor: {
    // Get supervisor status
    status(): Promise<SupervisorStatus> {
      return api.get<SupervisorStatus>('/supervisor');
    },
  },

  // HOMЯ - Intelligent orchestration layer
  homr: {
    // Get HOMЯ status for an outcome (includes recent observations, pending escalations, activity)
    status(outcomeId: string): Promise<HomrStatusResponse> {
      return api.get<HomrStatusResponse>(`/outcomes/${outcomeId}/homr`);
    },

    // Get full context store for an outcome
    context(outcomeId: string): Promise<HomrContextResponse> {
      return api.get<HomrContextResponse>(`/outcomes/${outcomeId}/homr/context`);
    },

    // Get escalations for an outcome
    escalations(outcomeId: string, params?: { pending?: boolean; limit?: number }): Promise<HomrEscalationsResponse> {
      const searchParams = new URLSearchParams();
      if (params?.pending) searchParams.set('pending', 'true');
      if (params?.limit) searchParams.set('limit', String(params.limit));
      const query = searchParams.toString();
      return api.get<HomrEscalationsResponse>(`/outcomes/${outcomeId}/homr/escalations${query ? `?${query}` : ''}`);
    },

    // Get activity log for an outcome
    activity(outcomeId: string, params?: { limit?: number; type?: string }): Promise<HomrActivityResponse> {
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.type) searchParams.set('type', params.type);
      const query = searchParams.toString();
      return api.get<HomrActivityResponse>(`/outcomes/${outcomeId}/homr/activity${query ? `?${query}` : ''}`);
    },

    // Get aggregated HOMЯ stats across all outcomes
    aggregate(): Promise<HomrAggregateResponse> {
      return api.get<HomrAggregateResponse>('/homr/aggregate');
    },

    // Answer an escalation
    answerEscalation(outcomeId: string, escalationId: string, answer: { selectedOption: string; additionalContext?: string }): Promise<{ success: boolean }> {
      return api.post<{ success: boolean }>(`/outcomes/${outcomeId}/homr/escalations/${escalationId}/answer`, answer);
    },

    // Dismiss an escalation
    dismissEscalation(outcomeId: string, escalationId: string): Promise<{ success: boolean }> {
      return api.post<{ success: boolean }>(`/outcomes/${outcomeId}/homr/escalations/${escalationId}/dismiss`);
    },

    // Auto-resolve pending escalations (YOLO mode)
    autoResolve(outcomeId: string): Promise<AutoResolveResponse> {
      return api.post<AutoResolveResponse>(`/outcomes/${outcomeId}/auto-resolve`, { mode: 'full-auto' });
    },
  },

  // Converse - Multi-turn conversational API
  converse: {
    // Send a message to the conversational API (original intent-based)
    send(message: string, sessionId?: string): Promise<ConverseResponse> {
      const body: ConverseRequest = { message };
      if (sessionId) {
        body.session_id = sessionId;
      }
      return api.post<ConverseResponse>('/converse', body);
    },

    // Get session info and message history
    session(sessionId: string): Promise<ConverseSessionResponse> {
      return api.get<ConverseSessionResponse>(`/converse?session_id=${encodeURIComponent(sessionId)}`);
    },
  },

  // Converse Agent - Agentic conversational API with tools
  converseAgent: {
    // Send a message to the agentic conversational API
    send(message: string, sessionId?: string): Promise<ConverseAgentResponse> {
      const body: ConverseAgentRequest = { message };
      if (sessionId) {
        body.session_id = sessionId;
      }
      return api.post<ConverseAgentResponse>('/converse-agent', body);
    },

    // Get session info and message history (same endpoint as converse)
    session(sessionId: string): Promise<ConverseSessionResponse> {
      return api.get<ConverseSessionResponse>(`/converse-agent?session_id=${encodeURIComponent(sessionId)}`);
    },
  },

  // System config - Global settings
  config: {
    // Get system configuration
    get(): Promise<SystemConfigResponse> {
      return api.get<SystemConfigResponse>('/config');
    },

    // Update system configuration
    update(config: SystemConfigUpdate): Promise<SystemConfigResponse> {
      return api.patch<SystemConfigResponse>('/config', config);
    },
  },

  // Workspace servers - Dev server management for outcomes
  servers: {
    // Get apps and servers for an outcome
    get(outcomeId: string): Promise<AppServerResponse> {
      return api.get<AppServerResponse>(`/outcomes/${outcomeId}/server`);
    },

    // Start a server for an app
    start(outcomeId: string, appId?: string): Promise<StartServerResponse> {
      return api.post<StartServerResponse>(`/outcomes/${outcomeId}/server`, appId ? { appId } : undefined);
    },

    // Stop a server (specific or all for outcome)
    stop(outcomeId: string, appId?: string): Promise<StopServerResponse> {
      const query = appId ? `?appId=${encodeURIComponent(appId)}` : '';
      return api.delete<StopServerResponse>(`/outcomes/${outcomeId}/server${query}`);
    },
  },
};

export default api;
