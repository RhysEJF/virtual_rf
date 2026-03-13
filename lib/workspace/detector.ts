/**
 * Workspace Output Detector
 *
 * Scans an outcome's workspace directory and detects what was created.
 * Returns structured information about outputs with contextual actions.
 */

import fs from 'fs';
import path from 'path';
import { paths } from '../config/paths';

// ============================================================================
// Types
// ============================================================================

export type OutputType = 'app' | 'research' | 'document' | 'data' | 'asset' | 'unknown';

export type AppType = 'node' | 'static';

export interface DetectedApp {
  id: string;
  type: AppType;
  name: string;
  path: string;           // Relative to workspace
  absolutePath: string;   // Full system path
  framework?: string;     // e.g., 'Next.js', 'React', 'Express'
  entryPoint: string;     // e.g., 'npm run dev' or 'index.html'
  scripts?: {
    dev?: boolean;
    start?: boolean;
    build?: boolean;
  };
}

export interface DetectedOutput {
  id: string;
  type: OutputType;
  name: string;
  path: string;           // Relative to workspace
  absolutePath: string;   // Full system path
  description: string;
  actions: OutputAction[];
  metadata: Record<string, unknown>;
}

export interface OutputAction {
  id: string;
  label: string;
  type: 'view' | 'run' | 'open' | 'download';
  endpoint?: string;      // API endpoint to call
  url?: string;           // Direct URL to open
}

export interface WorkspaceInfo {
  path: string;
  exists: boolean;
  outputs: DetectedOutput[];
  summary: {
    apps: number;
    documents: number;
    research: number;
    total: number;
  };
}

// ============================================================================
// Workspace Path Resolution
// ============================================================================

const WORKSPACES_ROOT = paths.workspaces;

export function getWorkspacePath(outcomeId: string): string {
  return path.join(WORKSPACES_ROOT, outcomeId);
}

export function ensureWorkspaceExists(outcomeId: string): string {
  const workspacePath = getWorkspacePath(outcomeId);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }
  return workspacePath;
}

// ============================================================================
// Detection Logic
// ============================================================================

/** Directories and files to skip during recursive scan */
const IGNORED_NAMES = new Set([
  'node_modules', '.git', '.next', 'dist', '.cache',
]);
const IGNORED_FILES = new Set([
  'claude.md', 'readme.md', 'package.json', 'package-lock.json',
  'tsconfig.json', '.gitignore', '.eslintrc.json',
]);

/** Map file extension to output type */
function classifyFile(ext: string, relativePath: string): { type: OutputType; description: string } {
  const dir = relativePath.split('/')[0]?.toLowerCase() ?? '';

  if (['.md', '.txt', '.mdx'].includes(ext)) {
    if (dir === 'research') return { type: 'research', description: 'Research document' };
    return { type: 'document', description: 'Document' };
  }
  if (['.json', '.csv', '.xml', '.yaml', '.yml', '.toml'].includes(ext)) {
    return { type: 'data', description: 'Data file' };
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) {
    return { type: 'asset', description: 'Image' };
  }
  if (['.pdf'].includes(ext)) {
    return { type: 'document', description: 'PDF document' };
  }
  if (['.html', '.htm'].includes(ext)) {
    return { type: 'document', description: 'HTML document' };
  }
  return { type: 'unknown', description: 'File' };
}

/**
 * Recursively walk workspace and collect all output files
 */
