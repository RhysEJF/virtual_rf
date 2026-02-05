/**
 * Flow Audit Command
 *
 * Runs technical validation (typecheck, lint, tests) on code projects and reports results.
 * Detects project type automatically and runs appropriate checks.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { addOutputFlags, OutputOptions } from '../utils/flags.js';

// ============================================================================
// Types
// ============================================================================

type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'unknown';
type CheckType = 'typecheck' | 'lint' | 'test' | 'build' | 'vet' | 'check' | 'clippy' | 'fmt-check' | 'format-check';

interface AvailableCheck {
  id: CheckType;
  name: string;
  command: string;
  description: string;
  optional: boolean;
}

interface ProjectDetectionResult {
  type: ProjectType;
  confidence: 'high' | 'medium' | 'low';
  indicators: string[];
  availableChecks: AvailableCheck[];
  metadata: Record<string, unknown>;
}

interface CheckResult {
  type: CheckType;
  name: string;
  success: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
  command: string;
}

interface AuditResult {
  projectPath: string;
  projectType: ProjectType;
  confidence: string;
  indicators: string[];
  metadata: Record<string, unknown>;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalDurationMs: number;
  };
}

// ============================================================================
// Check Definitions
// ============================================================================

const NODE_CHECKS: AvailableCheck[] = [
  {
    id: 'typecheck',
    name: 'TypeScript Check',
    command: 'npm run typecheck',
    description: 'Run TypeScript compiler to check for type errors',
    optional: false,
  },
  {
    id: 'lint',
    name: 'ESLint',
    command: 'npm run lint',
    description: 'Run ESLint to check for code quality issues',
    optional: false,
  },
  {
    id: 'test',
    name: 'Tests',
    command: 'npm test',
    description: 'Run test suite',
    optional: true,
  },
  {
    id: 'build',
    name: 'Build',
    command: 'npm run build',
    description: 'Build the project',
    optional: true,
  },
];

const PYTHON_CHECKS: AvailableCheck[] = [
  {
    id: 'typecheck',
    name: 'Type Check (mypy)',
    command: 'mypy .',
    description: 'Run mypy for static type checking',
    optional: false,
  },
  {
    id: 'lint',
    name: 'Lint (ruff)',
    command: 'ruff check .',
    description: 'Run ruff linter for code quality',
    optional: false,
  },
  {
    id: 'format-check',
    name: 'Format Check',
    command: 'ruff format --check .',
    description: 'Check code formatting with ruff',
    optional: true,
  },
  {
    id: 'test',
    name: 'Tests (pytest)',
    command: 'pytest',
    description: 'Run pytest test suite',
    optional: true,
  },
];

const GO_CHECKS: AvailableCheck[] = [
  {
    id: 'build',
    name: 'Build',
    command: 'go build ./...',
    description: 'Compile the project (includes type checking)',
    optional: false,
  },
  {
    id: 'vet',
    name: 'Go Vet',
    command: 'go vet ./...',
    description: 'Run go vet for suspicious constructs',
    optional: false,
  },
  {
    id: 'lint',
    name: 'Lint (golangci-lint)',
    command: 'golangci-lint run',
    description: 'Run golangci-lint for code quality',
    optional: true,
  },
  {
    id: 'test',
    name: 'Tests',
    command: 'go test ./...',
    description: 'Run test suite',
    optional: true,
  },
];

const RUST_CHECKS: AvailableCheck[] = [
  {
    id: 'check',
    name: 'Cargo Check',
    command: 'cargo check',
    description: 'Check project for errors without building',
    optional: false,
  },
  {
    id: 'clippy',
    name: 'Clippy',
    command: 'cargo clippy -- -D warnings',
    description: 'Run clippy linter for code quality',
    optional: false,
  },
  {
    id: 'fmt-check',
    name: 'Format Check',
    command: 'cargo fmt --check',
    description: 'Check code formatting',
    optional: true,
  },
  {
    id: 'test',
    name: 'Tests',
    command: 'cargo test',
    description: 'Run test suite',
    optional: true,
  },
];

// ============================================================================
// Project Detection
// ============================================================================

function detectProjectType(projectPath: string): ProjectDetectionResult {
  const absolutePath = path.isAbsolute(projectPath)
    ? projectPath
    : path.resolve(process.cwd(), projectPath);

  if (!fs.existsSync(absolutePath)) {
    return {
      type: 'unknown',
      confidence: 'low',
      indicators: [],
      availableChecks: [],
      metadata: { error: 'Path does not exist' },
    };
  }

  // Check for Node.js project
  const nodeResult = detectNodeProject(absolutePath);
  if (nodeResult) return nodeResult;

  // Check for Python project
  const pythonResult = detectPythonProject(absolutePath);
  if (pythonResult) return pythonResult;

  // Check for Go project
  const goResult = detectGoProject(absolutePath);
  if (goResult) return goResult;

  // Check for Rust project
  const rustResult = detectRustProject(absolutePath);
  if (rustResult) return rustResult;

  return {
    type: 'unknown',
    confidence: 'low',
    indicators: [],
    availableChecks: [],
    metadata: {},
  };
}

function detectNodeProject(projectPath: string): ProjectDetectionResult | null {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  const indicators: string[] = ['package.json'];
  const metadata: Record<string, unknown> = {};

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const scripts = packageJson.scripts || {};
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    metadata.name = packageJson.name;
    metadata.version = packageJson.version;

    // Detect TypeScript
    const hasTypeScript = deps['typescript'] || fs.existsSync(path.join(projectPath, 'tsconfig.json'));
    if (hasTypeScript) {
      indicators.push('TypeScript detected');
      metadata.typescript = true;
    }

    // Detect available scripts
    const availableScripts: string[] = [];
    if (scripts.typecheck || scripts['type-check']) availableScripts.push('typecheck');
    if (scripts.lint) availableScripts.push('lint');
    if (scripts.test) availableScripts.push('test');
    if (scripts.build) availableScripts.push('build');
    metadata.scripts = availableScripts;

    // Filter checks based on available scripts
    const availableChecks = NODE_CHECKS.filter(check => {
      if (check.id === 'typecheck') {
        return hasTypeScript && (scripts.typecheck || scripts['type-check']);
      }
      return scripts[check.id] !== undefined;
    });

    // Adjust commands based on actual script names
    const adjustedChecks = availableChecks.map(check => {
      if (check.id === 'typecheck' && scripts['type-check'] && !scripts.typecheck) {
        return { ...check, command: 'npm run type-check' };
      }
      return check;
    });

    return {
      type: 'node',
      confidence: 'high',
      indicators,
      availableChecks: adjustedChecks,
      metadata,
    };
  } catch {
    return {
      type: 'node',
      confidence: 'medium',
      indicators,
      availableChecks: [],
      metadata: { error: 'Failed to parse package.json' },
    };
  }
}

function detectPythonProject(projectPath: string): ProjectDetectionResult | null {
  const pyprojectPath = path.join(projectPath, 'pyproject.toml');
  const setupPyPath = path.join(projectPath, 'setup.py');
  const requirementsPath = path.join(projectPath, 'requirements.txt');

  const indicators: string[] = [];
  const metadata: Record<string, unknown> = {};

  const hasPyproject = fs.existsSync(pyprojectPath);
  const hasSetupPy = fs.existsSync(setupPyPath);
  const hasRequirements = fs.existsSync(requirementsPath);

  if (!hasPyproject && !hasSetupPy && !hasRequirements) {
    return null;
  }

  if (hasPyproject) indicators.push('pyproject.toml');
  if (hasSetupPy) indicators.push('setup.py');
  if (hasRequirements) indicators.push('requirements.txt');

  // Check for common Python tools
  const availableChecks: AvailableCheck[] = [];

  // mypy config check
  const hasMypy = hasPyproject || fs.existsSync(path.join(projectPath, 'mypy.ini'));
  if (hasMypy) {
    availableChecks.push(PYTHON_CHECKS.find(c => c.id === 'typecheck')!);
    metadata.mypy = true;
  }

  // ruff or other linter
  const hasRuff = hasPyproject || fs.existsSync(path.join(projectPath, 'ruff.toml'));
  const hasFlake8 = fs.existsSync(path.join(projectPath, '.flake8'));
  if (hasRuff) {
    availableChecks.push(PYTHON_CHECKS.find(c => c.id === 'lint')!);
    availableChecks.push(PYTHON_CHECKS.find(c => c.id === 'format-check')!);
    metadata.linter = 'ruff';
  } else if (hasFlake8) {
    availableChecks.push({
      id: 'lint',
      name: 'Lint (flake8)',
      command: 'flake8 .',
      description: 'Run flake8 linter',
      optional: false,
    });
    metadata.linter = 'flake8';
  }

  // pytest check
  const hasPytest = fs.existsSync(path.join(projectPath, 'pytest.ini')) ||
    fs.existsSync(path.join(projectPath, 'conftest.py')) ||
    fs.existsSync(path.join(projectPath, 'tests'));
  if (hasPytest) {
    availableChecks.push(PYTHON_CHECKS.find(c => c.id === 'test')!);
    metadata.pytest = true;
  }

  return {
    type: 'python',
    confidence: hasPyproject ? 'high' : 'medium',
    indicators,
    availableChecks,
    metadata,
  };
}

function detectGoProject(projectPath: string): ProjectDetectionResult | null {
  const goModPath = path.join(projectPath, 'go.mod');

  if (!fs.existsSync(goModPath)) {
    return null;
  }

  const indicators: string[] = ['go.mod'];
  const metadata: Record<string, unknown> = {};

  try {
    const goModContent = fs.readFileSync(goModPath, 'utf-8');
    const moduleMatch = goModContent.match(/^module\s+(.+)$/m);
    if (moduleMatch) {
      metadata.module = moduleMatch[1];
    }

    const goVersionMatch = goModContent.match(/^go\s+(\d+\.\d+)$/m);
    if (goVersionMatch) {
      metadata.goVersion = goVersionMatch[1];
    }
  } catch {
    // Continue with detection even if parsing fails
  }

  // Check for golangci-lint config
  const hasGolangciLint = fs.existsSync(path.join(projectPath, '.golangci.yml')) ||
    fs.existsSync(path.join(projectPath, '.golangci.yaml'));

  const availableChecks = GO_CHECKS.filter(check => {
    if (check.id === 'lint') {
      return hasGolangciLint;
    }
    return true;
  });

  if (hasGolangciLint) {
    metadata.golangciLint = true;
    indicators.push('golangci-lint config');
  }

  return {
    type: 'go',
    confidence: 'high',
    indicators,
    availableChecks,
    metadata,
  };
}

function detectRustProject(projectPath: string): ProjectDetectionResult | null {
  const cargoTomlPath = path.join(projectPath, 'Cargo.toml');

  if (!fs.existsSync(cargoTomlPath)) {
    return null;
  }

  const indicators: string[] = ['Cargo.toml'];
  const metadata: Record<string, unknown> = {};

  try {
    const cargoContent = fs.readFileSync(cargoTomlPath, 'utf-8');

    // Extract package name
    const nameMatch = cargoContent.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (nameMatch) {
      metadata.name = nameMatch[1];
    }

    // Extract version
    const versionMatch = cargoContent.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (versionMatch) {
      metadata.version = versionMatch[1];
    }

    // Check if it's a workspace
    if (cargoContent.includes('[workspace]')) {
      metadata.workspace = true;
      indicators.push('Cargo workspace');
    }
  } catch {
    // Continue with detection even if parsing fails
  }

  // Check for rustfmt config
  const hasRustfmt = fs.existsSync(path.join(projectPath, 'rustfmt.toml')) ||
    fs.existsSync(path.join(projectPath, '.rustfmt.toml'));
  if (hasRustfmt) {
    metadata.rustfmt = true;
    indicators.push('rustfmt config');
  }

  // Check for clippy config
  const hasClippy = fs.existsSync(path.join(projectPath, 'clippy.toml')) ||
    fs.existsSync(path.join(projectPath, '.clippy.toml'));
  if (hasClippy) {
    metadata.clippy = true;
    indicators.push('clippy config');
  }

  return {
    type: 'rust',
    confidence: 'high',
    indicators,
    availableChecks: RUST_CHECKS,
    metadata,
  };
}

// ============================================================================
// Check Runner
// ============================================================================

function runCommand(
  command: string,
  cwd: string,
  timeout: number = 120000
): Promise<{ success: boolean; output: string; exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Parse command into executable and args
    const [executable, ...args] = command.split(' ');

    const proc = spawn(executable, args, {
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

async function runCheck(check: AvailableCheck, cwd: string): Promise<CheckResult> {
  const result = await runCommand(check.command, cwd);

  return {
    type: check.id,
    name: check.name,
    success: result.success,
    output: result.output,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    command: check.command,
  };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function getProjectTypeLabel(type: ProjectType): string {
  const labels: Record<ProjectType, string> = {
    node: 'Node.js',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    unknown: 'Unknown',
  };
  return labels[type];
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCheckStatus(success: boolean): string {
  return success ? chalk.green('✓ PASS') : chalk.red('✗ FAIL');
}

function padRight(str: string, len: number): string {
  // Account for ANSI codes - strip them for length calculation
  const strippedLen = str.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = Math.max(0, len - strippedLen);
  return str + ' '.repeat(padding);
}

/**
 * Extract error summary from check output
 * Looks for common error patterns and extracts key information
 */
