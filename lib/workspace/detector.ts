/**
 * Workspace Output Detector
 *
 * Scans an outcome's workspace directory and detects what was created.
 * Returns structured information about outputs with contextual actions.
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export type OutputType = 'app' | 'research' | 'document' | 'data' | 'asset' | 'unknown';

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

const WORKSPACES_ROOT = path.join(process.cwd(), 'workspaces');

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

  // Check for research folder
  const researchPath = path.join(workspacePath, 'research');
  if (fs.existsSync(researchPath) && fs.statSync(researchPath).isDirectory()) {
    const researchOutputs = detectResearchFolder(researchPath, outcomeId);
    outputs.push(...researchOutputs);
  }

  // Check for docs folder
  const docsPath = path.join(workspacePath, 'docs');
  if (fs.existsSync(docsPath) && fs.statSync(docsPath).isDirectory()) {
    const docOutputs = detectDocsFolder(docsPath, outcomeId);
    outputs.push(...docOutputs);
  }

  // Check for standalone markdown files at root
  const rootMarkdown = detectRootMarkdown(workspacePath, outcomeId);
  outputs.push(...rootMarkdown);

  // Check for output folder (common pattern)
  const outputPath = path.join(workspacePath, 'output');
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
    const outputFiles = detectOutputFolder(outputPath, outcomeId);
    outputs.push(...outputFiles);
  }

  // Check for task_* directories (Ralph worker outputs)
  const taskOutputs = detectTaskDirectories(workspacePath, outcomeId);
  outputs.push(...taskOutputs);

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

function detectResearchFolder(folderPath: string, outcomeId: string): DetectedOutput[] {
  const outputs: DetectedOutput[] = [];
  const relativePath = 'research';

  try {
    const files = fs.readdirSync(folderPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      const name = file.replace('.md', '').replace(/-/g, ' ').replace(/_/g, ' ');

      outputs.push({
        id: `research-${file}`,
        type: 'research',
        name: capitalizeWords(name),
        path: `${relativePath}/${file}`,
        absolutePath: filePath,
        description: `Research document (${formatFileSize(stats.size)})`,
        actions: [
          {
            id: 'view',
            label: 'View',
            type: 'view',
            endpoint: `/api/outcomes/${outcomeId}/outputs/${encodeURIComponent(`${relativePath}/${file}`)}`,
          },
          {
            id: 'download',
            label: 'Download',
            type: 'download',
          },
        ],
        metadata: {
          size: stats.size,
          modified: stats.mtime.toISOString(),
        },
      });
    }
  } catch {
    // Folder read error
  }

  return outputs;
}

function detectDocsFolder(folderPath: string, outcomeId: string): DetectedOutput[] {
  const outputs: DetectedOutput[] = [];
  const relativePath = 'docs';

  try {
    const files = fs.readdirSync(folderPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      const name = file.replace('.md', '').replace(/-/g, ' ').replace(/_/g, ' ');

      outputs.push({
        id: `doc-${file}`,
        type: 'document',
        name: capitalizeWords(name),
        path: `${relativePath}/${file}`,
        absolutePath: filePath,
        description: `Documentation (${formatFileSize(stats.size)})`,
        actions: [
          {
            id: 'view',
            label: 'View',
            type: 'view',
            endpoint: `/api/outcomes/${outcomeId}/outputs/${encodeURIComponent(`${relativePath}/${file}`)}`,
          },
        ],
        metadata: {
          size: stats.size,
          modified: stats.mtime.toISOString(),
        },
      });
    }
  } catch {
    // Folder read error
  }

  return outputs;
}

function detectRootMarkdown(workspacePath: string, outcomeId: string): DetectedOutput[] {
  const outputs: DetectedOutput[] = [];

  try {
    const files = fs.readdirSync(workspacePath);
    const mdFiles = files.filter(f =>
      f.endsWith('.md') &&
      f.toLowerCase() !== 'readme.md' &&
      f.toLowerCase() !== 'claude.md'
    );

    for (const file of mdFiles) {
      const filePath = path.join(workspacePath, file);
      const stats = fs.statSync(filePath);

      if (!stats.isFile()) continue;

      const name = file.replace('.md', '').replace(/-/g, ' ').replace(/_/g, ' ');

      outputs.push({
        id: `doc-root-${file}`,
        type: 'document',
        name: capitalizeWords(name),
        path: file,
        absolutePath: filePath,
        description: `Document (${formatFileSize(stats.size)})`,
        actions: [
          {
            id: 'view',
            label: 'View',
            type: 'view',
            endpoint: `/api/outcomes/${outcomeId}/outputs/${encodeURIComponent(file)}`,
          },
        ],
        metadata: {
          size: stats.size,
          modified: stats.mtime.toISOString(),
        },
      });
    }
  } catch {
    // Folder read error
  }

  return outputs;
}

function detectOutputFolder(folderPath: string, outcomeId: string): DetectedOutput[] {
  const outputs: DetectedOutput[] = [];
  const relativePath = 'output';

  try {
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);

      if (!stats.isFile()) continue;

      const ext = path.extname(file).toLowerCase();
      let type: OutputType = 'unknown';
      let description = 'Output file';

      if (['.md', '.txt'].includes(ext)) {
        type = 'document';
        description = 'Text document';
      } else if (['.json', '.csv', '.xml'].includes(ext)) {
        type = 'data';
        description = 'Data file';
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
        type = 'asset';
        description = 'Image';
      }

      const name = file.replace(/\.[^/.]+$/, '').replace(/-/g, ' ').replace(/_/g, ' ');

      outputs.push({
        id: `output-${file}`,
        type,
        name: capitalizeWords(name),
        path: `${relativePath}/${file}`,
        absolutePath: filePath,
        description: `${description} (${formatFileSize(stats.size)})`,
        actions: [
          {
            id: 'view',
            label: 'View',
            type: 'view',
            endpoint: `/api/outcomes/${outcomeId}/outputs/${encodeURIComponent(`${relativePath}/${file}`)}`,
          },
          {
            id: 'download',
            label: 'Download',
            type: 'download',
          },
        ],
        metadata: {
          size: stats.size,
          modified: stats.mtime.toISOString(),
          extension: ext,
        },
      });
    }
  } catch {
    // Folder read error
  }

  return outputs;
}

/**
 * Detect outputs from task_* directories (Ralph worker outputs)
 * These contain findings.md, output.md, research_findings.md etc.
 */
