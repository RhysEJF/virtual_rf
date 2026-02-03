/**
 * Database schema types and SQL definitions
 *
 * Data Model (per James's compound engineering research):
 * - Outcomes: High-level goals (replaces projects as primary unit)
 * - Design Docs: HOW to achieve the outcome (can change without changing intent)
 * - Tasks: Executable work items (generated from PRD + Design Doc, atomic claiming)
 * - Workers: Ralph instances that claim and execute tasks
 */

// ============================================================================
// Type Definitions
// ============================================================================

// Outcome states (recency-based, attention-focused)
export type OutcomeStatus =
  | 'active'    // Currently being worked on
  | 'dormant'   // Paused intentionally
  | 'achieved'  // Explicitly completed (celebration moment)
  | 'archived'; // No longer relevant

// Task states for atomic claiming
export type TaskStatus =
  | 'pending'   // Ready to be claimed
  | 'claimed'   // Worker has claimed it
  | 'running'   // Worker is actively working
  | 'completed' // Successfully finished
  | 'failed';   // Failed after attempts

export type WorkerStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export type InterventionType = 'clarification' | 'redirect' | 'skill_gap' | 'error';
export type InterventionActionType = 'add_task' | 'redirect' | 'pause' | 'priority_change';
export type InterventionStatus = 'pending' | 'acknowledged' | 'completed' | 'dismissed';
export type SuggestionType = 'skill' | 'automation' | 'process';
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

// Supervisor alert types
export type SupervisorAlertType =
  | 'stuck'
  | 'no_progress'
  | 'repeated_errors'
  | 'high_cost'
  | 'suspicious_behavior'
  | 'worker_paused'
  | 'scope_violation'
  | 'env_access'
  | 'mass_deletion'
  | 'system_file_access';
export type SupervisorAlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SupervisorAlertStatus = 'active' | 'acknowledged' | 'resolved';

// HOMЯ Protocol types
export type HomrQuality = 'good' | 'needs_work' | 'off_rails';
export type HomrEscalationStatus = 'pending' | 'answered' | 'dismissed';
export type HomrActivityType = 'observation' | 'steering' | 'escalation' | 'resolution';
export type HomrDriftType = 'scope_creep' | 'wrong_direction' | 'missed_requirement' | 'contradicts_design';
export type HomrDiscoveryType = 'constraint' | 'dependency' | 'pattern' | 'decision' | 'blocker';
export type HomrAmbiguityType = 'unclear_requirement' | 'multiple_approaches' | 'blocking_decision' | 'contradicting_info';

// Git workflow modes for outcomes
export type GitMode = 'none' | 'local' | 'branch' | 'worktree';

// Repository configuration for skills/tools/files/outputs
export type SaveTarget = 'local' | 'repo' | 'inherit';

// Sync status for item-to-repo relationships
export type SyncStatus = 'synced' | 'failed' | 'stale';

// ============================================================================
// Core Entities
// ============================================================================

// Supervisor settings for AI safety/observability
export type PauseSensitivity = 'low' | 'medium' | 'high';
export type CoTReviewFrequency = 'every_task' | 'every_5_min' | 'on_patterns_only';

export interface Outcome {
  id: string;
  name: string;
  status: OutcomeStatus;
  is_ongoing: boolean;              // true = never "achieves", has milestones instead
  brief: string | null;             // Original user input/ramble
  intent: string | null;            // PRD - the WHAT (JSON)
  timeline: string | null;          // Target date or "ongoing"
  capability_ready: number;         // 0 = not started, 1 = in progress, 2 = complete
  created_at: number;
  updated_at: number;
  last_activity_at: number;         // For recency-based sorting
  // Hierarchy (for nested outcomes)
  parent_id: string | null;         // Parent outcome ID (null = root)
  depth: number;                    // 0 = root, 1 = child, 2 = grandchild, etc.
  // Git configuration
  working_directory: string | null; // Path to workspace/repo
  git_mode: GitMode;                // 'none' | 'local' | 'branch' | 'worktree'
  base_branch: string | null;       // e.g., 'main' - branch to merge into
  work_branch: string | null;       // e.g., 'outcome/my-feature' - working branch
  auto_commit: boolean;             // Auto-commit after successful task completion
  create_pr_on_complete: boolean;   // Create PR when outcome achieved
  // Supervisor settings
  supervisor_enabled: boolean;      // Should supervisor monitor this outcome
  pause_sensitivity: PauseSensitivity;  // How aggressive auto-pause should be
  cot_review_frequency: CoTReviewFrequency; // How often to run AI review
  // Repository configuration (per-outcome with inheritance)
  repository_id: string | null;     // FK to repositories (null = no repo / inherit from parent)
  output_target: SaveTarget;        // 'local' | 'repo' | 'inherit'
  skill_target: SaveTarget;
  tool_target: SaveTarget;
  file_target: SaveTarget;
  auto_save: boolean | 'inherit';   // Auto-save as workers build (or inherit from parent)
}

export interface DesignDoc {
  id: string;
  outcome_id: string;
  version: number;                  // Increment on updates
  approach: string;                 // The HOW (JSON or markdown)
  created_at: number;
  updated_at: number;
}

