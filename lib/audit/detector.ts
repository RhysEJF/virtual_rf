/**
 * Project Type Detector
 *
 * Detects project type by checking for language/framework-specific files
 * and returns available validation checks for that project type.
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'unknown';

export interface AvailableCheck {
  id: string;
  name: string;
  command: string;
  description: string;
  optional: boolean;
}

export interface ProjectDetectionResult {
  type: ProjectType;
  confidence: 'high' | 'medium' | 'low';
  indicators: string[];
  availableChecks: AvailableCheck[];
  metadata: Record<string, unknown>;
}

// ============================================================================
// Check Definitions per Project Type
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
// Detection Logic
// ============================================================================

/**
 * Detect project type for a given directory
 */
export function detectProjectType(projectPath: string): ProjectDetectionResult {
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

// ============================================================================
// Project-Specific Detectors
// ============================================================================

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
// Utility Functions
// ============================================================================

/**
 * Get a human-readable label for a project type
 */
export function getProjectTypeLabel(type: ProjectType): string {
  const labels: Record<ProjectType, string> = {
    node: 'Node.js',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    unknown: 'Unknown',
  };
  return labels[type];
}

/**
 * Detect multiple projects in a directory (for monorepos)
 */
export function detectProjects(rootPath: string): ProjectDetectionResult[] {
  const results: ProjectDetectionResult[] = [];

  // First check the root
  const rootResult = detectProjectType(rootPath);
  if (rootResult.type !== 'unknown') {
    results.push(rootResult);
  }

  // Then check immediate subdirectories for additional projects
  try {
    const entries = fs.readdirSync(rootPath);
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') {
        continue;
      }

      const entryPath = path.join(rootPath, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        const subResult = detectProjectType(entryPath);
        if (subResult.type !== 'unknown') {
          // Add subdirectory info to metadata
          subResult.metadata.subdirectory = entry;
          results.push(subResult);
        }
      }
    }
  } catch {
    // Ignore errors reading subdirectories
  }

  return results;
}
