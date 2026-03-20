/**
 * Integrations System
 *
 * Scans ~/flow-data/integrations/ for skill folders, each containing:
 *   skill.md          — Skill content (with optional frontmatter)
 *   permissions.json  — Required tool permissions
 *   mcp.json          — Optional MCP server config
 *   .disabled         — Marker file to skip this integration
 *
 * Supports local integrations and remote ones via git clone.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export interface Integration {
  name: string;
  displayName: string;
  description: string;
  skillContent: string;
  permissions: string[];
  mcpConfig?: Record<string, unknown>;
  disabled: boolean;
  path: string;
  isRemote: boolean;
}

interface Frontmatter {
  name?: string;
  description?: string;
  version?: string;
  [key: string]: string | undefined;
}

// ============================================================================
// Paths
// ============================================================================

const INTEGRATIONS_DIR = join(homedir(), 'flow-data', 'integrations');
const CONVERSE_WORKSPACE = join(homedir(), 'flow-data', 'converse-workspace');
const MCP_CONFIG_PATH = join(CONVERSE_WORKSPACE, '.claude', 'mcp_servers.json');

export function getIntegrationsDir(): string {
  return INTEGRATIONS_DIR;
}

// ============================================================================
// Frontmatter Parser
// ============================================================================

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
 * Scan all integrations from the integrations directory.
 */
