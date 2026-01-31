/**
 * Supervisor Service
 *
 * AI safety and observability layer for worker monitoring.
 * - Real-time file watching
 * - Pattern detection for suspicious behavior
 * - Change tracking for audit and rollback
 * - Chain of thought review
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '@/lib/db';
import { getOutcomeById } from '@/lib/db/outcomes';
import { stopRalphWorker } from '@/lib/ralph/worker';
import { createSupervisorAlert } from '@/lib/db/supervisor-alerts';
import { getWorkspacePath } from '@/lib/workspace/detector';
import type {
  ChangeSnapshot,
  PatternDetection,
  PatternSeverity,
  SupervisorAction,
  PauseSensitivity,
} from '@/lib/db/schema';

// ============================================================================
// Types
// ============================================================================

interface FileChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  timestamp: number;
}

interface SupervisorInstance {
  outcomeId: string;
  workerId: string;
  watcher: fs.FSWatcher | null;
  changes: FileChange[];
  preSnapshot: Map<string, string>;
  isActive: boolean;
  startedAt: number;
}

interface SuspiciousPattern {
  id: string;
  name: string;
  severity: PatternSeverity;
  check: (changes: FileChange[], workspacePath: string) => { matched: boolean; details: string; files: string[] };
  action: SupervisorAction;
}

// ============================================================================
// Pattern Definitions
// ============================================================================

const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    id: 'test_modification',
    name: 'Test file modified',
    severity: 'medium',
    check: (changes) => {
      const testFiles = changes.filter(c =>
        c.path.includes('.test.') ||
        c.path.includes('.spec.') ||
        c.path.includes('__tests__') ||
        c.path.includes('/test/') ||
        c.path.includes('/tests/')
      );
      return {
        matched: testFiles.length > 0,
        details: `Test files modified: ${testFiles.map(f => path.basename(f.path)).join(', ')}`,
        files: testFiles.map(f => f.path),
      };
    },
    action: 'alert',
  },
  {
    id: 'env_access',
    name: 'Environment file accessed',
    severity: 'high',
    check: (changes) => {
      const envFiles = changes.filter(c =>
        c.path.includes('.env') ||
        c.path.includes('credentials') ||
        c.path.includes('secrets')
      );
      return {
        matched: envFiles.length > 0,
        details: `Sensitive files touched: ${envFiles.map(f => path.basename(f.path)).join(', ')}`,
        files: envFiles.map(f => f.path),
      };
    },
    action: 'pause',
  },
  {
    id: 'mass_deletion',
    name: 'Multiple files deleted',
    severity: 'critical',
    check: (changes) => {
      const deleted = changes.filter(c => c.type === 'delete');
      return {
        matched: deleted.length > 5,
        details: `${deleted.length} files deleted`,
        files: deleted.map(f => f.path),
      };
    },
    action: 'pause',
  },
  {
    id: 'scope_creep',
    name: 'Files changed outside workspace',
    severity: 'high',
    check: (changes, workspacePath) => {
      const outsideFiles = changes.filter(c =>
        !c.path.startsWith(workspacePath) &&
        !c.path.startsWith(process.cwd())
      );
      return {
        matched: outsideFiles.length > 0,
        details: `Files modified outside workspace: ${outsideFiles.map(f => f.path).join(', ')}`,
        files: outsideFiles.map(f => f.path),
      };
    },
    action: 'pause',
  },
  {
    id: 'system_file_access',
    name: 'System file modification',
    severity: 'critical',
    check: (changes) => {
      const systemFiles = changes.filter(c =>
        c.path.startsWith('/etc/') ||
        c.path.startsWith('/usr/') ||
        c.path.startsWith('/var/') ||
        c.path.includes('sudoers') ||
        c.path.includes('.bashrc') ||
        c.path.includes('.zshrc') ||
        c.path.includes('.profile')
      );
      return {
        matched: systemFiles.length > 0,
        details: `System files targeted: ${systemFiles.map(f => f.path).join(', ')}`,
        files: systemFiles.map(f => f.path),
      };
    },
    action: 'pause',
  },
  {
    id: 'package_json_scripts',
    name: 'Package scripts modified',
    severity: 'medium',
    check: (changes) => {
      const packageFiles = changes.filter(c =>
        c.path.endsWith('package.json') && c.type === 'modify'
      );
      return {
        matched: packageFiles.length > 0,
        details: 'package.json modified - check for script changes',
        files: packageFiles.map(f => f.path),
      };
    },
    action: 'alert',
  },
  {
    id: 'gitignore_modification',
    name: 'Gitignore modified',
    severity: 'low',
    check: (changes) => {
      const gitignoreFiles = changes.filter(c =>
        c.path.endsWith('.gitignore')
      );
      return {
        matched: gitignoreFiles.length > 0,
        details: '.gitignore modified - check what is being hidden',
        files: gitignoreFiles.map(f => f.path),
      };
    },
    action: 'log',
  },
];

// ============================================================================
// Active Supervisors Registry
// ============================================================================

const activeSupervisors = new Map<string, SupervisorInstance>();

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Start supervisor for a worker BEFORE the worker starts
 */