export interface Collaborator {
  id: string;
  outcome_id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'collaborator' | 'viewer';
  invited_at: number;
  accepted_at: number | null;
}

export type TaskPhase = 'capability' | 'execution';
export type CapabilityType = 'skill' | 'tool' | 'config';
/** @deprecated Use CapabilityType instead */
export type InfraType = CapabilityType;

// Decomposition tracking status for worker resilience
export type DecompositionStatus = 'in_progress' | 'completed' | 'failed';

export interface Task {
  id: string;
  outcome_id: string;
  title: string;
  description: string | null;
  prd_context: string | null;       // Which PRD item this relates to
  design_context: string | null;    // Which design decision this implements
  status: TaskStatus;
  priority: number;                 // Lower = higher priority
  score: number;                    // For dynamic reprioritization
  attempts: number;                 // How many times attempted
  max_attempts: number;             // Give up after this many
  claimed_by: string | null;        // Worker ID
  claimed_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
  // For review-generated tasks
  from_review: boolean;
  review_cycle: number | null;
  // For skill-first orchestration
  phase: TaskPhase;                 // 'capability' | 'execution'
  capability_type: CapabilityType | null;  // 'skill' | 'tool' | 'config' | null
  // Skill dependencies
  required_skills: string | null;   // JSON array of skill names this task requires
  // Enriched task context (optional per-task PRD/approach)
  task_intent: string | null;       // Mini-PRD: what this task should achieve
  task_approach: string | null;     // How to execute: methodology, tools, constraints
  // Task dependencies
  depends_on: string | null;        // JSON array of task IDs this task depends on
  // Required capabilities (skills/tools) for this task
  required_capabilities: string | null;  // JSON array of strings like 'skill:name' or 'tool:name'
  // Complexity estimation (for worker resilience feedback loop)
  complexity_score: number | null;  // AI-estimated complexity (1-10 scale)
  estimated_turns: number | null;   // AI-estimated turns/iterations to complete
  // Decomposition tracking (for preventing race conditions and idempotency)
  decomposition_status: DecompositionStatus | null;  // null = not decomposed, 'in_progress' | 'completed' | 'failed'
  decomposed_from_task_id: string | null;            // FK to parent task if this is a subtask
}

export interface Worker {
  id: string;
  outcome_id: string;
  name: string;
  status: WorkerStatus;
  current_task_id: string | null;
  iteration: number;
  last_heartbeat: number | null;    // For stale detection
  progress_summary: string | null;  // Compacted progress
  cost: number;
  started_at: number | null;
  updated_at: number;
  // Parallel worker support
  worktree_path: string | null;     // Path to git worktree
  branch_name: string | null;       // Git branch name for this worker
  // Process tracking for proper pause/stop
  pid: number | null;               // Process ID of spawned Claude CLI
}

export type MergeQueueStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'conflicted';