export function scanIntegrations(): Integration[] {
  if (!existsSync(INTEGRATIONS_DIR)) return [];

  const entries = readdirSync(INTEGRATIONS_DIR, { withFileTypes: true });
  const integrations: Integration[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const intPath = join(INTEGRATIONS_DIR, entry.name);
    const skillPath = join(intPath, 'skill.md');

    // Must have a skill.md to be a valid integration
    if (!existsSync(skillPath)) continue;

    const rawSkill = readFileSync(skillPath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(rawSkill);

    // Read permissions
    let permissions: string[] = [];
    const permPath = join(intPath, 'permissions.json');
    if (existsSync(permPath)) {
      try {
        permissions = JSON.parse(readFileSync(permPath, 'utf-8'));
      } catch {
        // Invalid JSON, skip permissions
      }
    }

    // Read MCP config
    let mcpConfig: Record<string, unknown> | undefined;
    const mcpPath = join(intPath, 'mcp.json');
    if (existsSync(mcpPath)) {
      try {
        mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      } catch {
        // Invalid JSON
      }
    }

    // Check if disabled
    const disabled = existsSync(join(intPath, '.disabled'));

    // Check if remote (has .git directory)
    const isRemote = existsSync(join(intPath, '.git'));

    integrations.push({
      name: entry.name,
      displayName: frontmatter.name || entry.name,
      description: frontmatter.description || '',
      skillContent: content,
      permissions,
      mcpConfig,
      disabled,
      path: intPath,
      isRemote,
    });
  }

  return integrations;
}

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * Ensure the default flow-cli integration exists.
 * Copies from ~/flow-data/skills/flow-cli.md on first run.
 */
export function bootstrapDefaultIntegrations(): void {
  mkdirSync(INTEGRATIONS_DIR, { recursive: true });

  const flowCliDir = join(INTEGRATIONS_DIR, 'flow-cli');
  if (existsSync(flowCliDir)) return;

  mkdirSync(flowCliDir, { recursive: true });

  // Copy flow-cli skill from skills directory if available
  const existingSkill = join(homedir(), 'flow-data', 'skills', 'flow-cli.md');
  let skillContent: string;

  if (existsSync(existingSkill)) {
    const raw = readFileSync(existingSkill, 'utf-8');
    // Add frontmatter if not present
    if (raw.startsWith('---')) {
      skillContent = raw;
    } else {
      skillContent = `---\nname: Flow CLI\ndescription: Manage AI workforce through the Flow CLI\n---\n\n${raw}`;
    }
  } else {
    skillContent = `---
name: Flow CLI
description: Manage AI workforce through the Flow CLI
---

# Flow CLI Skill

Use \`flow\` commands to manage outcomes, tasks, and workers.
Run \`flow --help\` for available commands.
`;
  }

  writeFileSync(join(flowCliDir, 'skill.md'), skillContent, 'utf-8');

  // Default permissions for flow-cli
  const permissions = [
    'Bash(flow *)',
    'Bash(curl -s http://localhost*)',
    'Bash(curl http://localhost*)',
    'Bash(cat *)',
    'Bash(ls *)',
    'Bash(head *)',
    'Bash(tail *)',
    'Bash(wc *)',
    'Bash(npm run dev*)',
    'Bash(npm run build*)',
    'Read',
    'Grep',
    'Glob',
  ];

  writeFileSync(
    join(flowCliDir, 'permissions.json'),
    JSON.stringify(permissions, null, 2) + '\n',
    'utf-8'
  );
}

// ============================================================================
// Permission Merging
// ============================================================================

/**
 * Ensure all active integration permissions are in the settings file.
 * Only adds — never removes user-configured permissions.
 */
export function mergeIntegrationPermissions(integrations: Integration[]): void {
  const settingsPath = join(CONVERSE_WORKSPACE, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return;

  let settings: { permissions: { allow: string[]; deny: string[] } };
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return;
  }

  let changed = false;
  for (const integration of integrations) {
    if (integration.disabled) continue;
    for (const perm of integration.permissions) {
      if (!settings.permissions.allow.includes(perm)) {
        settings.permissions.allow.push(perm);
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  }
}

// ============================================================================
// MCP Config Merging
// ============================================================================

/**
 * Merge all integration MCP configs into the converse workspace.
 */
export function mergeMcpConfigs(integrations: Integration[]): boolean {
  const merged: Record<string, unknown> = {};
  let hasMcp = false;

  for (const integration of integrations) {
    if (integration.disabled || !integration.mcpConfig) continue;

    // Expect { mcpServers: { ... } } format
    const servers = (integration.mcpConfig as { mcpServers?: Record<string, unknown> }).mcpServers;
    if (servers) {
      Object.assign(merged, servers);
      hasMcp = true;
    }
  }

  if (hasMcp) {
    mkdirSync(join(CONVERSE_WORKSPACE, '.claude'), { recursive: true });
    writeFileSync(
      MCP_CONFIG_PATH,
      JSON.stringify({ mcpServers: merged }, null, 2) + '\n',
      'utf-8'
    );
  }

  return hasMcp;
}

// ============================================================================
// CLAUDE.md Builder
// ============================================================================

const BASE_CLAUDE_MD = `# Flow Converse Agent

You are Flow's conversational AI assistant, running inside the terminal.
You help users manage their AI workforce through natural conversation.

## Your Role
- You're a chat assistant embedded in the Flow terminal UI
- Be concise — this is a terminal chat, not a document
- Use markdown for formatting (it renders in the terminal)
- Proactively suggest next steps when appropriate

## When to Create an Outcome vs. Just Do It
- **NEVER create a Flow outcome unless the user explicitly asks** ("make this an outcome", "create an outcome for...")
- If you can answer or do something right now — just do it directly using your tools
- Use shell commands, file reading, MCP tools, or any available integration to complete tasks in the current conversation
- Only suggest an outcome if the work is clearly multi-step, needs autonomous workers, or should be tracked over time
- When in doubt, ask: "Should I just handle this now, or set it up as a Flow outcome?"

## Important
- The Flow server runs at localhost:3000 — flow CLI commands need it running
- Format output for terminal readability (keep tables narrow, use bullet points)
- When errors occur, diagnose and suggest fixes
- You have access to all integrations listed below — use them freely

## Loaded Integrations
`;

/**
 * Build the complete CLAUDE.md from base template + all active integration skills.
 */
export function buildClaudeMd(integrations: Integration[]): string {
  const active = integrations.filter(i => !i.disabled);

  let md = BASE_CLAUDE_MD;

  if (active.length === 0) {
    md += '\nNo integrations loaded.\n';
  } else {
    for (const integration of active) {
      md += `\n### ${integration.displayName}\n`;
      if (integration.description) {
        md += `> ${integration.description}\n`;
      }
      md += '\n' + integration.skillContent + '\n';
    }
  }

  return md;
}

// ============================================================================
// Integration Management
// ============================================================================

/**
 * Scaffold a new empty integration.
 */
export function scaffoldIntegration(name: string): string {
  const intPath = join(INTEGRATIONS_DIR, name);
  if (existsSync(intPath)) {
    throw new Error(`Integration "${name}" already exists`);
  }

  mkdirSync(intPath, { recursive: true });

  writeFileSync(join(intPath, 'skill.md'), `---
name: ${name}
description: TODO - describe what this integration does
---

# ${name} Skill

TODO: Document the commands and capabilities this integration provides.
`, 'utf-8');

  writeFileSync(
    join(intPath, 'permissions.json'),
    JSON.stringify([], null, 2) + '\n',
    'utf-8'
  );

  return intPath;
}

/**
 * Clone a remote integration from a git URL.
 */
export function cloneIntegration(url: string): { name: string; path: string } {
  // Extract name from URL
  const urlName = url.split('/').pop()?.replace(/\.git$/, '') || 'unknown';
  const intPath = join(INTEGRATIONS_DIR, urlName);

  if (existsSync(intPath)) {
    throw new Error(`Integration "${urlName}" already exists at ${intPath}`);
  }

  try {
    execSync(`git clone "${url}" "${intPath}"`, {
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch (err) {
    throw new Error(`Failed to clone: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  // Verify it has a skill.md
  if (!existsSync(join(intPath, 'skill.md'))) {
    // Clean up invalid integration
    execSync(`rm -rf "${intPath}"`, { stdio: 'pipe' });
    throw new Error(`Cloned repo doesn't contain a skill.md — not a valid integration`);
  }

  return { name: urlName, path: intPath };
}

/**
 * Disable an integration (creates .disabled marker).
 */
export function disableIntegration(name: string): boolean {
  const intPath = join(INTEGRATIONS_DIR, name);
  if (!existsSync(intPath)) return false;
  writeFileSync(join(intPath, '.disabled'), '', 'utf-8');
  return true;
}

/**
 * Enable an integration (removes .disabled marker).
 */
export function enableIntegration(name: string): boolean {
  const disabledPath = join(INTEGRATIONS_DIR, name, '.disabled');
  if (!existsSync(disabledPath)) return false;
  unlinkSync(disabledPath);
  return true;
}