export async function startSupervisor(
  outcomeId: string,
  workerId: string
): Promise<{ success: boolean; error?: string }> {
  const key = `${outcomeId}:${workerId}`;

  // Check if already running
  if (activeSupervisors.has(key)) {
    return { success: true };
  }

  // Get outcome to check settings
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { success: false, error: 'Outcome not found' };
  }

  // Check if supervisor is enabled for this outcome
  if (!outcome.supervisor_enabled) {
    console.log(`[Supervisor] Disabled for outcome ${outcomeId}, skipping`);
    return { success: true };
  }

  const workspacePath = getWorkspacePath(outcomeId);

  // Take pre-snapshot of the workspace
  const preSnapshot = await takeSnapshot(workspacePath);

  // Create supervisor instance
  const instance: SupervisorInstance = {
    outcomeId,
    workerId,
    watcher: null,
    changes: [],
    preSnapshot,
    isActive: true,
    startedAt: Date.now(),
  };

  // Start file watcher
  try {
    instance.watcher = fs.watch(
      workspacePath,
      { recursive: true },
      (eventType, filename) => {
        if (!instance.isActive || !filename) return;

        const fullPath = path.join(workspacePath, filename);
        const change: FileChange = {
          path: fullPath,
          type: eventType === 'rename'
            ? (fs.existsSync(fullPath) ? 'create' : 'delete')
            : 'modify',
          timestamp: Date.now(),
        };

        instance.changes.push(change);

        // Check patterns in real-time
        checkPatternsRealtime(instance, outcome.pause_sensitivity);
      }
    );

    activeSupervisors.set(key, instance);
    console.log(`[Supervisor] Started for worker ${workerId} on outcome ${outcomeId}`);

    return { success: true };
  } catch (error) {
    console.error(`[Supervisor] Failed to start watcher:`, error);
    return { success: false, error: 'Failed to start file watcher' };
  }
}

/**
 * Stop supervisor for a worker
 */
export function stopSupervisor(outcomeId: string, workerId: string): void {
  const key = `${outcomeId}:${workerId}`;
  const instance = activeSupervisors.get(key);

  if (instance) {
    instance.isActive = false;
    if (instance.watcher) {
      instance.watcher.close();
    }

    // Save final change snapshot
    saveChangeSnapshot(instance);

    activeSupervisors.delete(key);
    console.log(`[Supervisor] Stopped for worker ${workerId}`);
  }
}

/**
 * Take a snapshot of files in a directory
 */
async function takeSnapshot(dirPath: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  if (!fs.existsSync(dirPath)) {
    return snapshot;
  }

  try {
    const files = getAllFiles(dirPath);
    for (const file of files) {
      try {
        // Skip binary files and large files
        const stats = fs.statSync(file);
        if (stats.size > 100000) continue; // Skip files > 100KB

        const content = fs.readFileSync(file, 'utf-8');
        snapshot.set(file, content);
      } catch {
        // Skip files that can't be read
      }
    }
  } catch (error) {
    console.error(`[Supervisor] Error taking snapshot:`, error);
  }

  return snapshot;
}

/**
 * Get all files in a directory recursively
 */