export interface MergeQueueEntry {
  id: number;
  outcome_id: string;
  source_worker_id: string;
  status: MergeQueueStatus;
  conflict_files: string | null;    // JSON array of conflicting files
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface ReviewCycle {
  id: string;
  outcome_id: string;
  worker_id: string | null;
  cycle_number: number;
  iteration_at: number;             // Which iteration triggered this
  issues_found: number;
  tasks_added: number;
  verification: string | null;      // JSON of verification checklist results
  raw_response: string | null;      // Claude's full reasoning/analysis
  created_at: number;
}

// ============================================================================
// Supporting Entities (kept from original)
// ============================================================================

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string | null;
  path: string;
  triggers: string | null;          // JSON array of trigger phrases
  requires: string | null;          // JSON array of required API key names
  usage_count: number;
  avg_cost: number | null;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// Repository Configuration Entities
// ============================================================================

export interface Repository {
  id: string;
  name: string;                     // Descriptive name (e.g., "Client A Shared", "Personal Archive")
  local_path: string;               // Local clone path
  remote_url: string | null;        // Git remote URL (null for local-only)
  auto_push: boolean;               // Push immediately after committing
  created_at: number;
  updated_at: number;
}

export type OutcomeItemType = 'output' | 'skill' | 'tool' | 'file';

export interface OutcomeItem {
  id: string;
  outcome_id: string;
  item_type: OutcomeItemType;       // 'output' | 'skill' | 'tool' | 'file'
  filename: string;
  file_path: string;
  target_override: SaveTarget | null;  // null = use outcome default, 'local' | 'repo' | 'inherit'
  synced_to: string | null;         // @deprecated - Use item_repo_syncs junction table instead
  last_synced_at: number | null;    // @deprecated - Use item_repo_syncs junction table instead
  created_at: number;
  updated_at: number;
}

/**
 * Junction table for multi-destination repository syncing
 * An item can be synced to multiple repositories independently
 */
export interface ItemRepoSync {
  id: string;
  item_id: string;                  // FK to outcome_items.id
  repo_id: string;                  // FK to repositories.id
  synced_at: number;                // Timestamp of last successful sync
  commit_hash: string | null;       // Git commit hash if applicable
  sync_status: SyncStatus;          // 'synced' | 'failed' | 'stale'
  error_message: string | null;     // Error details if sync_status is 'failed'
  created_at: number;
  updated_at: number;
}

export interface CostLogEntry {
  id: number;
  outcome_id: string | null;
  worker_id: string | null;
  task_id: string | null;
  amount: number;
  description: string | null;
  created_at: number;
}

export interface BottleneckLogEntry {
  id: number;
  outcome_id: string | null;
  intervention_type: InterventionType;
  description: string;
  resolution: string | null;
  created_at: number;
}

export interface ImprovementSuggestion {
  id: number;
  type: SuggestionType;
  title: string;
  description: string;
  priority: number;
  status: SuggestionStatus;
  created_at: number;
}

export interface ProgressEntry {
  id: number;
  outcome_id: string;
  worker_id: string;
  iteration: number;
  content: string;                  // Summary/log message
  full_output: string | null;       // Complete Claude output (stdout/stderr)
  compacted: boolean;               // Has this been compacted?
  compacted_into: number | null;    // ID of compacted summary entry
  created_at: number;
}

// Activity types for the activity feed
export type ActivityType =
  | 'task_completed'
  | 'task_claimed'
  | 'task_failed'
  | 'worker_started'
  | 'worker_completed'
  | 'worker_failed'
  | 'review_completed'
  | 'outcome_created'
  | 'outcome_achieved'
  | 'design_updated'
  | 'intent_updated'
  | 'analysis_started'
  | 'analysis_completed'
  | 'analysis_failed'
  | 'improvement_created';

export interface Activity {
  id: number;
  outcome_id: string;
  outcome_name: string | null;      // Denormalized for display
  type: ActivityType;
  title: string;
  description: string | null;
  metadata: string | null;          // JSON for additional data
  created_at: number;
}

export interface Intervention {
  id: string;
  outcome_id: string;
  worker_id: string | null;         // NULL means for any worker on this outcome
  type: InterventionActionType;
  message: string;
  priority: number;                 // Higher = more urgent
  status: InterventionStatus;
  created_at: number;
  acknowledged_at: number | null;
  completed_at: number | null;
}

export interface SupervisorAlert {
  id: number;
  worker_id: string;
  outcome_id: string;
  type: SupervisorAlertType;
  severity: SupervisorAlertSeverity;
  message: string;
  status: SupervisorAlertStatus;
  auto_paused: boolean;             // Whether the supervisor auto-paused the worker
  created_at: number;
  acknowledged_at: number | null;
  resolved_at: number | null;
}

// ============================================================================
// HOMЯ Protocol Entities
// ============================================================================

export interface HomrDriftItem {
  type: HomrDriftType;
  description: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string;
}

export interface HomrDiscovery {
  type: HomrDiscoveryType;
  content: string;
  relevantTasks: string[];
  source: string;
}

export interface HomrQualityIssue {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface HomrAmbiguitySignal {
  detected: boolean;
  type: HomrAmbiguityType;
  description: string;
  evidence: string[];
  affectedTasks: string[];
  suggestedQuestion: string;
  options?: HomrQuestionOption[];
}

export interface HomrQuestionOption {
  id: string;
  label: string;
  description: string;
  implications: string;
}

export interface HomrDecision {
  id: string;
  content: string;
  madeBy: 'human' | 'worker' | 'homr';
  madeAt: number;
  context: string;
  affectedAreas: string[];
}

export interface HomrConstraint {
  id: string;
  type: 'technical' | 'business' | 'dependency' | 'resource';
  content: string;
  discoveredAt: number;
  source: string;
  active: boolean;
}

export interface HomrContextInjection {
  id: string;
  type: 'discovery' | 'warning' | 'constraint' | 'pattern' | 'decision';
  content: string;
  source: string;
  priority: 'must_know' | 'should_know' | 'nice_to_know';
  targetTaskId: string;
  createdAt: number;
}

// HOMЯ Context Store (database entity)
export interface HomrContext {
  id: string;
  outcome_id: string;
  created_at: number;
  updated_at: number;
  discoveries: string;              // JSON array of HomrDiscovery
  decisions: string;                // JSON array of HomrDecision
  constraints: string;              // JSON array of HomrConstraint
  injections: string;               // JSON array of HomrContextInjection
  tasks_observed: number;
  discoveries_extracted: number;
  escalations_created: number;
  steering_actions: number;
}

// HOMЯ Observation (database entity)
export interface HomrObservation {
  id: string;
  outcome_id: string;
  task_id: string;
  created_at: number;
  on_track: number;                 // 0 or 1 (boolean in SQLite)
  alignment_score: number;
  quality: HomrQuality;
  drift: string;                    // JSON array of HomrDriftItem
  discoveries: string;              // JSON array of HomrDiscovery
  issues: string;                   // JSON array of HomrQualityIssue
  has_ambiguity: number;            // 0 or 1 (boolean in SQLite)
  ambiguity_data: string | null;    // JSON of HomrAmbiguitySignal
  summary: string;
}

// HOMЯ Escalation (database entity)
export interface HomrEscalation {
  id: string;
  outcome_id: string;
  created_at: number;
  status: HomrEscalationStatus;
  trigger_type: string;
  trigger_task_id: string;
  trigger_evidence: string;         // JSON array
  question_text: string;
  question_context: string;
  question_options: string;         // JSON array of HomrQuestionOption
  affected_tasks: string;           // JSON array of task IDs
  answer_option: string | null;
  answer_context: string | null;
  answered_at: number | null;
  incorporated_into_outcome_id: string | null;  // Improvement outcome that addressed this escalation
  incorporated_at: number | null;               // When it was incorporated
}

// HOMЯ Activity Log Entry (database entity)
export interface HomrActivityLogEntry {
  id: string;
  outcome_id: string;
  created_at: number;
  type: HomrActivityType;
  details: string;                  // JSON object
  summary: string;
}

// ============================================================================
// Parsed/Enriched Types
// ============================================================================

export interface PRDItem {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'done';
}

export interface Intent {
  summary: string;
  items: PRDItem[];
  success_criteria: string[];
  metadata?: {
    total_items: number;
    completed_items: number;
  };
}

export interface Approach {
  summary: string;
  technologies: string[];
  architecture: string;
  decisions: { decision: string; rationale: string }[];
  version: number;
}

export interface VerificationResult {
  build: boolean;
  test: boolean;
  lint: boolean;
  functionality: boolean;
  prd_complete: boolean;
  tasks_complete: boolean;
  review_clean: boolean;
  converged: boolean;
  checked_at: number;
}

export interface OutcomeWithRelations extends Outcome {
  design_doc: DesignDoc | null;
  collaborators: Collaborator[];
  tasks: Task[];
  workers: Worker[];
  active_task_count: number;
  completed_task_count: number;
  review_cycles: ReviewCycle[];
}

// ============================================================================
// Supervisor Types (AI Safety & Observability)
// ============================================================================

export type PatternSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SupervisorAction = 'log' | 'alert' | 'pause';
export type BehaviorRecommendation = 'continue' | 'review' | 'pause';

// Guard block for destructive command interception
export interface GuardBlock {
  id: string;
  worker_id: string;
  outcome_id: string;
  command: string;                // The blocked command
  pattern_matched: string;        // Which pattern triggered the block
  blocked_at: number;             // Timestamp when blocked
  context: string | null;         // JSON context about why this was blocked
}

// ============================================================================
// Analysis Job Entities
// ============================================================================

export type AnalysisJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type AnalysisJobType = 'improvement_analysis';

export interface AnalysisJob {
  id: string;
  outcome_id: string | null;      // NULL for system-wide analysis
  job_type: AnalysisJobType;
  status: AnalysisJobStatus;
  progress_message: string | null;// Current step description
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;          // JSON of analysis results
  error: string | null;
}

export interface ChangeSnapshot {
  id: string;
  worker_id: string;
  outcome_id: string;
  task_id: string | null;
  timestamp: number;
  files_created: string[];      // JSON in DB
  files_modified: string[];     // JSON in DB
  files_deleted: string[];      // JSON in DB
  git_commits: string[];        // JSON in DB - commit hashes
  git_diff_summary: string | null;
  pre_snapshot: string | null;  // JSON in DB - path -> content before (for rollback)
}

export interface BehaviorReview {
  id: string;
  worker_id: string;
  outcome_id: string;
  snapshot_id: string;
  timestamp: number;
  alignment_score: number;      // 0-100
  concerns: string[];           // JSON in DB
  deception_indicators: string[]; // JSON in DB
  recommendation: BehaviorRecommendation;
  reasoning: string;
  action_taken: SupervisorAction | null;
}

export interface PatternDetection {
  id: string;
  worker_id: string;
  outcome_id: string;
  pattern_id: string;
  pattern_name: string;
  timestamp: number;
  severity: PatternSeverity;
  details: string;
  files_involved: string[];     // JSON in DB
  action_taken: SupervisorAction | null;
}

// ============================================================================
// SQL Schema
// ============================================================================

export const SCHEMA_SQL = `
-- ============================================================================
-- Core Tables
-- ============================================================================

-- Outcomes: High-level goals (primary organizational unit)
CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  is_ongoing INTEGER NOT NULL DEFAULT 0,
  brief TEXT,
  intent TEXT,
  timeline TEXT,
  capability_ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  -- Hierarchy (for nested outcomes)
  parent_id TEXT REFERENCES outcomes(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL DEFAULT 0,
  -- Git configuration
  working_directory TEXT,
  git_mode TEXT NOT NULL DEFAULT 'none',
  base_branch TEXT,
  work_branch TEXT,
  auto_commit INTEGER NOT NULL DEFAULT 0,
  create_pr_on_complete INTEGER NOT NULL DEFAULT 0
);

-- Design Docs: HOW to achieve outcomes (versioned)
CREATE TABLE IF NOT EXISTS design_docs (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  approach TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE
);

-- Collaborators: People with access to outcomes
CREATE TABLE IF NOT EXISTS collaborators (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'collaborator',
  invited_at INTEGER NOT NULL,
  accepted_at INTEGER,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  UNIQUE(outcome_id, email)
);

-- Tasks: Executable work items with atomic claiming
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  prd_context TEXT,
  design_context TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  claimed_by TEXT,
  claimed_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  from_review INTEGER NOT NULL DEFAULT 0,
  review_cycle INTEGER,
  phase TEXT NOT NULL DEFAULT 'execution',
  capability_type TEXT,
  required_skills TEXT,
  -- Enriched task context (optional per-task PRD/approach)
  task_intent TEXT,
  task_approach TEXT,
  -- Task dependencies
  depends_on TEXT DEFAULT '[]',
  -- Required capabilities (skills/tools)
  required_capabilities TEXT DEFAULT '[]',
  -- Complexity estimation (for worker resilience feedback loop)
  complexity_score INTEGER,
  estimated_turns INTEGER,
  -- Decomposition tracking (for preventing race conditions and idempotency)
  decomposition_status TEXT,         -- null | 'in_progress' | 'completed' | 'failed'
  decomposed_from_task_id TEXT,      -- FK to tasks.id (parent task if this is a subtask)
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (claimed_by) REFERENCES workers(id) ON DELETE SET NULL,
  FOREIGN KEY (decomposed_from_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Workers: Ralph instances
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  current_task_id TEXT,
  iteration INTEGER NOT NULL DEFAULT 0,
  last_heartbeat INTEGER,
  progress_summary TEXT,
  cost REAL DEFAULT 0,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  worktree_path TEXT,
  branch_name TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (current_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Merge Queue: Track worker branch merges
CREATE TABLE IF NOT EXISTS merge_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id TEXT NOT NULL,
  source_worker_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  conflict_files TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (source_worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- Review Cycles: Track convergence
CREATE TABLE IF NOT EXISTS review_cycles (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  worker_id TEXT,
  cycle_number INTEGER NOT NULL,
  iteration_at INTEGER NOT NULL,
  issues_found INTEGER NOT NULL DEFAULT 0,
  tasks_added INTEGER NOT NULL DEFAULT 0,
  verification TEXT,
  raw_response TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE SET NULL
);

-- ============================================================================
-- Legacy Tables (kept for backwards compatibility during transition)
-- ============================================================================

-- Projects table (legacy - use outcomes instead)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  brief TEXT,
  prd TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Legacy workers table structure (for projects)
-- Note: New workers table above is for outcomes
-- This allows old code to continue working

-- ============================================================================
-- Supporting Tables
-- ============================================================================

-- Skills library
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  path TEXT NOT NULL,
  triggers TEXT,
  requires TEXT,
  usage_count INTEGER DEFAULT 0,
  avg_cost REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============================================================================
-- Repository Configuration Tables
-- ============================================================================

-- Repositories: Named git repos for syncing content (used by outcomes)
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,              -- Descriptive name (e.g., "Client A Shared")
  local_path TEXT NOT NULL,        -- Local clone path
  remote_url TEXT,                 -- Git remote URL (null for local-only)
  auto_push INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Outcome Items: Track individual items and their sync status
CREATE TABLE IF NOT EXISTS outcome_items (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,         -- 'output' | 'skill' | 'tool' | 'file'
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  target_override TEXT,            -- null = use outcome default, or 'local' | 'repo' | 'inherit'
  synced_to TEXT,                  -- Repository ID synced to (null = local only)
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(outcome_id, item_type, filename)
);

CREATE INDEX IF NOT EXISTS idx_outcome_items_outcome ON outcome_items(outcome_id);
CREATE INDEX IF NOT EXISTS idx_outcome_items_type ON outcome_items(item_type);
CREATE INDEX IF NOT EXISTS idx_outcome_items_synced ON outcome_items(synced_to);

-- Item-Repository Sync: Junction table for multi-destination syncing
-- An item can be synced to multiple repositories independently
CREATE TABLE IF NOT EXISTS item_repo_syncs (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES outcome_items(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  synced_at INTEGER NOT NULL,
  commit_hash TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced',  -- 'synced' | 'failed' | 'stale'
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(item_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_item_repo_syncs_item ON item_repo_syncs(item_id);
CREATE INDEX IF NOT EXISTS idx_item_repo_syncs_repo ON item_repo_syncs(repo_id);
CREATE INDEX IF NOT EXISTS idx_item_repo_syncs_status ON item_repo_syncs(sync_status);

-- Cost tracking
CREATE TABLE IF NOT EXISTS cost_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id TEXT,
  worker_id TEXT,
  task_id TEXT,
  amount REAL NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL
);

-- Bottleneck tracking for self-improvement
CREATE TABLE IF NOT EXISTS bottleneck_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id TEXT,
  intervention_type TEXT NOT NULL,
  description TEXT NOT NULL,
  resolution TEXT,
  created_at INTEGER NOT NULL
);

-- Improvement suggestions
CREATE TABLE IF NOT EXISTS improvement_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

-- Progress entries (for compaction)
CREATE TABLE IF NOT EXISTS progress_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  content TEXT NOT NULL,
  compacted INTEGER NOT NULL DEFAULT 0,
  compacted_into INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- Activity log (for activity feed)
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id TEXT NOT NULL,
  outcome_name TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE
);

-- Interventions (user commands to workers)
CREATE TABLE IF NOT EXISTS interventions (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  worker_id TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE SET NULL
);

-- Supervisor alerts (automated monitoring alerts)
CREATE TABLE IF NOT EXISTS supervisor_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  auto_paused INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Outcomes
CREATE INDEX IF NOT EXISTS idx_outcomes_status ON outcomes(status);
CREATE INDEX IF NOT EXISTS idx_outcomes_last_activity ON outcomes(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_parent ON outcomes(parent_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_depth ON outcomes(depth);

-- Design Docs
CREATE INDEX IF NOT EXISTS idx_design_docs_outcome ON design_docs(outcome_id);

-- Collaborators
CREATE INDEX IF NOT EXISTS idx_collaborators_outcome ON collaborators(outcome_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_email ON collaborators(email);

-- Tasks (critical for atomic claiming performance)
CREATE INDEX IF NOT EXISTS idx_tasks_outcome ON tasks(outcome_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority, score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by);
CREATE INDEX IF NOT EXISTS idx_tasks_pending ON tasks(outcome_id, status, priority) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tasks_depends ON tasks(depends_on);
CREATE INDEX IF NOT EXISTS idx_tasks_decomposition_status ON tasks(decomposition_status);
CREATE INDEX IF NOT EXISTS idx_tasks_decomposed_from ON tasks(decomposed_from_task_id);

-- Workers
CREATE INDEX IF NOT EXISTS idx_workers_outcome ON workers(outcome_id);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON workers(last_heartbeat);

-- Review Cycles
CREATE INDEX IF NOT EXISTS idx_review_cycles_outcome ON review_cycles(outcome_id);
CREATE INDEX IF NOT EXISTS idx_review_cycles_convergence ON review_cycles(outcome_id, cycle_number DESC);

-- Skills
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

-- Logs
CREATE INDEX IF NOT EXISTS idx_cost_log_outcome ON cost_log(outcome_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_created ON cost_log(created_at);
CREATE INDEX IF NOT EXISTS idx_bottleneck_log_outcome ON bottleneck_log(outcome_id);

-- Progress
CREATE INDEX IF NOT EXISTS idx_progress_outcome_worker ON progress_entries(outcome_id, worker_id, iteration);
CREATE INDEX IF NOT EXISTS idx_progress_compacted ON progress_entries(compacted);

-- Activity log
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_outcome ON activity_log(outcome_id);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(type);

-- Interventions
CREATE INDEX IF NOT EXISTS idx_interventions_outcome ON interventions(outcome_id);
CREATE INDEX IF NOT EXISTS idx_interventions_worker ON interventions(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status);
CREATE INDEX IF NOT EXISTS idx_interventions_pending ON interventions(worker_id, status, priority DESC) WHERE status = 'pending';

-- Supervisor alerts
CREATE INDEX IF NOT EXISTS idx_supervisor_alerts_status ON supervisor_alerts(status);
CREATE INDEX IF NOT EXISTS idx_supervisor_alerts_worker ON supervisor_alerts(worker_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_alerts_outcome ON supervisor_alerts(outcome_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_alerts_active ON supervisor_alerts(status, created_at DESC) WHERE status = 'active';

-- Merge queue
CREATE INDEX IF NOT EXISTS idx_merge_queue_outcome ON merge_queue(outcome_id);
CREATE INDEX IF NOT EXISTS idx_merge_queue_status ON merge_queue(status);
CREATE INDEX IF NOT EXISTS idx_merge_queue_pending ON merge_queue(outcome_id, status) WHERE status = 'pending';

-- ============================================================================
-- Supervisor Tables (AI Safety & Observability)
-- ============================================================================

-- Change snapshots: Track all file changes for audit and rollback
CREATE TABLE IF NOT EXISTS change_snapshots (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  task_id TEXT,
  timestamp INTEGER NOT NULL,
  files_created TEXT,          -- JSON array
  files_modified TEXT,         -- JSON array
  files_deleted TEXT,          -- JSON array
  git_commits TEXT,            -- JSON array of commit hashes
  git_diff_summary TEXT,
  pre_snapshot TEXT,           -- JSON: path -> content before (for rollback)
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);

-- Behavior reviews: AI analysis of worker behavior
CREATE TABLE IF NOT EXISTS behavior_reviews (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  snapshot_id TEXT,
  timestamp INTEGER NOT NULL,
  alignment_score INTEGER,     -- 0-100
  concerns TEXT,               -- JSON array
  deception_indicators TEXT,   -- JSON array
  recommendation TEXT,         -- 'continue' | 'review' | 'pause'
  reasoning TEXT,
  action_taken TEXT,
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id),
  FOREIGN KEY (snapshot_id) REFERENCES change_snapshots(id)
);

-- Pattern detections: Rule-based suspicious behavior detection
CREATE TABLE IF NOT EXISTS pattern_detections (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  pattern_id TEXT NOT NULL,
  pattern_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  severity TEXT NOT NULL,      -- 'low' | 'medium' | 'high' | 'critical'
  details TEXT,
  files_involved TEXT,         -- JSON array
  action_taken TEXT,
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);

-- Guard blocks: Track blocked destructive commands
CREATE TABLE IF NOT EXISTS guard_blocks (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  command TEXT NOT NULL,           -- The command that was blocked
  pattern_matched TEXT NOT NULL,   -- Which pattern triggered the block
  blocked_at INTEGER NOT NULL,     -- Timestamp when blocked
  context TEXT,                    -- JSON context (working dir, env, etc.)
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);

-- Indexes for supervisor tables
CREATE INDEX IF NOT EXISTS idx_change_snapshots_worker ON change_snapshots(worker_id);
CREATE INDEX IF NOT EXISTS idx_change_snapshots_outcome ON change_snapshots(outcome_id);
CREATE INDEX IF NOT EXISTS idx_change_snapshots_time ON change_snapshots(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_behavior_reviews_worker ON behavior_reviews(worker_id);
CREATE INDEX IF NOT EXISTS idx_behavior_reviews_outcome ON behavior_reviews(outcome_id);
CREATE INDEX IF NOT EXISTS idx_behavior_reviews_time ON behavior_reviews(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_reviews_recommendation ON behavior_reviews(recommendation);

CREATE INDEX IF NOT EXISTS idx_pattern_detections_worker ON pattern_detections(worker_id);
CREATE INDEX IF NOT EXISTS idx_pattern_detections_outcome ON pattern_detections(outcome_id);
CREATE INDEX IF NOT EXISTS idx_pattern_detections_severity ON pattern_detections(severity);
CREATE INDEX IF NOT EXISTS idx_pattern_detections_time ON pattern_detections(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_guard_blocks_worker ON guard_blocks(worker_id);
CREATE INDEX IF NOT EXISTS idx_guard_blocks_outcome ON guard_blocks(outcome_id);
CREATE INDEX IF NOT EXISTS idx_guard_blocks_time ON guard_blocks(blocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_guard_blocks_pattern ON guard_blocks(pattern_matched);

-- ============================================================================
-- HOMЯ Protocol Tables
-- ============================================================================

-- HOMЯ Context Store: Per-outcome cross-task memory
CREATE TABLE IF NOT EXISTS homr_context (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  discoveries TEXT NOT NULL DEFAULT '[]',
  decisions TEXT NOT NULL DEFAULT '[]',
  constraints TEXT NOT NULL DEFAULT '[]',
  injections TEXT NOT NULL DEFAULT '[]',
  tasks_observed INTEGER NOT NULL DEFAULT 0,
  discoveries_extracted INTEGER NOT NULL DEFAULT 0,
  escalations_created INTEGER NOT NULL DEFAULT 0,
  steering_actions INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_homr_context_outcome ON homr_context(outcome_id);

-- HOMЯ Observations: Task observation records
CREATE TABLE IF NOT EXISTS homr_observations (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  on_track INTEGER NOT NULL,
  alignment_score INTEGER NOT NULL,
  quality TEXT NOT NULL,
  drift TEXT NOT NULL DEFAULT '[]',
  discoveries TEXT NOT NULL DEFAULT '[]',
  issues TEXT NOT NULL DEFAULT '[]',
  has_ambiguity INTEGER NOT NULL DEFAULT 0,
  ambiguity_data TEXT,
  summary TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_homr_observations_outcome ON homr_observations(outcome_id);
CREATE INDEX IF NOT EXISTS idx_homr_observations_task ON homr_observations(task_id);

-- HOMЯ Escalations: Human escalation questions
CREATE TABLE IF NOT EXISTS homr_escalations (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  trigger_type TEXT NOT NULL,
  trigger_task_id TEXT NOT NULL,
  trigger_evidence TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_context TEXT NOT NULL,
  question_options TEXT NOT NULL,
  affected_tasks TEXT NOT NULL DEFAULT '[]',
  answer_option TEXT,
  answer_context TEXT,
  answered_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_homr_escalations_outcome ON homr_escalations(outcome_id);
CREATE INDEX IF NOT EXISTS idx_homr_escalations_status ON homr_escalations(status);

-- HOMЯ Activity Log: Activity tracking
CREATE TABLE IF NOT EXISTS homr_activity_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  type TEXT NOT NULL,
  details TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_homr_activity_outcome ON homr_activity_log(outcome_id);
CREATE INDEX IF NOT EXISTS idx_homr_activity_type ON homr_activity_log(type);

-- ============================================================================
-- Analysis Jobs Tables
-- ============================================================================

-- Analysis Jobs: Track background analysis jobs
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  outcome_id TEXT REFERENCES outcomes(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  result TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_outcome ON analysis_jobs(outcome_id);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created ON analysis_jobs(created_at DESC);
`;

// ============================================================================
// Legacy Type Aliases (for backwards compatibility during transition)
// ============================================================================

// Old Project type - maps to Outcome
export type ProjectStatus = 'pending' | 'briefing' | 'active' | 'paused' | 'completed';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  brief: string | null;
  prd: string | null;
  created_at: number;
  updated_at: number;
}

// Old PRD types
export interface PRDFeature {
  id: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  acceptance_criteria: string[];
  passes: boolean;
  notes: string;
  blocked_by?: string[];
}

export interface PRD {
  project: string;
  version: string;
  features: PRDFeature[];
  metadata?: {
    total_features: number;
    completed_features: number;
  };
}

export interface WorkerProgress {
  completed: number;
  total: number;
}

// Old Worker type with legacy fields
export interface LegacyWorker {
  id: string;
  project_id: string;
  name: string;
  status: WorkerStatus;
  prd_slice: string | null;
  progress: string | null;
  cost: number;
  started_at: number | null;
  updated_at: number;
}

// ============================================================================
// Migration SQL (from old schema)
// ============================================================================

export const MIGRATION_SQL = `
-- Migration: Convert old projects to outcomes
-- Run this if you have existing data

-- Check if old projects table exists
SELECT name FROM sqlite_master WHERE type='table' AND name='projects';

-- If projects table exists, migrate data:
-- INSERT INTO outcomes (id, name, status, brief, intent, created_at, updated_at, last_activity_at)
-- SELECT
--   id,
--   name,
--   CASE status
--     WHEN 'completed' THEN 'achieved'
--     WHEN 'paused' THEN 'dormant'
--     ELSE 'active'
--   END,
--   brief,
--   prd,
--   created_at,
--   updated_at,
--   updated_at
-- FROM projects;

-- Then drop old tables:
-- DROP TABLE IF EXISTS projects;
`;

// ============================================================================
// Git Config Migration
// ============================================================================

export const GIT_CONFIG_MIGRATION_SQL = `
-- Add git configuration columns to outcomes table
-- These are idempotent - safe to run multiple times

-- Check if columns exist before adding (SQLite workaround)
-- We wrap each in a try-catch by using PRAGMA to check column existence

ALTER TABLE outcomes ADD COLUMN working_directory TEXT;
ALTER TABLE outcomes ADD COLUMN git_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE outcomes ADD COLUMN base_branch TEXT;
ALTER TABLE outcomes ADD COLUMN work_branch TEXT;
ALTER TABLE outcomes ADD COLUMN auto_commit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outcomes ADD COLUMN create_pr_on_complete INTEGER NOT NULL DEFAULT 0;
`;

export const REPO_CONFIG_MIGRATION_SQL = `
-- Add repository configuration columns to outcomes table
ALTER TABLE outcomes ADD COLUMN repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL;
ALTER TABLE outcomes ADD COLUMN output_target TEXT NOT NULL DEFAULT 'local';
ALTER TABLE outcomes ADD COLUMN skill_target TEXT NOT NULL DEFAULT 'local';
ALTER TABLE outcomes ADD COLUMN tool_target TEXT NOT NULL DEFAULT 'local';
ALTER TABLE outcomes ADD COLUMN file_target TEXT NOT NULL DEFAULT 'local';
ALTER TABLE outcomes ADD COLUMN auto_save TEXT NOT NULL DEFAULT '0';
`;

export const REPO_INHERITANCE_MIGRATION_SQL = `
-- Migration for repository inheritance model
-- Updates existing data to new schema

-- Update target values from 'private'/'team' to 'repo'
UPDATE outcomes SET output_target = 'repo' WHERE output_target IN ('private', 'team');
UPDATE outcomes SET skill_target = 'repo' WHERE skill_target IN ('private', 'team');
UPDATE outcomes SET tool_target = 'repo' WHERE tool_target IN ('private', 'team');
UPDATE outcomes SET file_target = 'repo' WHERE file_target IN ('private', 'team');

-- Update outcome_items target_override values
UPDATE outcome_items SET target_override = 'repo' WHERE target_override IN ('private', 'team');
`;

export const TASK_DEPENDENCIES_MIGRATION_SQL = `
-- Migration: Add depends_on column to tasks table for task dependency graph
-- This column stores a JSON array of task IDs that must complete before this task can be claimed

ALTER TABLE tasks ADD COLUMN depends_on TEXT DEFAULT '[]';

-- Update any existing tasks to have empty dependency array
UPDATE tasks SET depends_on = '[]' WHERE depends_on IS NULL;
`;

export const TASK_COMPLEXITY_MIGRATION_SQL = `
-- Migration: Add complexity_score and estimated_turns columns to tasks table
-- These columns support the worker resilience feedback loop by tracking AI-estimated task complexity

ALTER TABLE tasks ADD COLUMN complexity_score INTEGER;
ALTER TABLE tasks ADD COLUMN estimated_turns INTEGER;
`;

export const REQUIRED_CAPABILITIES_MIGRATION_SQL = `
-- Migration: Add required_capabilities column to tasks table
-- This column stores a JSON array of capability identifiers like 'skill:name' or 'tool:name'
-- that must be available before this task can be executed

ALTER TABLE tasks ADD COLUMN required_capabilities TEXT DEFAULT '[]';

-- Update any existing tasks to have empty capabilities array
UPDATE tasks SET required_capabilities = '[]' WHERE required_capabilities IS NULL;
`;

export const DECOMPOSITION_TRACKING_MIGRATION_SQL = `
-- Migration: Add decomposition tracking columns to tasks table
-- These columns enable tracking of decomposition state to prevent race conditions
-- and link subtasks to their parent task for idempotency checks

ALTER TABLE tasks ADD COLUMN decomposition_status TEXT;
ALTER TABLE tasks ADD COLUMN decomposed_from_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_tasks_decomposition_status ON tasks(decomposition_status);
CREATE INDEX IF NOT EXISTS idx_tasks_decomposed_from ON tasks(decomposed_from_task_id);
`;
