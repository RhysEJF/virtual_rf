/**
 * Integration Grants for Workers
 *
 * Controls which integrations are available to Ralph workers on a per-outcome basis.
 * Workers only get integrations that are explicitly granted (or have worker_access: always).
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export type WorkerAccess = 'always' | 'grant' | 'never';

export interface WorkerIntegration {
  name: string;
  displayName: string;
  workerAccess: WorkerAccess;
  skillContent: string;
  permissions: string[];
}

// ============================================================================
// Paths
// ============================================================================

const INTEGRATIONS_DIR = join(homedir(), 'flow-data', 'integrations');

// ============================================================================
// Frontmatter Parser
// ============================================================================

interface Frontmatter {
  [key: string]: string | undefined;
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; content: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };

  const frontmatter: Frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, content: match[2].trim() };
}

// ============================================================================
// Scanning
// ============================================================================

/**
 * Scan all integrations and return their worker-relevant metadata.
 */
export function getWorkerIntegrations(): WorkerIntegration[] {
  if (!existsSync(INTEGRATIONS_DIR)) return [];

  const entries = readdirSync(INTEGRATIONS_DIR, { withFileTypes: true });
  const integrations: WorkerIntegration[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const intPath = join(INTEGRATIONS_DIR, entry.name);
    const skillPath = join(intPath, 'skill.md');
    const disabledPath = join(intPath, '.disabled');

    if (!existsSync(skillPath) || existsSync(disabledPath)) continue;

    const rawSkill = readFileSync(skillPath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(rawSkill);

    // Parse worker_access (default: 'grant' — must be explicitly granted)
    const workerAccess = (frontmatter.worker_access as WorkerAccess) || 'grant';

    // Read permissions
    let permissions: string[] = [];
    const permPath = join(intPath, 'permissions.json');
    if (existsSync(permPath)) {
      try {
        permissions = JSON.parse(readFileSync(permPath, 'utf-8'));
      } catch {
        // Invalid JSON
      }
    }

    integrations.push({
      name: entry.name,
      displayName: frontmatter.name || entry.name,
      workerAccess,
      skillContent: content,
      permissions,
    });
  }

  return integrations;
}

/**
 * Get the integrations that a worker should have access to,
 * given the outcome's granted_integrations list.
 */
export function getWorkerAllowedIntegrations(grantedIntegrationsJson: string): WorkerIntegration[] {
  const allIntegrations = getWorkerIntegrations();

  let granted: string[] = [];
  try {
    granted = JSON.parse(grantedIntegrationsJson || '[]');
  } catch {
    granted = [];
  }

  return allIntegrations.filter(integration => {
    // 'always' — every worker gets it
    if (integration.workerAccess === 'always') return true;
    // 'never' — workers never get it
    if (integration.workerAccess === 'never') return false;
    // 'grant' — only if explicitly granted
    return granted.includes(integration.name);
  });
}

/**
 * Build the integration skills section for a worker's CLAUDE.md.
 */
export function buildWorkerIntegrationSkills(grantedIntegrationsJson: string): string {
  const allowed = getWorkerAllowedIntegrations(grantedIntegrationsJson);

  if (allowed.length === 0) return '';

  let section = '\n## Available Integrations\n\n';
  for (const integration of allowed) {
    section += `### ${integration.displayName}\n`;
    section += integration.skillContent + '\n\n';
  }

  return section;
}

/**
 * Build a scoped permissions list for a worker based on granted integrations.
 */
export function buildWorkerPermissions(grantedIntegrationsJson: string): string[] {
  const allowed = getWorkerAllowedIntegrations(grantedIntegrationsJson);
  const permissions: string[] = [];

  for (const integration of allowed) {
    for (const perm of integration.permissions) {
      if (!permissions.includes(perm)) {
        permissions.push(perm);
      }
    }
  }

  return permissions;
}

/**
 * Write a scoped .claude/settings.json for a worker workspace.
 */
export function writeWorkerSettings(workspacePath: string, grantedIntegrationsJson: string): void {
  const permissions = buildWorkerPermissions(grantedIntegrationsJson);

  const settings = {
    permissions: {
      allow: permissions,
      deny: [
        'Bash(rm -rf /*)',
        'Bash(sudo *)',
      ],
    },
  };

  const settingsDir = join(workspacePath, '.claude');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, 'settings.json'),
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8'
  );
}
