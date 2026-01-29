/**
 * Dev Server Manager
 *
 * Manages running dev servers for app outputs.
 * Tracks which servers are running and their ports.
 */

import { spawn, ChildProcess } from 'child_process';
import { getWorkspacePath } from './detector';

// ============================================================================
// Types
// ============================================================================

export interface RunningServer {
  outcomeId: string;
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

const runningServers: Map<string, RunningServer & { process: ChildProcess }> = new Map();

// Port allocation (start from 3100 to avoid conflicts)
let nextPort = 3100;

function allocatePort(): number {
  const port = nextPort;
  nextPort++;
  if (nextPort > 3199) nextPort = 3100; // Wrap around
  return port;
}

// ============================================================================
// Server Management
// ============================================================================

/**
 * Start a dev server for an outcome
 */
export async function startServer(outcomeId: string, script: string = 'dev'): Promise<RunningServer> {
  // Check if already running
  const existing = runningServers.get(outcomeId);
  if (existing && existing.status === 'running') {
    return {
      outcomeId: existing.outcomeId,
      pid: existing.pid,
      port: existing.port,
      command: existing.command,
      url: existing.url,
      startedAt: existing.startedAt,
      status: existing.status,
    };
  }

  const workspacePath = getWorkspacePath(outcomeId);
  const port = allocatePort();
  const command = `npm run ${script}`;

  // Create the server record
  const serverInfo: RunningServer = {
    outcomeId,
    pid: 0,
    port,
    command,
    url: `http://localhost:${port}`,
    startedAt: Date.now(),
    status: 'starting',
  };

  try {
    // Spawn the process with PORT environment variable
    const proc = spawn('npm', ['run', script], {
      cwd: workspacePath,
      env: {
        ...process.env,
        PORT: port.toString(),
        // Next.js specific
        NEXT_PUBLIC_PORT: port.toString(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    serverInfo.pid = proc.pid || 0;

    // Store in registry
    runningServers.set(outcomeId, { ...serverInfo, process: proc });

    // Handle process output
    let outputBuffer = '';

    proc.stdout?.on('data', (data: Buffer) => {
      outputBuffer += data.toString();
      console.log(`[Server ${outcomeId}] ${data.toString().trim()}`);

      // Detect when server is ready
      if (outputBuffer.includes('ready') || outputBuffer.includes('started') || outputBuffer.includes('localhost')) {
        const entry = runningServers.get(outcomeId);
        if (entry && entry.status === 'starting') {
          entry.status = 'running';
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[Server ${outcomeId}] ${data.toString().trim()}`);
    });

    proc.on('close', (code) => {
      console.log(`[Server ${outcomeId}] Process exited with code ${code}`);
      const entry = runningServers.get(outcomeId);
      if (entry) {
        entry.status = 'stopped';
      }
    });

    proc.on('error', (err) => {
      console.error(`[Server ${outcomeId}] Error:`, err);
      const entry = runningServers.get(outcomeId);
      if (entry) {
        entry.status = 'error';
        entry.error = err.message;
      }
    });

    // Wait a moment for the server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Return current status
    const current = runningServers.get(outcomeId);
    return {
      outcomeId: current?.outcomeId || outcomeId,
      pid: current?.pid || 0,
      port: current?.port || port,
      command: current?.command || command,
      url: current?.url || `http://localhost:${port}`,
      startedAt: current?.startedAt || serverInfo.startedAt,
      status: current?.status || 'starting',
      error: current?.error,
    };
  } catch (error) {
    serverInfo.status = 'error';
    serverInfo.error = error instanceof Error ? error.message : 'Failed to start server';
    return serverInfo;
  }
}

/**
 * Stop a running server
 */
export function stopServer(outcomeId: string): boolean {
  const server = runningServers.get(outcomeId);
  if (!server) return false;

  try {
    server.process.kill('SIGTERM');
    server.status = 'stopped';
    runningServers.delete(outcomeId);
    return true;
  } catch (error) {
    console.error(`[Server ${outcomeId}] Failed to stop:`, error);
    return false;
  }
}

/**
 * Get server status
 */
export function getServerStatus(outcomeId: string): RunningServer | null {
  const server = runningServers.get(outcomeId);
  if (!server) return null;

  return {
    outcomeId: server.outcomeId,
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
 * Get all running servers
 */
export function getAllRunningServers(): RunningServer[] {
  return Array.from(runningServers.values()).map(server => ({
    outcomeId: server.outcomeId,
    pid: server.pid,
    port: server.port,
    command: server.command,
    url: server.url,
    startedAt: server.startedAt,
    status: server.status,
    error: server.error,
  }));
}

/**
 * Stop all servers (cleanup on shutdown)
 */
export function stopAllServers(): void {
  const outcomeIds = Array.from(runningServers.keys());
  for (const outcomeId of outcomeIds) {
    stopServer(outcomeId);
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