function getAllFiles(dirPath: string, files: string[] = []): string[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip node_modules, .git, etc.
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') {
        continue;
      }

      if (entry.isDirectory()) {
        getAllFiles(fullPath, files);
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory might not exist or be accessible
  }

  return files;
}

/**
 * Check patterns in real-time as changes come in
 */
function checkPatternsRealtime(
  instance: SupervisorInstance,
  sensitivity: PauseSensitivity
): void {
  const workspacePath = getWorkspacePath(instance.outcomeId);

  // Get changes from last 5 seconds for pattern checking
  const recentChanges = instance.changes.filter(
    c => c.timestamp > Date.now() - 5000
  );

  for (const pattern of SUSPICIOUS_PATTERNS) {
    // Skip patterns based on sensitivity
    if (!shouldCheckPattern(pattern.severity, sensitivity)) {
      continue;
    }

    const result = pattern.check(recentChanges, workspacePath);

    if (result.matched) {
      handlePatternMatch(instance, pattern, result);
    }
  }
}

/**
 * Determine if pattern should be checked based on sensitivity
 */
function shouldCheckPattern(
  patternSeverity: PatternSeverity,
  sensitivity: PauseSensitivity
): boolean {
  const severityOrder: PatternSeverity[] = ['low', 'medium', 'high', 'critical'];
  const patternIndex = severityOrder.indexOf(patternSeverity);

  switch (sensitivity) {
    case 'low':
      return patternIndex >= 3; // Only critical
    case 'medium':
      return patternIndex >= 2; // High and critical
    case 'high':
      return true; // All patterns
    default:
      return patternIndex >= 2;
  }
}

/**
 * Handle a pattern match - log, alert, or pause
 */
function handlePatternMatch(
  instance: SupervisorInstance,
  pattern: SuspiciousPattern,
  result: { matched: boolean; details: string; files: string[] }
): void {
  console.log(`[Supervisor] Pattern detected: ${pattern.name} (${pattern.severity})`);

  // Record the detection
  recordPatternDetection(instance, pattern, result);

  // Take action
  switch (pattern.action) {
    case 'log':
      // Just logged above
      break;

    case 'alert':
      createSupervisorAlert({
        worker_id: instance.workerId,
        outcome_id: instance.outcomeId,
        type: 'suspicious_behavior',
        severity: pattern.severity === 'critical' ? 'critical' : pattern.severity === 'high' ? 'high' : 'medium',
        message: `${pattern.name}: ${result.details}`,
      });
      break;

    case 'pause':
      // Create alert
      createSupervisorAlert({
        worker_id: instance.workerId,
        outcome_id: instance.outcomeId,
        type: 'worker_paused',
        severity: 'critical',
        message: `Worker paused: ${pattern.name} - ${result.details}`,
        auto_paused: true,
      });

      // Actually pause the worker
      stopRalphWorker(instance.workerId);
      console.log(`[Supervisor] Worker ${instance.workerId} paused due to ${pattern.name}`);
      break;
  }
}

/**
 * Record a pattern detection in the database
 */
function recordPatternDetection(
  instance: SupervisorInstance,
  pattern: SuspiciousPattern,
  result: { matched: boolean; details: string; files: string[] }
): void {
  const db = getDb();
  const id = `pd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  db.prepare(`
    INSERT INTO pattern_detections
    (id, worker_id, outcome_id, pattern_id, pattern_name, timestamp, severity, details, files_involved, action_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    instance.workerId,
    instance.outcomeId,
    pattern.id,
    pattern.name,
    Date.now(),
    pattern.severity,
    result.details,
    JSON.stringify(result.files),
    pattern.action
  );
}

/**
 * Save a change snapshot to the database
 */
