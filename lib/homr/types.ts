/**
 * HOMЯ Protocol Type Definitions
 *
 * TypeScript interfaces for the HOMЯ intelligent orchestration layer.
 * Re-exports database types and adds runtime-specific types.
 */

import type {
  HomrQuality,
  HomrDriftType,
  HomrDiscoveryType,
  HomrAmbiguityType,
  HomrActivityType,
  HomrEscalationStatus,
  HomrDriftItem,
  HomrDiscovery,
  HomrQualityIssue,
  HomrAmbiguitySignal,
  HomrQuestionOption,
  HomrDecision,
  HomrConstraint,
  HomrContextInjection,
  Task,
  Intent,
} from '../db/schema';

// Re-export database types
export type {
  HomrQuality,
  HomrDriftType,
  HomrDiscoveryType,
  HomrAmbiguityType,
  HomrActivityType,
  HomrEscalationStatus,
  HomrDriftItem,
  HomrDiscovery,
  HomrQualityIssue,
  HomrAmbiguitySignal,
  HomrQuestionOption,
  HomrDecision,
  HomrConstraint,
  HomrContextInjection,
};

// ============================================================================
// Observation Types
// ============================================================================

/**
 * Result of observing a completed task
 */
export interface ObservationResult {
  taskId: string;
  outcomeId: string;
  timestamp: number;

  // Alignment assessment
  onTrack: boolean;
  alignmentScore: number;  // 0-100
  drift: HomrDriftItem[];

  // Quality assessment
  quality: HomrQuality;
  issues: HomrQualityIssue[];

  // Extracted learnings
  discoveries: HomrDiscovery[];

  // Ambiguity detection
  ambiguity: HomrAmbiguitySignal | null;

  // Summary for logging
  summary: string;
}

/**
 * Input for creating an observation
 */
export interface ObserveTaskInput {
  task: Task;
  fullOutput: string;
  intent: Intent | null;
  designDoc: string | null;
  outcomeId: string;
}

// ============================================================================
// Steering Types
// ============================================================================

/**
 * Types of steering actions HOMЯ can take
 */
export type SteeringActionType =
  | 'inject_context'
  | 'update_task'
  | 'create_task'
  | 'update_priority'
  | 'mark_obsolete';

/**
 * A steering action to be executed
 */
export interface SteeringAction {
  type: SteeringActionType;
  reason: string;
  timestamp: number;
}

export interface InjectContextAction extends SteeringAction {
  type: 'inject_context';
  taskIds: string[];
  context: HomrContextInjection;
}

export interface UpdateTaskAction extends SteeringAction {
  type: 'update_task';
  taskId: string;
  additions: string;
}

export interface CreateTaskAction extends SteeringAction {
  type: 'create_task';
  task: {
    title: string;
    description: string;
    priority: number;
    phase?: 'capability' | 'execution';
  };
}

export interface UpdatePriorityAction extends SteeringAction {
  type: 'update_priority';
  taskId: string;
  newPriority: number;
}

export interface MarkObsoleteAction extends SteeringAction {
  type: 'mark_obsolete';
  taskId: string;
}

export type AnySteeringAction =
  | InjectContextAction
  | UpdateTaskAction
  | CreateTaskAction
  | UpdatePriorityAction
  | MarkObsoleteAction;

/**
 * Result of steering after observation
 */
export interface SteeringResult {
  actions: AnySteeringAction[];
  summary: string;
}

// ============================================================================
// Escalation Types
// ============================================================================

/**
 * Input for creating an escalation
 */
export interface CreateEscalationInput {
  outcomeId: string;
  ambiguity: HomrAmbiguitySignal;
  task: Task;
}

/**
 * Answer to an escalation question
 */
export interface EscalationAnswer {
  selectedOption: string;
  additionalContext?: string;
}

/**
 * Actions that can be applied when resolving an escalation
 */
export type EscalationActionType =
  | 'increase_turn_limit'
  | 'break_into_subtasks'
  | 'skip_failing_tasks';

/**
 * Result of applying an escalation action
 */
export interface EscalationActionResult {
  action: EscalationActionType;
  success: boolean;
  details: {
    taskId?: string;
    taskIds?: string[];
    previousValue?: number;
    newValue?: number;
    subtaskCount?: number;
    createdTaskIds?: string[];
    error?: string;
    /** True if the action was skipped due to idempotency checks */
    skipped?: boolean;
    /** Reason the action was skipped (if skipped=true) */
    reason?: string;
  };
}

/**
 * Result of resolving an escalation
 */
export interface EscalationResolution {
  escalationId: string;
  selectedOption: HomrQuestionOption;
  resumedTasks: string[];
  injectedContext: string;
  /** Actions that were applied based on the selected option */
  appliedActions?: EscalationActionResult[];
  /** Pattern stored for future reference */
  storedPattern?: {
    triggerType: string;
    optionId: string;
    count: number;
  };
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Parsed context store with typed arrays
 */
export interface ParsedContextStore {
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
}

/**
 * Context to inject into a task's CLAUDE.md
 */
export interface TaskContext {
  discoveries: HomrDiscovery[];
  injections: HomrContextInjection[];
  decisions: HomrDecision[];
  constraints: HomrConstraint[];
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * HOMЯ configuration options
 */
export interface HomrConfig {
  enabled: boolean;

  // Observation settings
  observeAfterEveryTask: boolean;
  observationModel: 'haiku' | 'sonnet';

  // Steering settings
  autoCreateCorrectiveTasks: boolean;
  autoAdjustPriority: boolean;
  maxSteeringActionsPerTask: number;

  // Escalation settings
  autoEscalate: boolean;
  escalationThreshold: 'low' | 'medium' | 'high';
  pauseOnEscalation: boolean;

  // Context settings
  maxDiscoveries: number;
  contextCompactionThreshold: number;
}

/**
 * Default HOMЯ configuration
 */
export const DEFAULT_HOMR_CONFIG: HomrConfig = {
  enabled: true,
  observeAfterEveryTask: true,
  observationModel: 'haiku',
  autoCreateCorrectiveTasks: true,
  autoAdjustPriority: true,
  maxSteeringActionsPerTask: 5,
  autoEscalate: true,
  escalationThreshold: 'medium',
  pauseOnEscalation: true,
  maxDiscoveries: 50,
  contextCompactionThreshold: 100,
};

// ============================================================================
// Claude Response Types (for parsing AI responses)
// ============================================================================

/**
 * Expected format of Claude's observation analysis response
 */
export interface ClaudeObservationResponse {
  onTrack: boolean;
  alignmentScore: number;
  quality: HomrQuality;
  drift: Array<{
    type: HomrDriftType;
    description: string;
    severity: 'low' | 'medium' | 'high';
    evidence: string;
  }>;
  discoveries: Array<{
    type: HomrDiscoveryType;
    content: string;
    relevantTasks: string[];
  }>;
  issues: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  ambiguity: {
    detected: boolean;
    type?: HomrAmbiguityType;
    description?: string;
    evidence?: string[];
    suggestedQuestion?: string;
  } | null;
  summary: string;
}

/**
 * Expected format of Claude's escalation question generation response
 */
export interface ClaudeEscalationQuestionResponse {
  questionText: string;
  questionContext: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    implications: string;
  }>;
}
