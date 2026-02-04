/**
 * SQLite VSS Extension Loader
 *
 * Provides a safe interface for loading the sqlite-vss extension for vector similarity search.
 * Handles platform detection, multiple installation paths, and graceful fallback when
 * the extension is unavailable.
 *
 * sqlite-vss is a SQLite extension that enables vector similarity search using
 * approximate nearest neighbor algorithms (like IVF). When available, it provides
 * efficient vector search capabilities for semantic memory retrieval.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * Result of attempting to load the VSS extension
 */
export interface VSSLoadResult {
  /** Whether the VSS extension was successfully loaded */
  available: boolean;
  /** Error message if loading failed */
  error?: string;
  /** Path to the loaded extension (if successful) */
  loadedFrom?: string;
  /** Platform detected */
  platform: NodeJS.Platform;
}

/**
 * Get the file extension for dynamic libraries on the current platform
 */
function getLibraryExtension(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return '.dylib';
    case 'win32':
      return '.dll';
    default:
      // Linux and other Unix-like systems
      return '.so';
  }
}

/**
 * Get common installation paths for sqlite-vss on the current platform
 */
function getVSSSearchPaths(platform: NodeJS.Platform): string[] {
  const ext = getLibraryExtension(platform);
  const vssLib = `vss0${ext}`;
  const vectorLib = `vector0${ext}`;

  const paths: string[] = [];

  switch (platform) {
    case 'darwin':
      // Homebrew on Apple Silicon
      paths.push('/opt/homebrew/lib/sqlite-vss');
      paths.push('/opt/homebrew/lib');
      // Homebrew on Intel Mac
      paths.push('/usr/local/lib/sqlite-vss');
      paths.push('/usr/local/lib');
      // MacPorts
      paths.push('/opt/local/lib');
      // User-specific installations
      paths.push(path.join(process.env.HOME || '', '.local/lib'));
      paths.push(path.join(process.env.HOME || '', 'lib'));
      break;

    case 'linux':
      // Standard Linux paths
      paths.push('/usr/lib/sqlite-vss');
      paths.push('/usr/local/lib/sqlite-vss');
      paths.push('/usr/lib');
      paths.push('/usr/local/lib');
      paths.push('/usr/lib/x86_64-linux-gnu');
      paths.push('/usr/lib/aarch64-linux-gnu');
      // User-specific installations
      paths.push(path.join(process.env.HOME || '', '.local/lib'));
      paths.push(path.join(process.env.HOME || '', 'lib'));
      // Linuxbrew
      paths.push(path.join(process.env.HOME || '', '.linuxbrew/lib'));
      break;

    case 'win32':
      // Windows paths
      if (process.env.PROGRAMFILES) {
        paths.push(path.join(process.env.PROGRAMFILES, 'sqlite-vss'));
        paths.push(path.join(process.env.PROGRAMFILES, 'SQLite'));
      }
      if (process.env['PROGRAMFILES(X86)']) {
        paths.push(path.join(process.env['PROGRAMFILES(X86)'], 'sqlite-vss'));
        paths.push(path.join(process.env['PROGRAMFILES(X86)'], 'SQLite'));
      }
      if (process.env.LOCALAPPDATA) {
        paths.push(path.join(process.env.LOCALAPPDATA, 'sqlite-vss'));
      }
      if (process.env.USERPROFILE) {
        paths.push(path.join(process.env.USERPROFILE, '.local/lib'));
      }
      break;
  }

  // Environment variable override (check first)
  if (process.env.SQLITE_VSS_PATH) {
    paths.unshift(process.env.SQLITE_VSS_PATH);
  }

  // Build full paths for both vss0 and vector0 libraries
  // sqlite-vss requires both libraries to be loaded
  const fullPaths: string[] = [];
  for (const dir of paths) {
    // Try vss0 directly
    fullPaths.push(path.join(dir, vssLib));
    // Try vector0 (dependency of vss0)
    fullPaths.push(path.join(dir, vectorLib));
  }

  return fullPaths;
}

/**
 * Find the first existing VSS library path
 */