function detectTaskDirectories(workspacePath: string, outcomeId: string): DetectedOutput[] {
  const outputs: DetectedOutput[] = [];

  try {
    const entries = fs.readdirSync(workspacePath);
    const taskDirs = entries.filter(e => {
      const fullPath = path.join(workspacePath, e);
      return e.startsWith('task_') && fs.statSync(fullPath).isDirectory();
    });

    for (const taskDir of taskDirs) {
      const taskPath = path.join(workspacePath, taskDir);
      const taskFiles = fs.readdirSync(taskPath);

      // Look for output files (exclude CLAUDE.md and progress.txt)
      const outputFiles = taskFiles.filter(f =>
        f.endsWith('.md') &&
        f.toLowerCase() !== 'claude.md' &&
        f.toLowerCase() !== 'progress.txt'
      );

      for (const file of outputFiles) {
        const filePath = path.join(taskPath, file);
        const stats = fs.statSync(filePath);

        if (!stats.isFile()) continue;

        const relativePath = `${taskDir}/${file}`;
        const name = file.replace('.md', '').replace(/-/g, ' ').replace(/_/g, ' ');
        const taskId = taskDir.replace('task_', '');

        outputs.push({
          id: `task-${taskId}-${file}`,
          type: 'research',
          name: capitalizeWords(name),
          path: relativePath,
          absolutePath: filePath,
          description: `Task output (${formatFileSize(stats.size)})`,
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
            taskId: taskDir,
          },
        });
      }
    }
  } catch {
    // Folder read error
  }

  return outputs;
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