function extractErrorSummary(output: string, checkType: CheckType): ErrorSummary {
  const lines = output.split('\n').filter(l => l.trim());
  const errors: string[] = [];
  const warnings: string[] = [];

  // TypeScript error patterns
  if (checkType === 'typecheck') {
    const tsErrorRegex = /^(.+)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)$/;
    const tsSummaryRegex = /Found\s+(\d+)\s+error/i;

    for (const line of lines) {
      const match = line.match(tsErrorRegex);
      if (match) {
        errors.push(`${match[1]}:${match[2]} - ${match[4]}: ${match[5]}`);
      }
      const summaryMatch = line.match(tsSummaryRegex);
      if (summaryMatch) {
        // Already captured individual errors
      }
    }
  }

  // ESLint error patterns
  if (checkType === 'lint') {
    const eslintErrorRegex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)$/;
    const eslintFileRegex = /^\/.*\.(ts|js|tsx|jsx)$/;
    let currentFile = '';

    for (const line of lines) {
      if (eslintFileRegex.test(line.trim())) {
        currentFile = line.trim();
      } else {
        const match = line.match(eslintErrorRegex);
        if (match) {
          const severity = match[3];
          const message = `${currentFile}:${match[1]} - ${match[4]} (${match[5]})`;
          if (severity === 'error') {
            errors.push(message);
          } else {
            warnings.push(message);
          }
        }
      }
    }

    // Also check for summary line
    const eslintSummaryRegex = /(\d+)\s+error/i;
    const warningSummaryRegex = /(\d+)\s+warning/i;
    for (const line of lines) {
      const errMatch = line.match(eslintSummaryRegex);
      const warnMatch = line.match(warningSummaryRegex);
      if (errMatch && errors.length === 0) {
        // Fallback - just note there are errors
      }
      if (warnMatch && warnings.length === 0) {
        // Fallback - just note there are warnings
      }
    }
  }

  // Python (mypy) error patterns
  if (checkType === 'typecheck') {
    const mypyErrorRegex = /^(.+):(\d+):\s*(error|warning):\s*(.+)$/;
    for (const line of lines) {
      const match = line.match(mypyErrorRegex);
      if (match) {
        const message = `${match[1]}:${match[2]} - ${match[4]}`;
        if (match[3] === 'error') {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    }
  }

  // Python (ruff) lint patterns
  if (checkType === 'lint' || checkType === 'format-check') {
    const ruffErrorRegex = /^(.+):(\d+):(\d+):\s*(\w+)\s+(.+)$/;
    for (const line of lines) {
      const match = line.match(ruffErrorRegex);
      if (match) {
        errors.push(`${match[1]}:${match[2]} - ${match[4]}: ${match[5]}`);
      }
    }
  }

  // Go error patterns
  if (checkType === 'build' || checkType === 'vet') {
    const goErrorRegex = /^(.+):(\d+):(\d+):\s*(.+)$/;
    for (const line of lines) {
      const match = line.match(goErrorRegex);
      if (match && !line.includes('# ')) {
        errors.push(`${match[1]}:${match[2]} - ${match[4]}`);
      }
    }
  }

  // Rust error patterns
  if (checkType === 'check' || checkType === 'clippy') {
    const rustErrorRegex = /^error(\[E\d+\])?:\s*(.+)$/;
    const rustLocationRegex = /^\s*-->\s*(.+):(\d+):(\d+)$/;
    let lastError = '';

    for (let i = 0; i < lines.length; i++) {
      const errMatch = lines[i].match(rustErrorRegex);
      if (errMatch) {
        lastError = errMatch[2];
        // Look for location on next lines
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const locMatch = lines[j].match(rustLocationRegex);
          if (locMatch) {
            errors.push(`${locMatch[1]}:${locMatch[2]} - ${lastError}`);
            break;
          }
        }
      }
    }
  }

  // Test failure patterns (generic)
  if (checkType === 'test') {
    const failRegex = /(?:FAIL|FAILED|ERROR|Error)[\s:]+(.+)/i;
    for (const line of lines) {
      const match = line.match(failRegex);
      if (match) {
        errors.push(match[1].trim().substring(0, 100));
      }
    }
  }

  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    topErrors: errors.slice(0, 5),
    topWarnings: warnings.slice(0, 3),
  };
}

