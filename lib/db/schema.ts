/**
 * Database schema types and SQL definitions
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type ProjectStatus = 'pending' | 'briefing' | 'active' | 'paused' | 'completed';
export type WorkerStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type InterventionType = 'clarification' | 'redirect' | 'skill_gap' | 'error';
export type SuggestionType = 'skill' | 'automation' | 'process';
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  brief: string | null;
  prd: string | null; // JSON string
  created_at: number;
  updated_at: number;
}

export interface Worker {
  id: string;
  project_id: string;
  name: string;
  status: WorkerStatus;
  prd_slice: string | null; // JSON string
  progress: string | null; // JSON string { completed: number, total: number }
  cost: number;
  started_at: number | null;
  updated_at: number;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string | null;
  path: string;
  usage_count: number;
  avg_cost: number | null;
  created_at: number;
  updated_at: number;
}

export interface CostLogEntry {
  id: number;
  project_id: string | null;
  worker_id: string | null;
  amount: number;
  description: string | null;
  created_at: number;
}

export interface BottleneckLogEntry {
  id: number;
  project_id: string | null;
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

// ============================================================================
// Parsed Types (with JSON fields parsed)
// ============================================================================

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

export interface ProjectWithParsed extends Omit<Project, 'prd'> {
  prd: PRD | null;
}

export interface WorkerWithParsed extends Omit<Worker, 'prd_slice' | 'progress'> {
  prd_slice: PRDFeature[] | null;
  progress: WorkerProgress | null;
}

// ============================================================================
// SQL Schema
// ============================================================================

export const SCHEMA_SQL = `
-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  brief TEXT,
  prd TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Workers table
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  prd_slice TEXT,
  progress TEXT,
  cost REAL DEFAULT 0,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Skills table
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  path TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0,
  avg_cost REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Cost log table
CREATE TABLE IF NOT EXISTS cost_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  worker_id TEXT,
  amount REAL NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL
);

-- Bottleneck log table
CREATE TABLE IF NOT EXISTS bottleneck_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  intervention_type TEXT NOT NULL,
  description TEXT NOT NULL,
  resolution TEXT,
  created_at INTEGER NOT NULL
);

-- Improvement suggestions table
CREATE TABLE IF NOT EXISTS improvement_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_workers_project_id ON workers(project_id);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_cost_log_project_id ON cost_log(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_created_at ON cost_log(created_at);
CREATE INDEX IF NOT EXISTS idx_bottleneck_log_project_id ON bottleneck_log(project_id);
CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_status ON improvement_suggestions(status);
`;
