/**
 * Dev Server Manager
 *
 * Manages running dev servers for app outputs.
 * Tracks which servers are running and their ports.
 * Supports multiple apps per outcome.
 */

import { spawn, ChildProcess } from 'child_process';
import { getWorkspacePath, type DetectedApp } from './detector';
import { allocatePort, releasePort, getPort } from './port-allocator';

// ============================================================================
// Types
// ============================================================================

export interface RunningServer {
  id: string;            // Unique server ID (matches app.id)
  outcomeId: string;
  appId: string;         // App identifier within the outcome
  type: 'node' | 'static';
  pid: number;
  port: number;
  command: string;
  url: string;
  startedAt: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
}

// ============================================================================
// In-Memory Server Registry
// ============================================================================

// Key: server ID (e.g., "out_xyz-root" or "out_xyz-task_1")
const runningServers: Map<string, RunningServer & { process: ChildProcess }> = new Map();

// ============================================================================
// Server Management
// ============================================================================

/**
 * Start a server for a detected app
 */
export async function startAppServer(outcomeId: string, app: DetectedApp): Promise<RunningServer> {
  const serverId = app.id;

  // Check if already running
  const existing = runningServers.get(serverId);
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    return serverToPublic(existing);
  }

  const port = allocatePort(outcomeId, app.id);
  const appPath = app.absolutePath;

  let command: string;
  let args: string[];

  if (app.type === 'static') {
    // Use npx serve for static sites
    command = 'npx';
    args = ['serve', '-l', port.toString(), '-s'];
  } else {
    // Node.js app
    const script = app.scripts?.dev ? 'dev' : app.scripts?.start ? 'start' : 'dev';
    command = 'npm';
    args = ['run', script];
  }

  // Create the server record
  const serverInfo: RunningServer & { process?: ChildProcess } = {
    id: serverId,
    outcomeId,
    appId: app.id,
    type: app.type,
    pid: 0,
    port,
    command: `${command} ${args.join(' ')}`,
    url: `http://localhost:${port}`,
    startedAt: Date.now(),
    status: 'starting',
  };

  try {
    // Spawn the process with PORT environment variable
    const proc = spawn(command, args, {
      cwd: appPath,
      env: {
        ...process.env,
        PORT: port.toString(),
        // Next.js specific
        NEXT_PUBLIC_PORT: port.toString(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: true,
    });

    serverInfo.pid = proc.pid || 0;
    serverInfo.process = proc;

    // Store in registry
    runningServers.set(serverId, serverInfo as RunningServer & { process: ChildProcess });

    // Handle process output
    let outputBuffer = '';

    proc.stdout?.on('data', (data: Buffer) => {
      outputBuffer += data.toString();
      console.log(`[Server ${serverId}] ${data.toString().trim()}`);

      // Detect when server is ready
      if (outputBuffer.includes('ready') || outputBuffer.includes('started') || outputBuffer.includes('localhost') || outputBuffer.includes('Serving!')) {
        const entry = runningServers.get(serverId);
        if (entry && entry.status === 'starting') {
          entry.status = 'running';
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[Server ${serverId}] ${data.toString().trim()}`);
    });

    proc.on('close', (code) => {
      console.log(`[Server ${serverId}] Process exited with code ${code}`);
      const entry = runningServers.get(serverId);
      if (entry) {
        entry.status = 'stopped';
        releasePort(outcomeId, app.id);
      }
    });

    proc.on('error', (err) => {
      console.error(`[Server ${serverId}] Error:`, err);
      const entry = runningServers.get(serverId);
      if (entry) {
        entry.status = 'error';
        entry.error = err.message;
      }
    });

    // Wait a moment for the server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Return current status
    const current = runningServers.get(serverId);
    return current ? serverToPublic(current) : serverInfo;
  } catch (error) {
    serverInfo.status = 'error';
    serverInfo.error = error instanceof Error ? error.message : 'Failed to start server';
    releasePort(outcomeId, app.id);
    return serverInfo;
  }
}

/**
 * Legacy start server (backwards compatible)
 * @deprecated Use startAppServer instead
 */
export async function startServer(outcomeId: string, script: string = 'dev'): Promise<RunningServer> {
  const app: DetectedApp = {
    id: `${outcomeId}-root`,
    type: 'node',
    name: 'Application',
    path: '.',
    absolutePath: getWorkspacePath(outcomeId),
    entryPoint: `npm run ${script}`,
    scripts: {
      dev: script === 'dev',
      start: script === 'start',
    },
  };
  return startAppServer(outcomeId, app);
}

/**
 * Convert internal server record to public API
 */
function serverToPublic(server: RunningServer & { process?: ChildProcess }): RunningServer {
  return {
    id: server.id,
    outcomeId: server.outcomeId,
    appId: server.appId,
    type: server.type,
    pid: server.pid,
    port: server.port,
    command: server.command,
    url: server.url,
    startedAt: server.startedAt,
    status: server.status,
    error: server.error,
  };
}

/**
 * Stop a running server by its ID
 */
export function stopServerById(serverId: string): boolean {
  const server = runningServers.get(serverId);
  if (!server) return false;

  try {
    server.process.kill('SIGTERM');
    server.status = 'stopped';
    releasePort(server.outcomeId, server.appId);
    runningServers.delete(serverId);
    return true;
  } catch (error) {
    console.error(`[Server ${serverId}] Failed to stop:`, error);
    return false;
  }
}

/**
 * Stop a running server (legacy, backwards compatible)
 * @deprecated Use stopServerById instead
 */
export function stopServer(outcomeId: string): boolean {
  // Try to find server by outcome ID (legacy behavior)
  const serverId = `${outcomeId}-root`;
  return stopServerById(serverId);
}

/**
 * Stop all servers for an outcome
 */
export function stopOutcomeServers(outcomeId: string): number {
  let stopped = 0;
  const entries = Array.from(runningServers.entries());
  for (const [serverId, server] of entries) {
    if (server.outcomeId === outcomeId) {
      if (stopServerById(serverId)) {
        stopped++;
      }
    }
  }
  return stopped;
}

/**
 * Get server status by ID
 */
export function getServerStatusById(serverId: string): RunningServer | null {
  const server = runningServers.get(serverId);
  return server ? serverToPublic(server) : null;
}

/**
 * Get server status (legacy)
 * @deprecated Use getServerStatusById instead
 */
export function getServerStatus(outcomeId: string): RunningServer | null {
  return getServerStatusById(`${outcomeId}-root`);
}

/**
 * Get all servers for an outcome
 */
export function getServersByOutcome(outcomeId: string): RunningServer[] {
  const servers: RunningServer[] = [];
  const allServers = Array.from(runningServers.values());
  for (const server of allServers) {
    if (server.outcomeId === outcomeId) {
      servers.push(serverToPublic(server));
    }
  }
  return servers;
}

/**
 * Get all running servers
 */
export function getAllRunningServers(): RunningServer[] {
  return Array.from(runningServers.values()).map(serverToPublic);
}

/**
 * Stop all servers (cleanup on shutdown)
 */
export function stopAllServers(): void {
  const serverIds = Array.from(runningServers.keys());
  for (const serverId of serverIds) {
    stopServerById(serverId);
  }
}

// Cleanup on process exit
process.on('exit', stopAllServers);
process.on('SIGINT', () => {
  stopAllServers();
  process.exit();
});
process.on('SIGTERM', () => {
  stopAllServers();
  process.exit();
});