function walkWorkspace(
  dir: string,
  workspacePath: string,
  outcomeId: string,
  outputs: DetectedOutput[],
): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry)) continue;

    const fullPath = path.join(dir, entry);
    let stats: fs.Stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      // Skip skills directory — shown separately in UI
      if (entry === 'skills' && dir === workspacePath) continue;
      // Skip tools directory — shown separately in UI
      if (entry === 'tools' && dir === workspacePath) continue;
      walkWorkspace(fullPath, workspacePath, outcomeId, outputs);
      continue;
    }

    if (!stats.isFile()) continue;

    const lowerEntry = entry.toLowerCase();
    if (IGNORED_FILES.has(lowerEntry)) continue;
    // Skip worker logs and progress files
    if (lowerEntry === 'progress.txt') continue;
    if (lowerEntry.endsWith('.log')) continue;

    const ext = path.extname(entry).toLowerCase();
    const relativePath = path.relative(workspacePath, fullPath);
    const { type, description } = classifyFile(ext, relativePath);

    const name = entry
      .replace(/\.[^/.]+$/, '')
      .replace(/-/g, ' ')
      .replace(/_/g, ' ');

    outputs.push({
      id: `file-${relativePath.replace(/[/\\]/g, '-')}`,
      type,
      name: capitalizeWords(name),
      path: relativePath,
      absolutePath: fullPath,
      description: `${description} (${formatFileSize(stats.size)})`,
      actions: [
        {
          id: 'view',
          label: 'View',
          type: 'view',
          endpoint: `/api/outcomes/${outcomeId}/outputs/${encodeURIComponent(relativePath)}`,
        },
      ],
      metadata: {
        size: stats.size,
        modified: stats.mtime.toISOString(),
        directory: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
        extension: ext,
      },
    });
  }
}

/**
 * Scan a workspace and detect all outputs
 */
export function detectOutputs(outcomeId: string): WorkspaceInfo {
  const workspacePath = getWorkspacePath(outcomeId);
  const exists = fs.existsSync(workspacePath);

  if (!exists) {
    return {
      path: workspacePath,
      exists: false,
      outputs: [],
      summary: { apps: 0, documents: 0, research: 0, total: 0 },
    };
  }

  const outputs: DetectedOutput[] = [];

  // Check for Node.js app (package.json at root)
  const packageJsonPath = path.join(workspacePath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const appOutput = detectNodeApp(workspacePath, outcomeId);
    if (appOutput) outputs.push(appOutput);
  }

  // Recursively walk the entire workspace
  walkWorkspace(workspacePath, workspacePath, outcomeId, outputs);

  // Calculate summary
  const summary = {
    apps: outputs.filter(o => o.type === 'app').length,
    documents: outputs.filter(o => o.type === 'document').length,
    research: outputs.filter(o => o.type === 'research').length,
    total: outputs.length,
  };

  return {
    path: workspacePath,
    exists: true,
    outputs,
    summary,
  };
}

// ============================================================================
// Specific Detectors
// ============================================================================

function detectNodeApp(workspacePath: string, outcomeId: string): DetectedOutput | null {
  const packageJsonPath = path.join(workspacePath, 'package.json');

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const scripts = packageJson.scripts || {};

    // Determine what kind of app and how to run it
    const hasDevScript = 'dev' in scripts;
    const hasStartScript = 'start' in scripts;
    const hasBuildScript = 'build' in scripts;

    // Detect framework
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    let framework = 'Node.js';
    if (deps['next']) framework = 'Next.js';
    else if (deps['react']) framework = 'React';
    else if (deps['vue']) framework = 'Vue';
    else if (deps['express']) framework = 'Express';

    const actions: OutputAction[] = [];

    if (hasDevScript) {
      actions.push({
        id: 'run-dev',
        label: 'Run Dev Server',
        type: 'run',
        endpoint: `/api/outcomes/${outcomeId}/server`,
      });
    } else if (hasStartScript) {
      actions.push({
        id: 'run-start',
        label: 'Start App',
        type: 'run',
        endpoint: `/api/outcomes/${outcomeId}/server`,
      });
    }

    actions.push({
      id: 'open-folder',
      label: 'Open in Finder',
      type: 'open',
    });

    return {
      id: `app-${outcomeId}`,
      type: 'app',
      name: packageJson.name || 'Application',
      path: '/',
      absolutePath: workspacePath,
      description: `${framework} application${packageJson.description ? `: ${packageJson.description}` : ''}`,
      actions,
      metadata: {
        framework,
        hasDevScript,
        hasStartScript,
        hasBuildScript,
        version: packageJson.version,
      },
    };
  } catch {
    return null;
  }
}