function findVSSLibrary(platform: NodeJS.Platform): { vssPath: string; vectorPath: string } | null {
  const ext = getLibraryExtension(platform);
  const searchPaths = getVSSSearchPaths(platform);

  // Deduplicate directory paths
  const directories = new Set<string>();
  for (const fullPath of searchPaths) {
    directories.add(path.dirname(fullPath));
  }

  // Convert Set to Array for iteration
  const directoryList = Array.from(directories);

  // Look for both vss0 and vector0 in the same directory
  for (const dir of directoryList) {
    const vssPath = path.join(dir, `vss0${ext}`);
    const vectorPath = path.join(dir, `vector0${ext}`);

    // Check if both files exist
    if (fs.existsSync(vssPath) && fs.existsSync(vectorPath)) {
      return { vssPath, vectorPath };
    }

    // Also check for alternative naming patterns
    const altVssPath = path.join(dir, `libvss0${ext}`);
    const altVectorPath = path.join(dir, `libvector0${ext}`);

    if (fs.existsSync(altVssPath) && fs.existsSync(altVectorPath)) {
      return { vssPath: altVssPath, vectorPath: altVectorPath };
    }
  }

  // Check for vss0 without vector0 (some builds include vector0 statically)
  for (const dir of directoryList) {
    const vssPath = path.join(dir, `vss0${ext}`);
    if (fs.existsSync(vssPath)) {
      return { vssPath, vectorPath: '' }; // Empty string means vector0 is not separate
    }

    const altVssPath = path.join(dir, `libvss0${ext}`);
    if (fs.existsSync(altVssPath)) {
      return { vssPath: altVssPath, vectorPath: '' };
    }
  }

  return null;
}

/**
 * Load the sqlite-vss extension into a database instance
 *
 * @param db - The better-sqlite3 database instance
 * @returns Result object indicating success/failure and details
 *
 * @example
 * ```typescript
 * import Database from 'better-sqlite3';
 * import { loadVSSExtension } from './vss-loader';
 *
 * const db = new Database('my.db');
 * const result = loadVSSExtension(db);
 *
 * if (result.available) {
 *   console.log(`VSS loaded from: ${result.loadedFrom}`);
 *   // Use vector similarity search
 * } else {
 *   console.log(`VSS unavailable: ${result.error}`);
 *   // Fall back to alternative search method
 * }
 * ```
 */
