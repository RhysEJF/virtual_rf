/**
 * Audit Check Runners
 *
 * Functions to run technical validation checks (typecheck, lint, tests)
 * on code projects and return structured results.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export type CheckType = 'typecheck' | 'lint' | 'test';

export interface CheckResult {
  type: CheckType;
  success: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
  command: string;
}

export interface RunCheckOptions {
  cwd: string;
  timeout?: number; // milliseconds, default 120000 (2 minutes)
}

// ============================================================================
// Project Detection
// ============================================================================

interface ProjectInfo {
  type: 'node' | 'python' | 'unknown';
  hasPackageJson: boolean;
  hasTypescript: boolean;
  scripts: Record<string, string>;
  hasPytest: boolean;
  hasPyprojectToml: boolean;
}

function detectProject(cwd: string): ProjectInfo {
  const info: ProjectInfo = {
    type: 'unknown',
    hasPackageJson: false,
    hasTypescript: false,
    scripts: {},
    hasPytest: false,
    hasPyprojectToml: false,
  };

  // Check for Node.js project
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    info.hasPackageJson = true;
    info.type = 'node';
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      info.scripts = packageJson.scripts || {};
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      info.hasTypescript = 'typescript' in deps || fs.existsSync(path.join(cwd, 'tsconfig.json'));
    } catch {
      // Failed to parse package.json
    }
  }

  // Check for Python project
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  const requirementsPath = path.join(cwd, 'requirements.txt');
  if (fs.existsSync(pyprojectPath)) {
    info.hasPyprojectToml = true;
    if (info.type === 'unknown') info.type = 'python';
  }
  if (fs.existsSync(requirementsPath)) {
    if (info.type === 'unknown') info.type = 'python';
    try {
      const requirements = fs.readFileSync(requirementsPath, 'utf-8');
      info.hasPytest = requirements.toLowerCase().includes('pytest');
    } catch {
      // Failed to read requirements
    }
  }

  // Check for pytest in pyproject.toml
  if (info.hasPyprojectToml) {
    try {
      const pyproject = fs.readFileSync(pyprojectPath, 'utf-8');
      info.hasPytest = pyproject.toLowerCase().includes('pytest');
    } catch {
      // Failed to read pyproject.toml
    }
  }

  return info;
}

// ============================================================================
// Command Execution
// ============================================================================

function runCommand(
  command: string,
  args: string[],
  options: RunCheckOptions
): Promise<{ success: boolean; output: string; exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const { cwd, timeout = 120000 } = options;
    const startTime = Date.now();

    const proc = spawn(command, args, {
      cwd,
      shell: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      const durationMs = Date.now() - startTime;
      resolve({
        success: false,
        output: `Command timed out after ${timeout / 1000}s\n\nPartial output:\n${stdout}\n\nStderr:\n${stderr}`,
        exitCode: -1,
        durationMs,
      });
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? -1;

      // Combine stdout and stderr for full output
      let output = stdout;
      if (stderr) {
        output += output ? '\n\n--- stderr ---\n' + stderr : stderr;
      }

      resolve({
        success: exitCode === 0,
        output: output.trim(),
        exitCode,
        durationMs,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;
      resolve({
        success: false,
        output: `Failed to execute command: ${err.message}`,
        exitCode: -1,
        durationMs,
      });
    });
  });
}

// ============================================================================
// Check Runners
// ============================================================================

/**
 * Run TypeScript type checking
 *
 * Tries in order:
 * 1. npm run typecheck (if script exists)
 * 2. npx tsc --noEmit (for TypeScript projects)
 */
export async function runTypecheck(options: RunCheckOptions): Promise<CheckResult> {
  const { cwd } = options;
  const project = detectProject(cwd);

  let command = '';
  let args: string[] = [];

  if (project.type === 'node') {
    if (project.scripts['typecheck']) {
      command = 'npm';
      args = ['run', 'typecheck'];
    } else if (project.scripts['type-check']) {
      command = 'npm';
      args = ['run', 'type-check'];
    } else if (project.hasTypescript) {
      command = 'npx';
      args = ['tsc', '--noEmit'];
    } else {
      return {
        type: 'typecheck',
        success: true,
        output: 'No TypeScript configuration found - skipping typecheck',
        exitCode: 0,
        durationMs: 0,
        command: 'N/A',
      };
    }
  } else if (project.type === 'python') {
    // Try mypy for Python type checking
    command = 'python';
    args = ['-m', 'mypy', '.'];
  } else {
    return {
      type: 'typecheck',
      success: false,
      output: 'Unable to determine project type for type checking',
      exitCode: -1,
      durationMs: 0,
      command: 'N/A',
    };
  }

  const fullCommand = `${command} ${args.join(' ')}`;
  const result = await runCommand(command, args, options);

  return {
    type: 'typecheck',
    success: result.success,
    output: result.output,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    command: fullCommand,
  };
}

