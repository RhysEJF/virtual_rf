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
export type SupervisorAlertType = 'stuck' | 'no_progress' | 'repeated_errors' | 'high_cost';
export type SupervisorAlertSeverity = 'warning' | 'critical';
export type SupervisorAlertStatus = 'active' | 'acknowledged' | 'resolved';

// ============================================================================
// Core Entities
// ============================================================================

export interface Outcome {
  id: string;
  name: string;
  status: OutcomeStatus;
  is_ongoing: boolean;              // true = never "achieves", has milestones instead
  brief: string | null;             // Original user input/ramble
  intent: string | null;            // PRD - the WHAT (JSON)
  timeline: string | null;          // Target date or "ongoing"
  created_at: number;
  updated_at: number;
  last_activity_at: number;         // For recency-based sorting
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
  usage_count: number;
  avg_cost: number | null;
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
  content: string;                  // Raw progress text
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
  | 'intent_updated';

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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
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
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  FOREIGN KEY (claimed_by) REFERENCES workers(id) ON DELETE SET NULL
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
  usage_count INTEGER DEFAULT 0,
  avg_cost REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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