interface ErrorSummary {
  errorCount: number;
  warningCount: number;
  topErrors: string[];
  topWarnings: string[];
}

/**
 * Format a results table for display
 */
function formatResultsTable(results: CheckResult[]): string {
  const lines: string[] = [];

  // Calculate column widths
  const nameWidth = Math.max(12, ...results.map(r => r.name.length)) + 2;
  const statusWidth = 10;
  const durationWidth = 12;

  // Header
  lines.push(chalk.gray('─'.repeat(nameWidth + statusWidth + durationWidth + 4)));
  lines.push(
    `${padRight(chalk.bold('Check'), nameWidth)} ${padRight(chalk.bold('Status'), statusWidth)} ${chalk.bold('Duration')}`
  );
  lines.push(chalk.gray('─'.repeat(nameWidth + statusWidth + durationWidth + 4)));

  // Results
  for (const result of results) {
    const status = result.success ? chalk.green('PASS') : chalk.red('FAIL');
    const duration = chalk.gray(formatDuration(result.durationMs));
    lines.push(`${padRight(result.name, nameWidth)} ${padRight(status, statusWidth)} ${duration}`);
  }

  lines.push(chalk.gray('─'.repeat(nameWidth + statusWidth + durationWidth + 4)));

  return lines.join('\n');
}