// ============================================================================
// App Detection
// ============================================================================

/**
 * Detect all runnable apps in a workspace
 * Checks for:
 * 1. Node.js apps (package.json at root or in app/ subdirectories)
 * 2. Static sites (index.html in task_* directories)
 */
export function detectApps(outcomeId: string): DetectedApp[] {
  const workspacePath = getWorkspacePath(outcomeId);

  if (!fs.existsSync(workspacePath)) {
    return [];
  }

  const apps: DetectedApp[] = [];

  // 1. Check for Node.js app at workspace root
  const rootPackageJson = path.join(workspacePath, 'package.json');
  if (fs.existsSync(rootPackageJson)) {
    const app = detectNodeAppDetails(workspacePath, outcomeId, 'root');
    if (app) apps.push(app);
  }

  // 2. Check for apps in app/ subdirectory (common pattern)
  const appDir = path.join(workspacePath, 'app');
  if (fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()) {
    const entries = fs.readdirSync(appDir);
    for (const entry of entries) {
      const entryPath = path.join(appDir, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        const packageJsonPath = path.join(entryPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const app = detectNodeAppDetails(entryPath, outcomeId, `app-${entry}`);
          if (app) apps.push(app);
        }
      }
    }
  }

  // 3. Check for static sites in task_* directories
  try {
    const entries = fs.readdirSync(workspacePath);
    const taskDirs = entries.filter(e => {
      const fullPath = path.join(workspacePath, e);
      return e.startsWith('task_') && fs.statSync(fullPath).isDirectory();
    });

    for (const taskDir of taskDirs) {
      const taskPath = path.join(workspacePath, taskDir);

      // Check for package.json (Node app in task dir)
      const packageJsonPath = path.join(taskPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const app = detectNodeAppDetails(taskPath, outcomeId, taskDir);
        if (app) apps.push(app);
        continue;
      }

      // Check for index.html (static site)
      const indexHtmlPath = path.join(taskPath, 'index.html');
      if (fs.existsSync(indexHtmlPath)) {
        apps.push({
          id: `${outcomeId}-${taskDir}-static`,
          type: 'static',
          name: taskDir.replace('task_', 'Task '),
          path: taskDir,
          absolutePath: taskPath,
          entryPoint: 'index.html',
        });
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return apps;
}

/**
 * Detect Node.js app details from a directory
 */
function detectNodeAppDetails(
  appPath: string,
  outcomeId: string,
  appId: string
): DetectedApp | null {
  const packageJsonPath = path.join(appPath, 'package.json');

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const scripts = packageJson.scripts || {};

    const hasDev = 'dev' in scripts;
    const hasStart = 'start' in scripts;
    const hasBuild = 'build' in scripts;

    // Detect framework
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    let framework = 'Node.js';
    if (deps['next']) framework = 'Next.js';
    else if (deps['react']) framework = 'React';
    else if (deps['vue']) framework = 'Vue';
    else if (deps['svelte'] || deps['@sveltejs/kit']) framework = 'Svelte';
    else if (deps['express']) framework = 'Express';
    else if (deps['fastify']) framework = 'Fastify';

    // Determine entry point
    const entryPoint = hasDev ? 'npm run dev' : hasStart ? 'npm start' : 'npm run dev';

    return {
      id: `${outcomeId}-${appId}`,
      type: 'node',
      name: packageJson.name || appId,
      path: path.relative(getWorkspacePath(outcomeId), appPath) || '.',
      absolutePath: appPath,
      framework,
      entryPoint,
      scripts: {
        dev: hasDev,
        start: hasStart,
        build: hasBuild,
      },
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Utilities
// ============================================================================

function capitalizeWords(str: string): string {
  return str.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