export function loadVSSExtension(db: Database.Database): VSSLoadResult {
  const platform = process.platform;

  // Find the VSS library
  const libraryPaths = findVSSLibrary(platform);

  if (!libraryPaths) {
    return {
      available: false,
      error: `sqlite-vss extension not found. Install it from https://github.com/asg017/sqlite-vss or set SQLITE_VSS_PATH environment variable.`,
      platform,
    };
  }

  try {
    // Load vector0 first if it's a separate file (dependency of vss0)
    if (libraryPaths.vectorPath) {
      db.loadExtension(libraryPaths.vectorPath);
    }

    // Load vss0 extension
    db.loadExtension(libraryPaths.vssPath);

    // Verify the extension loaded correctly by checking for vss_version function
    try {
      const version = db.prepare('SELECT vss_version()').pluck().get() as string;
      return {
        available: true,
        loadedFrom: libraryPaths.vssPath,
        platform,
      };
    } catch {
      // vss_version might not exist in all versions, but if loadExtension succeeded,
      // the extension is likely loaded
      return {
        available: true,
        loadedFrom: libraryPaths.vssPath,
        platform,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages for common issues
    let helpfulError = errorMessage;

    if (errorMessage.includes('cannot open shared object')) {
      helpfulError = `Failed to load sqlite-vss: ${errorMessage}. Ensure the library and its dependencies are accessible.`;
    } else if (errorMessage.includes('symbol not found') || errorMessage.includes('undefined symbol')) {
      helpfulError = `sqlite-vss version mismatch or missing dependencies: ${errorMessage}. Try reinstalling with matching SQLite version.`;
    } else if (errorMessage.includes('not authorized')) {
      helpfulError = `Extension loading not authorized. Ensure better-sqlite3 was built with extension support enabled.`;
    }

    return {
      available: false,
      error: helpfulError,
      platform,
    };
  }
}

/**
 * Check if VSS extension is available without actually loading it
 *
 * This is useful for checking availability before attempting to load,
 * allowing the application to plan its search strategy accordingly.
 *
 * @returns Object with availability status and library path if found
 */
export function checkVSSAvailability(): {
  available: boolean;
  path?: string;
  platform: NodeJS.Platform;
} {
  const platform = process.platform;
  const libraryPaths = findVSSLibrary(platform);

  if (libraryPaths) {
    return {
      available: true,
      path: libraryPaths.vssPath,
      platform,
    };
  }

  return {
    available: false,
    platform,
  };
}

/**
 * Get installation instructions for sqlite-vss on the current platform
 */
export function getVSSInstallInstructions(): string {
  const platform = process.platform;

  switch (platform) {
    case 'darwin':
      return `To install sqlite-vss on macOS:

1. Using Homebrew (recommended):
   brew install asg017/sqlite-ecosystem/sqlite-vss

2. Or build from source:
   git clone https://github.com/asg017/sqlite-vss.git
   cd sqlite-vss
   make loadable
   cp dist/vss0.dylib /usr/local/lib/

3. Set SQLITE_VSS_PATH environment variable if installed elsewhere:
   export SQLITE_VSS_PATH=/path/to/sqlite-vss
`;

    case 'linux':
      return `To install sqlite-vss on Linux:

1. Download prebuilt binaries:
   # For x86_64:
   wget https://github.com/asg017/sqlite-vss/releases/latest/download/sqlite-vss-linux-x86_64.tar.gz
   tar -xzf sqlite-vss-linux-x86_64.tar.gz
   sudo cp vss0.so vector0.so /usr/local/lib/

   # For ARM64:
   wget https://github.com/asg017/sqlite-vss/releases/latest/download/sqlite-vss-linux-arm64.tar.gz
   tar -xzf sqlite-vss-linux-arm64.tar.gz
   sudo cp vss0.so vector0.so /usr/local/lib/

2. Or build from source:
   git clone https://github.com/asg017/sqlite-vss.git
   cd sqlite-vss
   make loadable
   sudo cp dist/vss0.so dist/vector0.so /usr/local/lib/

3. Set SQLITE_VSS_PATH environment variable if installed elsewhere:
   export SQLITE_VSS_PATH=/path/to/sqlite-vss
`;

    case 'win32':
      return `To install sqlite-vss on Windows:

1. Download prebuilt binaries:
   - Visit https://github.com/asg017/sqlite-vss/releases/latest
   - Download sqlite-vss-windows-x86_64.zip
   - Extract vss0.dll and vector0.dll to a directory in your PATH

2. Or place the DLLs in:
   - %PROGRAMFILES%\\sqlite-vss\\
   - %LOCALAPPDATA%\\sqlite-vss\\

3. Set SQLITE_VSS_PATH environment variable:
   set SQLITE_VSS_PATH=C:\\path\\to\\sqlite-vss
`;

    default:
      return `To install sqlite-vss:

Visit https://github.com/asg017/sqlite-vss for platform-specific instructions.
Set SQLITE_VSS_PATH environment variable to the directory containing the extension.
`;
  }
}

/**
 * VSS status cache to avoid repeated filesystem checks
 */
let vssStatusCache: VSSLoadResult | null = null;

/**
 * Get cached VSS status or load it
 * Useful for checking status without repeated filesystem operations
 */
export function getCachedVSSStatus(db?: Database.Database): VSSLoadResult | null {
  if (vssStatusCache !== null) {
    return vssStatusCache;
  }

  if (db) {
    vssStatusCache = loadVSSExtension(db);
    return vssStatusCache;
  }

  // If no db provided, just check availability
  const availability = checkVSSAvailability();
  return {
    available: availability.available,
    platform: availability.platform,
    loadedFrom: availability.path,
    error: availability.available ? undefined : 'VSS extension not found',
  };
}

/**
 * Clear the VSS status cache
 * Call this if the extension might have been installed/uninstalled
 */
export function clearVSSStatusCache(): void {
  vssStatusCache = null;
}