function saveChangeSnapshot(instance: SupervisorInstance): void {
  if (instance.changes.length === 0) return;

  const db = getDb();
  const id = `cs_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  const filesCreated = instance.changes.filter(c => c.type === 'create').map(c => c.path);
  const filesModified = instance.changes.filter(c => c.type === 'modify').map(c => c.path);
  const filesDeleted = instance.changes.filter(c => c.type === 'delete').map(c => c.path);

  // Convert pre-snapshot to object for storage
  const preSnapshotObj: Record<string, string> = {};
  instance.preSnapshot.forEach((content, path) => {
    // Only store files that were modified or deleted
    if (filesModified.includes(path) || filesDeleted.includes(path)) {
      preSnapshotObj[path] = content;
    }
  });

  db.prepare(`
    INSERT INTO change_snapshots
    (id, worker_id, outcome_id, timestamp, files_created, files_modified, files_deleted, pre_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    instance.workerId,
    instance.outcomeId,
    Date.now(),
    JSON.stringify(filesCreated),
    JSON.stringify(filesModified),
    JSON.stringify(filesDeleted),
    JSON.stringify(preSnapshotObj)
  );

  console.log(`[Supervisor] Saved change snapshot: ${filesCreated.length} created, ${filesModified.length} modified, ${filesDeleted.length} deleted`);
}

/**
 * Get recent pattern detections for an outcome
 */
export function getPatternDetections(outcomeId: string, limit = 20): PatternDetection[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM pattern_detections
    WHERE outcome_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(outcomeId, limit) as (PatternDetection & { files_involved: string })[];

  return rows.map(row => ({
    ...row,
    files_involved: JSON.parse(row.files_involved || '[]'),
  }));
}

/**
 * Get change snapshots for an outcome
 */
export function getChangeSnapshots(outcomeId: string, limit = 10): ChangeSnapshot[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM change_snapshots
    WHERE outcome_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(outcomeId, limit) as (ChangeSnapshot & {
    files_created: string;
    files_modified: string;
    files_deleted: string;
    git_commits: string;
    pre_snapshot: string;
  })[];

  return rows.map(row => ({
    ...row,
    files_created: JSON.parse(row.files_created || '[]'),
    files_modified: JSON.parse(row.files_modified || '[]'),
    files_deleted: JSON.parse(row.files_deleted || '[]'),
    git_commits: JSON.parse(row.git_commits || '[]'),
    pre_snapshot: row.pre_snapshot,
  }));
}

/**
 * Rollback files from a snapshot
 */
export async function rollbackFromSnapshot(
  snapshotId: string
): Promise<{ success: boolean; filesRestored: number; error?: string }> {
  const db = getDb();
  const snapshot = db.prepare(`SELECT * FROM change_snapshots WHERE id = ?`).get(snapshotId) as {
    pre_snapshot: string;
  } | undefined;

  if (!snapshot || !snapshot.pre_snapshot) {
    return { success: false, filesRestored: 0, error: 'Snapshot not found or no pre-snapshot data' };
  }

  try {
    const preSnapshotObj = JSON.parse(snapshot.pre_snapshot) as Record<string, string>;
    let filesRestored = 0;

    for (const [filePath, content] of Object.entries(preSnapshotObj)) {
      try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        filesRestored++;
      } catch (err) {
        console.error(`[Supervisor] Failed to restore ${filePath}:`, err);
      }
    }

    return { success: true, filesRestored };
  } catch (error) {
    return { success: false, filesRestored: 0, error: 'Failed to parse snapshot data' };
  }
}

/**
 * Check if supervisor is running for a worker
 */
export function isSupervisorActive(outcomeId: string, workerId: string): boolean {
  const key = `${outcomeId}:${workerId}`;
  return activeSupervisors.has(key);
}

/**
 * Get supervisor status for an outcome
 */
export function getSupervisorStatus(outcomeId: string): {
  activeWorkers: string[];
  totalDetections: number;
  recentDetections: PatternDetection[];
} {
  const activeWorkers: string[] = [];

  activeSupervisors.forEach((instance, key) => {
    if (key.startsWith(`${outcomeId}:`)) {
      activeWorkers.push(instance.workerId);
    }
  });

  const recentDetections = getPatternDetections(outcomeId, 5);

  const db = getDb();
  const countResult = db.prepare(`
    SELECT COUNT(*) as count FROM pattern_detections WHERE outcome_id = ?
  `).get(outcomeId) as { count: number };

  return {
    activeWorkers,
    totalDetections: countResult?.count || 0,
    recentDetections,
  };
}
