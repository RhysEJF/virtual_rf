import { execSync } from 'child_process';
import { recordExperiment, getExperiments } from '../db/experiments';
import { updateTask } from '../db/tasks';
import { getEventBus } from '../events/bus';

interface EvolveTask {
  id: string;
  outcome_id: string;
  title: string;
  description: string;
  metric_command: string;
  metric_baseline: number | null;
  optimization_budget: number;
}

interface EvolveResult {
  iterations: number;
  bestValue: number | null;
  baselineValue: number | null;
  improvement: number;
  stopped: 'budget_exhausted' | 'plateau_detected' | 'error';
}

function runMetricCommand(command: string, cwd: string): number | null {
  try {
    const output = execSync(command, {
      cwd,
      timeout: 120000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
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

function initGitIfNeeded(workspacePath: string): void {
  try {
    execSync('git rev-parse --git-dir', { cwd: workspacePath, stdio: 'pipe' });
  } catch {
    // Not a git repo — initialize
    execSync('git init', { cwd: workspacePath, stdio: 'pipe' });
    execSync('git add -A', { cwd: workspacePath, stdio: 'pipe' });
    execSync('git commit -m "Initial state before evolve mode" --allow-empty', {
      cwd: workspacePath,
      stdio: 'pipe',
    });
  }
}

function getCurrentSha(workspacePath: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function revertLastCommit(workspacePath: string): void {
  try {
    execSync('git revert HEAD --no-edit', { cwd: workspacePath, stdio: 'pipe' });
  } catch {
    // If revert fails, hard reset
    try {
      execSync('git reset --hard HEAD~1', { cwd: workspacePath, stdio: 'pipe' });
    } catch {
      // Give up on revert
    }
  }
}

export async function runEvolveLoop(
  task: EvolveTask,
  workspacePath: string,
  executeIteration: (task: EvolveTask, iteration: number, previousExperiments: string, workspacePath: string) => Promise<string | null>
): Promise<EvolveResult> {
  const bus = getEventBus();
  const budget = task.optimization_budget || 5;
  const PLATEAU_THRESHOLD = 3; // Stop after N consecutive non-improvements

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
  let iteration = 0;
  let stopReason: EvolveResult['stopped'] = 'budget_exhausted';

  // Get any existing experiments for context
  const existingExperiments = getExperiments({ taskId: task.id });

  for (iteration = existingExperiments.length + 1; iteration <= budget; iteration++) {
    const startTime = Date.now();

    // Build context from previous experiments
    const prevContext = getExperiments({ taskId: task.id })
      .map(e => `Iteration ${e.iteration}: value=${e.metric_value}, kept=${e.kept === 1}, change: ${e.change_summary || 'unknown'}`)
      .join('\n');

    // Execute one iteration (spawns Claude CLI)
    let changeSummary: string | null = null;
    try {
      changeSummary = await executeIteration(task, iteration, prevContext, workspacePath);
    } catch (error) {
      stopReason = 'error';
      break;
    }

    if (!changeSummary) {
      // Worker didn't produce changes
      consecutiveNonImprovements++;
      if (consecutiveNonImprovements >= PLATEAU_THRESHOLD) {
        stopReason = 'plateau_detected';
        break;
      }
      continue;
    }

    // Commit changes
    try {
      execSync('git add -A', { cwd: workspacePath, stdio: 'pipe' });
      execSync(`git commit -m "Evolve iteration ${iteration}: ${(changeSummary || '').slice(0, 72)}" --allow-empty`, {
        cwd: workspacePath,
        stdio: 'pipe',
      });
    } catch {
      // Nothing to commit
    }

    // Measure new metric
    const newValue = runMetricCommand(task.metric_command, workspacePath);
    const sha = getCurrentSha(workspacePath);
    const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

    const improved = newValue !== null && bestValue !== null && newValue < bestValue;
    // Note: lower is better (like file size, line count, latency, etc.)
    // If higher-is-better semantics needed, this should be configurable

    if (improved || (newValue !== null && bestValue === null)) {
      // Keep the change
      recordExperiment({
        taskId: task.id,
        outcomeId: task.outcome_id,
        iteration,
        metricValue: newValue ?? undefined,
        metricCommand: task.metric_command,
        baselineValue: baseline ?? undefined,
        changeSummary: changeSummary || undefined,
        gitSha: sha || undefined,
        kept: true,
        durationSeconds,
      });

      bestValue = newValue;
      consecutiveNonImprovements = 0;

      bus.emit({
        type: 'experiment.completed',
        outcomeId: task.outcome_id,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        data: { iteration, metricValue: newValue, kept: true, changeSummary },
      });
    } else {
      // Revert the change
      revertLastCommit(workspacePath);

      recordExperiment({
        taskId: task.id,
        outcomeId: task.outcome_id,
        iteration,
        metricValue: newValue ?? undefined,
        metricCommand: task.metric_command,
        baselineValue: baseline ?? undefined,
        changeSummary: changeSummary || undefined,
        gitSha: sha || undefined,
        kept: false,
        durationSeconds,
      });

      consecutiveNonImprovements++;

      bus.emit({
        type: 'experiment.completed',
        outcomeId: task.outcome_id,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        data: { iteration, metricValue: newValue, kept: false, changeSummary },
      });

      if (consecutiveNonImprovements >= PLATEAU_THRESHOLD) {
        stopReason = 'plateau_detected';
        break;
      }
    }
  }

  return {
    iterations: iteration - 1,
    bestValue,
    baselineValue: baseline,
    improvement: baseline !== null && bestValue !== null ? baseline - bestValue : 0,
    stopped: stopReason,
  };
}