/**
 * Format error details section
 */
function formatErrorDetails(results: CheckResult[]): string {
  const failedChecks = results.filter(r => !r.success);
  if (failedChecks.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold.red('Error Details'));
  lines.push('');

  for (const check of failedChecks) {
    const summary = extractErrorSummary(check.output, check.type);

    lines.push(`${chalk.red('▸')} ${chalk.bold(check.name)} ${chalk.gray(`(${check.command})`)}`);

    if (summary.errorCount > 0) {
      lines.push(`  ${chalk.red(`${summary.errorCount} error${summary.errorCount !== 1 ? 's' : ''}`)}${summary.warningCount > 0 ? chalk.yellow(`, ${summary.warningCount} warning${summary.warningCount !== 1 ? 's' : ''}`) : ''}`);
    }

    if (summary.topErrors.length > 0) {
      lines.push('');
      for (const err of summary.topErrors) {
        lines.push(`  ${chalk.gray('•')} ${err}`);
      }
      if (summary.errorCount > summary.topErrors.length) {
        lines.push(chalk.gray(`    ... and ${summary.errorCount - summary.topErrors.length} more`));
      }
    } else if (check.output) {
      // No parsed errors - show first few lines of output
      const outputLines = check.output.split('\n').filter(l => l.trim()).slice(0, 5);
      lines.push('');
      for (const line of outputLines) {
        lines.push(`  ${chalk.gray(line.substring(0, 100))}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format the final summary box
 */
function formatSummaryBox(
  results: CheckResult[],
  totalDurationMs: number
): string {
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const total = results.length;
  const allPassed = failed === 0;

  const lines: string[] = [];
  const boxWidth = 50;
  const border = allPassed ? chalk.green : chalk.red;

  lines.push('');
  lines.push(border('┌' + '─'.repeat(boxWidth - 2) + '┐'));
  lines.push(border('│') + ' '.repeat(boxWidth - 2) + border('│'));

  // Status line
  const statusIcon = allPassed ? chalk.green('✓') : chalk.red('✗');
  const statusText = allPassed ? chalk.green.bold('All checks passed') : chalk.red.bold('Audit failed');
  const statusLine = `  ${statusIcon} ${statusText}`;
  lines.push(border('│') + statusLine + ' '.repeat(boxWidth - 2 - statusLine.replace(/\x1b\[[0-9;]*m/g, '').length) + border('│'));

  lines.push(border('│') + ' '.repeat(boxWidth - 2) + border('│'));

  // Stats
  const statsLines = [
    `  Total:     ${total} check${total !== 1 ? 's' : ''}`,
    `  Passed:    ${chalk.green(passed.toString())}`,
    `  Failed:    ${failed > 0 ? chalk.red(failed.toString()) : '0'}`,
    `  Duration:  ${formatDuration(totalDurationMs)}`,
  ];

  for (const stat of statsLines) {
    const stripped = stat.replace(/\x1b\[[0-9;]*m/g, '');
    lines.push(border('│') + stat + ' '.repeat(boxWidth - 2 - stripped.length) + border('│'));
  }

  lines.push(border('│') + ' '.repeat(boxWidth - 2) + border('│'));
  lines.push(border('└' + '─'.repeat(boxWidth - 2) + '┘'));

  return lines.join('\n');
}

// ============================================================================
// Command Definition
// ============================================================================

interface AuditOptions extends OutputOptions {
  path?: string;
  verbose?: boolean;
}

const command = new Command('audit')
  .description('Run technical validation checks (typecheck, lint, tests) on a code project')
  .option('--path <path>', 'Path to the project directory (defaults to current directory)')
  .option('--verbose', 'Show full output from each check');

addOutputFlags(command);

export const flowAuditCommand = command
  .action(async (options: AuditOptions) => {
    const projectPath = options.path || process.cwd();
    const absolutePath = path.isAbsolute(projectPath)
      ? projectPath
      : path.resolve(process.cwd(), projectPath);

    // Detect project type
    const detection = detectProjectType(absolutePath);

    if (detection.type === 'unknown') {
      if (options.json) {
        const result: AuditResult = {
          projectPath: absolutePath,
          projectType: 'unknown',
          confidence: 'low',
          indicators: [],
          metadata: detection.metadata,
          checks: [],
          summary: { total: 0, passed: 0, failed: 0, totalDurationMs: 0 },
        };
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.quiet) {
        console.log('NO_PROJECT');
        return;
      }

      // Friendly message for non-code projects
      console.log();
      console.log(chalk.yellow('No code project detected'));
      console.log();
      console.log(`  ${chalk.gray('Path:')} ${absolutePath}`);
      if (detection.metadata.error) {
        console.log(`  ${chalk.gray('Note:')} ${detection.metadata.error}`);
      }
      console.log();
      console.log('Checked for the following project types:');
      console.log();
      console.log(`  ${chalk.cyan('•')} ${chalk.bold('Node.js')}  ${chalk.gray('- package.json')}`);
      console.log(`  ${chalk.cyan('•')} ${chalk.bold('Python')}   ${chalk.gray('- pyproject.toml, requirements.txt, or setup.py')}`);
      console.log(`  ${chalk.cyan('•')} ${chalk.bold('Go')}       ${chalk.gray('- go.mod')}`);
      console.log(`  ${chalk.cyan('•')} ${chalk.bold('Rust')}     ${chalk.gray('- Cargo.toml')}`);
      console.log();
      console.log(chalk.gray('If this directory contains code, ensure one of the above files exists.'));
      console.log();
      // Exit with code 0 - not an error, just no project to audit
      return;
    }

    if (detection.availableChecks.length === 0) {
      if (options.json) {
        const result: AuditResult = {
          projectPath: absolutePath,
          projectType: detection.type,
          confidence: detection.confidence,
          indicators: detection.indicators,
          metadata: detection.metadata,
          checks: [],
          summary: { total: 0, passed: 0, failed: 0, totalDurationMs: 0 },
        };
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log();
      console.log(chalk.yellow('⚠'), 'No checks available for this project');
      console.log();
      console.log(`  ${chalk.gray('Type:')}       ${getProjectTypeLabel(detection.type)}`);
      console.log(`  ${chalk.gray('Path:')}       ${absolutePath}`);
      console.log(`  ${chalk.gray('Indicators:')} ${detection.indicators.join(', ') || 'None'}`);
      console.log();
      process.exit(0);
    }

    // Print header
    if (!options.json && !options.quiet) {
      console.log();
      console.log(chalk.bold(`Auditing ${getProjectTypeLabel(detection.type)} project`));
      console.log();
      console.log(`  ${chalk.gray('Path:')}       ${absolutePath}`);
      console.log(`  ${chalk.gray('Confidence:')} ${detection.confidence}`);
      console.log(`  ${chalk.gray('Indicators:')} ${detection.indicators.join(', ')}`);
      console.log();
      console.log(chalk.gray(`Running ${detection.availableChecks.length} check${detection.availableChecks.length !== 1 ? 's' : ''}...`));
      console.log();
    }

    // Run all checks sequentially
    const results: CheckResult[] = [];
    let totalDurationMs = 0;

    for (const check of detection.availableChecks) {
      if (!options.json && !options.quiet) {
        process.stdout.write(`  ${chalk.gray('Running')} ${check.name}... `);
      }

      const result = await runCheck(check, absolutePath);
      results.push(result);
      totalDurationMs += result.durationMs;

      if (!options.json && !options.quiet) {
        console.log(`${formatCheckStatus(result.success)} ${chalk.gray(`(${formatDuration(result.durationMs)})`)}`);

        // In verbose mode, show full output for all checks
        if (options.verbose && result.output) {
          console.log();
          console.log(chalk.gray('    Command:'), result.command);
          console.log(chalk.gray('    Output:'));
          const lines = result.output.split('\n');
          for (const line of lines.slice(0, 50)) {
            console.log(`      ${line}`);
          }
          if (lines.length > 50) {
            console.log(chalk.gray(`      ... (${lines.length - 50} more lines)`));
          }
          console.log();
        }
      }
    }

    // Calculate summary
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    // Extract error summaries for JSON output
    const checksWithSummaries = results.map(r => {
      const errorSummary = extractErrorSummary(r.output, r.type);
      return {
        ...r,
        errorSummary: {
          errorCount: errorSummary.errorCount,
          warningCount: errorSummary.warningCount,
          topErrors: errorSummary.topErrors,
          topWarnings: errorSummary.topWarnings,
        },
      };
    });

    // Handle JSON output
    if (options.json) {
      const result: AuditResult & { checks: Array<CheckResult & { errorSummary: ErrorSummary }> } = {
        projectPath: absolutePath,
        projectType: detection.type,
        confidence: detection.confidence,
        indicators: detection.indicators,
        metadata: detection.metadata,
        checks: checksWithSummaries,
        summary: {
          total: results.length,
          passed,
          failed,
          totalDurationMs,
        },
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Handle quiet output - include pass/fail count
    if (options.quiet) {
      if (failed > 0) {
        console.log(`FAIL ${passed}/${results.length}`);
        process.exit(1);
      } else {
        console.log(`PASS ${passed}/${results.length}`);
        process.exit(0);
      }
    }

    // Print results table
    console.log();
    console.log(formatResultsTable(results));

    // Print error details for failed checks (unless verbose already showed them)
    if (failed > 0 && !options.verbose) {
      console.log(formatErrorDetails(results));
    }

    // Print summary box
    console.log(formatSummaryBox(results, totalDurationMs));
    console.log();

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  });

export default flowAuditCommand;
