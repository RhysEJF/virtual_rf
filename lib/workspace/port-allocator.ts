/**
 * Port Allocator
 *
 * Manages port allocation for workspace app servers.
 * Ensures consistent port assignment per outcome/app combination.
 * Uses ports 3100-3199 to avoid conflict with main app (3000).
 */

import net from 'net';

// ============================================================================
// Configuration
// ============================================================================

const BASE_PORT = 3100;
const PORT_RANGE = 100;  // 3100-3199
const MAX_PORT = BASE_PORT + PORT_RANGE - 1;

// ============================================================================
// Port Tracking
// ============================================================================

// Map of appKey (outcomeId:appId) -> port
const allocatedPorts: Map<string, number> = new Map();

// Set of currently allocated ports for quick lookup
const usedPorts: Set<number> = new Set();

// ============================================================================
// Port Allocation
// ============================================================================

/**
 * Get a consistent port for an app.
 * Returns the same port if already allocated, or allocates a new one.
 */
export function allocatePort(outcomeId: string, appId: string): number {
  const key = `${outcomeId}:${appId}`;

  // Return existing allocation
  const existing = allocatedPorts.get(key);
  if (existing !== undefined) {
    return existing;
  }

  // Find an available port
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    if (!usedPorts.has(port)) {
      allocatedPorts.set(key, port);
      usedPorts.add(port);
      return port;
    }
  }

  // If all ports used, wrap around and try to find one
  // (this shouldn't happen in practice with 100 ports)
  throw new Error('No available ports in range 3100-3199');
}

/**
 * Release a port allocation
 */
export function releasePort(outcomeId: string, appId: string): boolean {
  const key = `${outcomeId}:${appId}`;
  const port = allocatedPorts.get(key);

  if (port !== undefined) {
    allocatedPorts.delete(key);
    usedPorts.delete(port);
    return true;
  }

  return false;
}

/**
 * Release all ports for an outcome
 */
export function releaseOutcomePorts(outcomeId: string): number {
  let released = 0;
  const keysToDelete: string[] = [];

  const entries = Array.from(allocatedPorts.entries());
  for (const [key, port] of entries) {
    if (key.startsWith(`${outcomeId}:`)) {
      keysToDelete.push(key);
      usedPorts.delete(port);
      released++;
    }
  }

  for (const key of keysToDelete) {
    allocatedPorts.delete(key);
  }

  return released;
}

/**
 * Get the port for an app (without allocating)
 */
export function getPort(outcomeId: string, appId: string): number | null {
  const key = `${outcomeId}:${appId}`;
  return allocatedPorts.get(key) ?? null;
}

/**
 * Check if a port is currently in use by actually probing it
 */
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(false);
    });

    server.listen(port);
  });
}

/**
 * Find an available port, checking both allocations and actual use
 */
export async function findAvailablePort(outcomeId: string, appId: string): Promise<number> {
  const key = `${outcomeId}:${appId}`;

  // Check for existing allocation first
  const existing = allocatedPorts.get(key);
  if (existing !== undefined) {
    const inUse = await isPortInUse(existing);
    if (!inUse) {
      return existing;
    }
    // If allocated but in use by something else, need to reallocate
    allocatedPorts.delete(key);
    usedPorts.delete(existing);
  }

  // Find an available port
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    if (!usedPorts.has(port)) {
      const inUse = await isPortInUse(port);
      if (!inUse) {
        allocatedPorts.set(key, port);
        usedPorts.add(port);
        return port;
      }
    }
  }

  throw new Error('No available ports in range 3100-3199');
}

/**
 * Get all allocated ports with their keys
 */
export function getAllAllocations(): { key: string; port: number; outcomeId: string; appId: string }[] {
  return Array.from(allocatedPorts.entries()).map(([key, port]) => {
    const [outcomeId, appId] = key.split(':');
    return { key, port, outcomeId, appId };
  });
}