/**
 * Run linting
 *
 * Tries in order:
 * 1. npm run lint (if script exists)
 * 2. npx eslint . (for Node.js projects)
 * 3. python -m flake8 or ruff (for Python projects)
 */
export async function runLint(options: RunCheckOptions): Promise<CheckResult> {
  const { cwd } = options;
  const project = detectProject(cwd);

  let command = '';
  let args: string[] = [];

  if (project.type === 'node') {
    if (project.scripts['lint']) {
      command = 'npm';
      args = ['run', 'lint'];
    } else {
      // Try eslint directly
      command = 'npx';
      args = ['eslint', '.'];
    }
  } else if (project.type === 'python') {
    // Try ruff first (faster), then flake8
    command = 'python';
    args = ['-m', 'ruff', 'check', '.'];
  } else {
    return {
      type: 'lint',
      success: false,
      output: 'Unable to determine project type for linting',
      exitCode: -1,
      durationMs: 0,
      command: 'N/A',
    };
  }

  const fullCommand = `${command} ${args.join(' ')}`;
  const result = await runCommand(command, args, options);

  // If ruff fails, try flake8 for Python
  if (!result.success && project.type === 'python' && args.includes('ruff')) {
    const flake8Result = await runCommand('python', ['-m', 'flake8', '.'], options);
    if (flake8Result.exitCode !== -1 || !flake8Result.output.includes('No module')) {
      return {
        type: 'lint',
        success: flake8Result.success,
        output: flake8Result.output,
        exitCode: flake8Result.exitCode,
        durationMs: result.durationMs + flake8Result.durationMs,
        command: 'python -m flake8 .',
      };
    }
  }

  return {
    type: 'lint',
    success: result.success,
    output: result.output,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    command: fullCommand,
  };
}

/**
 * Run tests
 *
 * Tries in order:
 * 1. npm test (if script exists, for Node.js)
 * 2. pytest (for Python projects)
 */
export async function runTest(options: RunCheckOptions): Promise<CheckResult> {
  const { cwd } = options;
  const project = detectProject(cwd);

  let command = '';
  let args: string[] = [];

  if (project.type === 'node') {
    if (project.scripts['test'] && project.scripts['test'] !== 'echo "Error: no test specified" && exit 1') {
      command = 'npm';
      args = ['test'];
    } else {
      return {
        type: 'test',
        success: true,
        output: 'No test script configured - skipping tests',
        exitCode: 0,
        durationMs: 0,
        command: 'N/A',
      };
    }
  } else if (project.type === 'python') {
    command = 'python';
    args = ['-m', 'pytest'];
  } else {
    return {
      type: 'test',
      success: false,
      output: 'Unable to determine project type for testing',
      exitCode: -1,
      durationMs: 0,
      command: 'N/A',
    };
  }

  const fullCommand = `${command} ${args.join(' ')}`;
  const result = await runCommand(command, args, options);

  return {
    type: 'test',
    success: result.success,
    output: result.output,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    command: fullCommand,
  };
}

/**
 * Run all checks (typecheck, lint, test)
 */
export async function runAllChecks(options: RunCheckOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Run checks sequentially to avoid resource contention
  results.push(await runTypecheck(options));
  results.push(await runLint(options));
  results.push(await runTest(options));

  return results;
}

/**
 * Run specific checks
 */
export async function runChecks(
  types: CheckType[],
  options: RunCheckOptions
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const type of types) {
    switch (type) {
      case 'typecheck':
        results.push(await runTypecheck(options));
        break;
      case 'lint':
        results.push(await runLint(options));
        break;
      case 'test':
        results.push(await runTest(options));
        break;
    }
  }

  return results;
}
