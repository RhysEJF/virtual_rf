/**
 * Eval Manager
 *
 * Three-level eval scanning (app → user → outcome) mirroring the skills system.
 * Scans markdown files with recipe structure from configured directories.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { paths } from '../config/paths';

// ============================================================================
// Types
// ============================================================================

export interface EvalMetadata {
  /** Unique identifier: filename without extension */
  id: string;
  /** Display name (from recipe heading or filename) */
  name: string;
  /** Source level */
  source: 'app' | 'user' | 'outcome';
  /** Outcome ID if source is 'outcome' */
  outcomeId?: string;
  /** Absolute file path */
  path: string;
  /** Brief description extracted from artifact description */
  description: string;
  /** Scoring mode from recipe */
  mode: 'judge' | 'command' | 'unknown';
  /** Optimization direction */
  direction: 'higher' | 'lower';
}

// ============================================================================
// Directory Scanning
// ============================================================================

/**
 * Scan a directory for eval recipe markdown files.
 * Looks for .md files that contain recipe structure.
 */
export function scanEvalsDirectory(
  dir: string,
  source: EvalMetadata['source'],
  outcomeId?: string
): EvalMetadata[] {
  if (!existsSync(dir)) return [];

  const evals: EvalMetadata[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && extname(entry) === '.md') {
        const metadata = extractMetadata(fullPath, source, outcomeId);
        if (metadata) {
          evals.push(metadata);
        }
      } else if (stat.isDirectory()) {
        // Scan subdirectories (category folders)
        const subEntries = readdirSync(fullPath);
        for (const subEntry of subEntries) {
          const subPath = join(fullPath, subEntry);
          if (statSync(subPath).isFile() && extname(subEntry) === '.md') {
            const metadata = extractMetadata(subPath, source, outcomeId);
            if (metadata) {
              evals.push(metadata);
            }
          }
        }
      }
    }
  } catch {
    // Directory read errors are non-fatal
  }

  return evals;
}

/**
 * Load all evals from all three levels (app + user + outcome workspaces).
 */
export function loadAllEvals(): EvalMetadata[] {
  const evals: EvalMetadata[] = [];

  // 1. App evals (ship with repo)
  evals.push(...scanEvalsDirectory(paths.appEvals, 'app'));

  // 2. User evals (personal library)
  evals.push(...scanEvalsDirectory(paths.userEvals, 'user'));

  // 3. Outcome evals (from workspaces)
  if (existsSync(paths.workspaces)) {
    try {
      const outcomes = readdirSync(paths.workspaces);
      for (const outcomeDir of outcomes) {
        if (!outcomeDir.startsWith('out_')) continue;
        const outcomeId = outcomeDir;
        const evalsDir = join(paths.workspaces, outcomeDir, 'evals');
        evals.push(...scanEvalsDirectory(evalsDir, 'outcome', outcomeId));
      }
    } catch {
      // Non-fatal
    }
  }

  return evals;
}

/**
 * Get the raw content of an eval file.
 */
export function getEvalContent(evalPath: string): string | null {
  try {
    if (!existsSync(evalPath)) return null;
    return readFileSync(evalPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Find an eval by name across all levels.
 * Searches in order: outcome → user → app (most specific first).
 */
export function findEvalByName(name: string, outcomeId?: string): EvalMetadata | null {
  const allEvals = loadAllEvals();

  // Normalize for comparison
  const normalizedName = name.toLowerCase().replace(/[-_\s]+/g, ' ');

  // If outcomeId provided, check outcome evals first
  if (outcomeId) {
    const outcomeMatch = allEvals.find(
      e => e.source === 'outcome' && e.outcomeId === outcomeId &&
        (e.name.toLowerCase().replace(/[-_\s]+/g, ' ') === normalizedName ||
         e.id.toLowerCase().replace(/[-_\s]+/g, ' ') === normalizedName)
    );
    if (outcomeMatch) return outcomeMatch;
  }

  // Then user evals
  const userMatch = allEvals.find(
    e => e.source === 'user' &&
      (e.name.toLowerCase().replace(/[-_\s]+/g, ' ') === normalizedName ||
       e.id.toLowerCase().replace(/[-_\s]+/g, ' ') === normalizedName)
  );
  if (userMatch) return userMatch;

  // Then app evals
  const appMatch = allEvals.find(
    e => e.source === 'app' &&
      (e.name.toLowerCase().replace(/[-_\s]+/g, ' ') === normalizedName ||
       e.id.toLowerCase().replace(/[-_\s]+/g, ' ') === normalizedName)
  );
  if (appMatch) return appMatch;

  return null;
}

/**
 * Get evals for a specific outcome workspace.
 */
export function getOutcomeEvals(outcomeId: string): EvalMetadata[] {
  const evalsDir = join(paths.workspaces, outcomeId, 'evals');
  return scanEvalsDirectory(evalsDir, 'outcome', outcomeId);
}

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Extract metadata from a recipe markdown file.
 * Returns null if the file doesn't look like a valid recipe.
 */
function extractMetadata(
  filePath: string,
  source: EvalMetadata['source'],
  outcomeId?: string
): EvalMetadata | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const filename = basename(filePath, '.md');

    // Try to extract recipe name from heading
    const nameMatch = content.match(/^#\s+Evolve Recipe:\s*(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : filename;

    // Extract description from artifact section
    const descMatch = content.match(/[-*]\s*description\s*:\s*(.+)$/mi);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract mode
    const modeMatch = content.match(/[-*]\s*mode\s*:\s*(\w+)/mi);
    const modeStr = modeMatch ? modeMatch[1].toLowerCase() : 'unknown';
    const mode = modeStr === 'judge' ? 'judge' : modeStr === 'command' ? 'command' : 'unknown';

    // Extract direction
    const dirMatch = content.match(/[-*]\s*direction\s*:\s*(\w+)/mi);
    const direction = dirMatch && dirMatch[1].toLowerCase() === 'lower' ? 'lower' : 'higher';

    return {
      id: filename,
      name,
      source,
      outcomeId,
      path: filePath,
      description,
      mode: mode as EvalMetadata['mode'],
      direction,
    };
  } catch {
    return null;
  }
}
