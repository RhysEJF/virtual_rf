/**
 * Centralized Path Configuration
 *
 * Resolves all data paths for the Flow application.
 *
 * Resolution order for data directory:
 * 1. FLOW_DATA_HOME env var (if set)
 * 2. ~/flow-data/ (default)
 * 3. Falls back to process.cwd() if ~/flow-data/ doesn't exist (backwards compat)
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

function resolveDataRoot(): string {
  // 1. Environment variable override
  const envHome = process.env.FLOW_DATA_HOME;
  if (envHome) {
    return path.resolve(envHome);
  }

  // 2. Default: ~/flow-data/
  const defaultDataRoot = path.join(os.homedir(), 'flow-data');
  if (fs.existsSync(defaultDataRoot)) {
    return defaultDataRoot;
  }

  // 3. Backwards compatibility: use process.cwd() (old layout)
  return process.cwd();
}

const dataRoot = resolveDataRoot();
const appRoot = process.cwd();
const isLegacyLayout = dataRoot === appRoot;

export const paths = {
  /** Where user data lives (~/flow-data/ or process.cwd() in legacy mode) */
  dataRoot,

  /** Where the app code lives (always process.cwd()) */
  appRoot,

  /** SQLite database file */
  database: isLegacyLayout
    ? path.join(appRoot, 'data', 'twin.db')
    : path.join(dataRoot, 'data', 'twin.db'),

  /** Runtime workspaces for outcomes */
  workspaces: isLegacyLayout
    ? path.join(appRoot, 'workspaces')
    : path.join(dataRoot, 'workspaces'),

  /** User's personal global skill library */
  userSkills: isLegacyLayout
    ? path.join(appRoot, 'skills')
    : path.join(dataRoot, 'skills'),

  /** App-internal skills (ship with the app) */
  appSkills: path.join(appRoot, 'skills'),

  /** .env.local file (always in app root) */
  envFile: path.join(appRoot, '.env.local'),

  /** Whether we're running in the old single-directory layout */
  isLegacyLayout,
};
