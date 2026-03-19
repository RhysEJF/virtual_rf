import { execSync } from 'child_process';
import { recordExperiment, getExperiments } from '../db/experiments';
import { updateTask } from '../db/tasks';
import { getEventBus } from '../events/bus';

export interface EvolveTask {
  id: string;
  outcome_id: string;
  title: string;
  description: string;
  metric_command: string;
  metric_baseline: number | null;
  optimization_budget: number;
  metric_direction: 'lower' | 'higher';
  plateau_threshold?: number;
  artifact_file?: string;
}

interface EvolveResult {
  iterations: number;
  bestValue: number | null;
  baselineValue: number | null;
  improvement: number;
  stopped: 'budget_exhausted' | 'plateau_detected' | 'crash_threshold' | 'error';
}

// ============================================================================
// Metric Measurement
// ============================================================================

function runMetricCommand(command: string, cwd: string): number | null {
  try {
    // Strip CLAUDECODE env var so metric commands can spawn Claude CLI
    // (nested Claude sessions refuse to start if CLAUDECODE is set)
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const output = execSync(command, {
      cwd,
      timeout: 120000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
    });

    // Extract first number from output
    const match = output.trim().match(/-?\d+(\.\d+)?/);
    if (match) {
      return parseFloat(match[0]);
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Git Helpers — Branch-Based Rollback (18c)
// ============================================================================

function initGitIfNeeded(workspacePath: string): void {
  try {
    execSync('git rev-parse --git-dir', { cwd: workspacePath, stdio: 'pipe' });
    // Repo exists — ensure we're on main
    ensureOnMain(workspacePath);
  } catch {
    // Not a git repo — initialize with main branch
    execSync('git init -b main', { cwd: workspacePath, stdio: 'pipe' });
    execSync('git add -A', { cwd: workspacePath, stdio: 'pipe' });
    execSync('git commit -m "Initial state before evolve mode" --allow-empty', {
      cwd: workspacePath,
      stdio: 'pipe',
    });
  }
}

function ensureOnMain(cwd: string): void {
  try {
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
    if (branch && branch !== 'main') {
      execSync('git checkout main', { cwd, stdio: 'pipe' });
    }
  } catch { /* already on main or detached — best effort */ }
}

function createProposalBranch(cwd: string, iteration: number): string {
  const name = `evolve/iteration-${iteration}`;
  execSync(`git checkout -b ${name}`, { cwd, stdio: 'pipe' });
  return name;
}

function mergeProposalToMain(cwd: string, branch: string, iteration: number, summary: string): void {
  execSync('git checkout main', { cwd, stdio: 'pipe' });
  const msg = `Evolve: kept iteration ${iteration}: ${summary.slice(0, 60)}`;
  execSync('git merge --no-ff -m "$EVOLVE_MSG" ' + branch, {
    cwd, stdio: 'pipe',
    env: { ...process.env, EVOLVE_MSG: msg },
  });
  execSync(`git branch -d ${branch}`, { cwd, stdio: 'pipe' });
}

function discardProposalBranch(cwd: string, branch: string): void {
  execSync('git checkout main', { cwd, stdio: 'pipe' });
  execSync(`git branch -D ${branch}`, { cwd, stdio: 'pipe' });
}

function getCurrentSha(workspacePath: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

// ============================================================================
// State Boundary Enforcement (18f)
// ============================================================================

function validateStateBoundary(cwd: string, artifactFile?: string): string[] {
  const protectedPrefixes = ['.evolve/', 'CLAUDE.md', '.gitignore'];
  let changedFiles: string[];
  try {
    const output = execSync('git diff --name-only main...HEAD', { cwd, encoding: 'utf-8' });
    changedFiles = output.trim().split('\n').filter(Boolean);
  } catch { return []; }

  const violations: string[] = [];
  for (const file of changedFiles) {
    if (protectedPrefixes.some(p => file === p || file.startsWith(p))) {
      violations.push(file);
    } else if (artifactFile && file !== artifactFile && !file.startsWith('state/')) {
      violations.push(file);
    }
  }
  return violations;
}

// ============================================================================
// Richer Experiment Context (18b)
// ============================================================================

function buildExperimentContext(taskId: string, direction: 'lower' | 'higher'): string {
  const experiments = getExperiments({ taskId });
  if (experiments.length === 0) return '';

  const kept = experiments.filter(e => e.kept === 1);
  const failed = experiments.filter(e => e.kept === 0);

  let context = '### Current Best State\n';
  if (kept.length === 0) {
    context += 'No improvements accepted yet. Baseline is the current state.\n';
  } else {
    const dirLabel = direction === 'higher' ? 'higher is better' : 'lower is better';
    context += `Changes that produced improvements (in order, ${dirLabel}):\n`;
    for (const e of kept) {
      context += `- Iteration ${e.iteration} (metric: ${e.metric_value}): ${e.change_summary || 'no description'}\n`;
    }
  }

  if (failed.length > 0) {
    context += '\n### Failed Approaches (DO NOT REPEAT)\n';
    context += 'These were tried and reverted:\n';
    for (const e of failed) {
      const label = e.metric_value === null ? 'CRASH' : `metric: ${e.metric_value}`;
      context += `- Iteration ${e.iteration} (${label}): ${e.change_summary || 'no description'}\n`;
    }
  }

  return context;
}

// ============================================================================
// Main Loop
// ============================================================================

export async function runEvolveLoop(
  task: EvolveTask,
  workspacePath: string,
  executeIteration: (task: EvolveTask, iteration: number, previousExperiments: string, workspacePath: string) => Promise<string | null>
): Promise<EvolveResult> {
  const bus = getEventBus();
  const budget = task.optimization_budget || 5;
  const PLATEAU_THRESHOLD = task.plateau_threshold ?? 3;
  const CRASH_THRESHOLD = 5;

  // Ensure workspace is a git repo for rollback capability
  initGitIfNeeded(workspacePath);

  // Get baseline metric
  let baseline = task.metric_baseline;
  if (baseline === null) {
    baseline = runMetricCommand(task.metric_command, workspacePath);
    if (baseline !== null) {
      updateTask(task.id, { metric_baseline: baseline });
    }
  }

  let bestValue = baseline;
  let consecutiveNonImprovements = 0;
  let consecutiveCrashes = 0;
  let iteration = 0;
  let stopReason: EvolveResult['stopped'] = 'budget_exhausted';

  // Get any existing experiments for context
  const existingExperiments = getExperiments({ taskId: task.id });

  try {
    for (iteration = existingExperiments.length + 1; iteration <= budget; iteration++) {
      const startTime = Date.now();

      // Build structured context from previous experiments (18b)
      const prevContext = buildExperimentContext(task.id, task.metric_direction);

      // Create proposal branch for this iteration (18c)
      ensureOnMain(workspacePath);
      const branchName = createProposalBranch(workspacePath, iteration);

      // Execute one iteration (spawns Claude CLI) — agent works on the branch
      let changeSummary: string | null = null;
      try {
        changeSummary = await executeIteration(task, iteration, prevContext, workspacePath);
      } catch {
        discardProposalBranch(workspacePath, branchName);
        stopReason = 'error';
        break;
      }

      if (!changeSummary) {
        // Worker didn't produce changes
        discardProposalBranch(workspacePath, branchName);
        consecutiveNonImprovements++;
        if (PLATEAU_THRESHOLD > 0 && consecutiveNonImprovements >= PLATEAU_THRESHOLD) {
          stopReason = 'plateau_detected';
          break;
        }
        continue;
      }

      // Commit changes on the proposal branch
      try {
        execSync('git add -A', { cwd: workspacePath, stdio: 'pipe' });
        const commitMsg = `Evolve iteration ${iteration}: ${(changeSummary || '').slice(0, 72).replace(/["`$\\]/g, '')}`;
        execSync('git commit -m "$EVOLVE_MSG" --allow-empty', {
          cwd: workspacePath,
          stdio: 'pipe',
          env: { ...process.env, EVOLVE_MSG: commitMsg },
        });
      } catch {
        // Nothing to commit
      }

      // Validate state boundary (18f) — reject if protected files were modified
      const violations = validateStateBoundary(workspacePath, task.artifact_file);
      if (violations.length > 0) {
        const sha = getCurrentSha(workspacePath);
        const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
        discardProposalBranch(workspacePath, branchName);
        const violationSummary = `AUTO-REJECTED: boundary violation — ${violations.join(', ')}`;
        recordExperiment({
          taskId: task.id,
          outcomeId: task.outcome_id,
          iteration,
          metricCommand: task.metric_command,
          baselineValue: baseline ?? undefined,
          changeSummary: violationSummary,
          gitSha: sha || undefined,
          kept: false,
          status: 'rejected',
          durationSeconds,
        });
        consecutiveNonImprovements++;
        bus.emit({
          type: 'experiment.completed',
          outcomeId: task.outcome_id,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: { iteration, metricValue: null, kept: false, changeSummary: violationSummary, status: 'rejected' },
        });
        if (PLATEAU_THRESHOLD > 0 && consecutiveNonImprovements >= PLATEAU_THRESHOLD) {
          stopReason = 'plateau_detected';
          break;
        }
        continue;
      }

      // Measure new metric (still on proposal branch — eval.sh exists here)
      const newValue = runMetricCommand(task.metric_command, workspacePath);
      const sha = getCurrentSha(workspacePath);
      const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

      if (newValue === null) {
        // Crash: metric command failed (18d)
        discardProposalBranch(workspacePath, branchName);
        consecutiveCrashes++;
        recordExperiment({
          taskId: task.id,
          outcomeId: task.outcome_id,
          iteration,
          metricCommand: task.metric_command,
          baselineValue: baseline ?? undefined,
          changeSummary: changeSummary || undefined,
          gitSha: sha || undefined,
          kept: false,
          status: 'crash',
          durationSeconds,
        });
        bus.emit({
          type: 'experiment.completed',
          outcomeId: task.outcome_id,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: { iteration, metricValue: null, kept: false, changeSummary, status: 'crash' },
        });
        if (consecutiveCrashes >= CRASH_THRESHOLD) {
          stopReason = 'crash_threshold';
          break;
        }
        // Crashes do NOT count toward plateau
        continue;
      }

      // Reset crash counter on successful measurement
      consecutiveCrashes = 0;

      const improved = bestValue !== null &&
        (task.metric_direction === 'higher' ? newValue > bestValue : newValue < bestValue);

      if (improved || bestValue === null) {
        // Keep: merge proposal branch into main (18c)
        mergeProposalToMain(workspacePath, branchName, iteration, changeSummary || 'improvement');
        recordExperiment({
          taskId: task.id,
          outcomeId: task.outcome_id,
          iteration,
          metricValue: newValue,
          metricCommand: task.metric_command,
          baselineValue: baseline ?? undefined,
          changeSummary: changeSummary || undefined,
          gitSha: sha || undefined,
          kept: true,
          status: 'accepted',
          durationSeconds,
        });
        bestValue = newValue;
        consecutiveNonImprovements = 0;
        bus.emit({
          type: 'experiment.completed',
          outcomeId: task.outcome_id,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: { iteration, metricValue: newValue, kept: true, changeSummary, status: 'accepted' },
        });
      } else {
        // Rejection: discard proposal branch (18c, 18d)
        discardProposalBranch(workspacePath, branchName);
        recordExperiment({
          taskId: task.id,
          outcomeId: task.outcome_id,
          iteration,
          metricValue: newValue,
          metricCommand: task.metric_command,
          baselineValue: baseline ?? undefined,
          changeSummary: changeSummary || undefined,
          gitSha: sha || undefined,
          kept: false,
          status: 'rejected',
          durationSeconds,
        });
        consecutiveNonImprovements++;
        bus.emit({
          type: 'experiment.completed',
          outcomeId: task.outcome_id,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: { iteration, metricValue: newValue, kept: false, changeSummary, status: 'rejected' },
        });
        if (PLATEAU_THRESHOLD > 0 && consecutiveNonImprovements >= PLATEAU_THRESHOLD) {
          stopReason = 'plateau_detected';
          break;
        }
      }
    }
  } finally {
    // Always return to main on exit (18c)
    ensureOnMain(workspacePath);
  }

  return {
    iterations: iteration - 1,
    bestValue,
    baselineValue: baseline,
    improvement: baseline !== null && bestValue !== null
      ? (task.metric_direction === 'higher' ? bestValue - baseline : baseline - bestValue)
      : 0,
    stopped: stopReason,
  };
}
