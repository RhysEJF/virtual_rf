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

export interface IntegrationCommand {
  /** Command name without extension (e.g., 'plan', 'work') */
  name: string;
  /** Full path to the source .md file */
  sourcePath: string;
  /** Which integration provides this command */
  integrationName: string;
}

export interface Integration {
  name: string;
  displayName: string;
  description: string;
  skillContent: string;
  permissions: string[];
  mcpConfig?: Record<string, unknown>;
  /** Slash commands this integration provides */
  commands: IntegrationCommand[];
  disabled: boolean;
  path: string;
  isRemote: boolean;
}

interface Frontmatter {
  name?: string;
  description?: string;
  version?: string;
  /** Path to directory containing .claude/commands/ or commands/ */
  commands_source?: string;
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

    // Discover commands
    const commands = discoverCommands(entry.name, intPath, frontmatter);

    integrations.push({
      name: entry.name,
      displayName: frontmatter.name || entry.name,
      description: frontmatter.description || '',
      skillContent: content,
      permissions,
      mcpConfig,
      commands,
      disabled,
      path: intPath,
      isRemote,
    });
  }

  return integrations;
}

// ============================================================================
// Command Discovery
// ============================================================================

/**
 * Discover slash commands from an integration.
 *
 * Commands can come from two sources (checked in order):
 *   1. commands/ directory inside the integration folder
 *   2. commands_source frontmatter → {path}/.claude/commands/
 *
 * Each .md file in the commands directory becomes a slash command.
 */
function discoverCommands(integrationName: string, intPath: string, frontmatter: Frontmatter): IntegrationCommand[] {
  const commands: IntegrationCommand[] = [];
  const commandDirs: string[] = [];

  // Source 1: commands/ directory in the integration itself
  const localCommandsDir = join(intPath, 'commands');
  if (existsSync(localCommandsDir)) {
    commandDirs.push(localCommandsDir);
  }

  // Source 2: commands_source frontmatter (resolve ~ to homedir)
  if (frontmatter.commands_source) {
    const sourcePath = frontmatter.commands_source.replace(/^~/, homedir());
    const claudeCommandsDir = join(sourcePath, '.claude', 'commands');
    const directCommandsDir = join(sourcePath, 'commands');

    if (existsSync(claudeCommandsDir)) {
      commandDirs.push(claudeCommandsDir);
    } else if (existsSync(directCommandsDir)) {
      commandDirs.push(directCommandsDir);
    }
  }

  for (const dir of commandDirs) {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace(/\.md$/, '');
        commands.push({
          name,
          sourcePath: join(dir, file),
          integrationName,
        });
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return commands;
}

// ============================================================================
// Command Merging
// ============================================================================

interface CommandRegistry {
  /** command name → integration that owns it */
  commands: Record<string, string>;
  /** commands explicitly excluded per integration */
  excluded: Record<string, string[]>;
}

const COMMANDS_DIR = join(CONVERSE_WORKSPACE, '.claude', 'commands');
const COMMAND_REGISTRY_PATH = join(CONVERSE_WORKSPACE, '.claude', 'command_registry.json');

/**
 * Read the command registry (tracks which integration owns each command).
 */
function readCommandRegistry(): CommandRegistry {
  if (!existsSync(COMMAND_REGISTRY_PATH)) {
    return { commands: {}, excluded: {} };
  }
  try {
    return JSON.parse(readFileSync(COMMAND_REGISTRY_PATH, 'utf-8'));
  } catch {
    return { commands: {}, excluded: {} };
  }
}

function writeCommandRegistry(registry: CommandRegistry): void {
  mkdirSync(join(CONVERSE_WORKSPACE, '.claude'), { recursive: true });
  writeFileSync(COMMAND_REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

export interface CommandConflict {
  commandName: string;
  existingIntegration: string;
  newIntegration: string;
}

/**
 * Merge integration commands into the converse workspace.
 *
 * - Copies .md command files to ~/flow-data/converse-workspace/.claude/commands/
 * - Tracks ownership in command_registry.json
 * - Returns conflicts for duplicate command names
 * - Respects exclusions (per-integration commands.json)
 */
export function mergeIntegrationCommands(integrations: Integration[]): CommandConflict[] {
  mkdirSync(COMMANDS_DIR, { recursive: true });

  const registry = readCommandRegistry();
  const conflicts: CommandConflict[] = [];
  const activeCommands = new Set<string>();

  for (const integration of integrations) {
    if (integration.disabled) continue;

    // Read per-integration command config (include/exclude)
    const excludedCommands = getExcludedCommands(integration);

    // Read renames
    const renames = getCommandRenames(integration);

    for (const cmd of integration.commands) {
      // Skip excluded commands
      if (excludedCommands.has(cmd.name)) continue;

      // Apply rename if configured
      const finalName = renames.get(cmd.name) || cmd.name;

      activeCommands.add(finalName);
      const targetPath = join(COMMANDS_DIR, `${finalName}.md`);

      // Check for conflicts
      const existingOwner = registry.commands[finalName];
      if (existingOwner && existingOwner !== integration.name) {
        // Another integration already owns this command
        conflicts.push({
          commandName: finalName,
          existingIntegration: existingOwner,
          newIntegration: integration.name,
        });
        // Skip — first integration wins unless user reconfigures
        continue;
      }

      // Copy the command file
      try {
        const content = readFileSync(cmd.sourcePath, 'utf-8');
        writeFileSync(targetPath, content, 'utf-8');
        registry.commands[finalName] = integration.name;
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Clean up commands from disabled/removed integrations
  try {
    const existingFiles = readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md'));
    for (const file of existingFiles) {
      const name = file.replace(/\.md$/, '');
      if (!activeCommands.has(name)) {
        // Remove orphaned command
        try {
          unlinkSync(join(COMMANDS_DIR, file));
        } catch {
          // ignore
        }
        delete registry.commands[name];
      }
    }
  } catch {
    // Commands dir might not exist yet
  }

  writeCommandRegistry(registry);
  return conflicts;
}

/**
 * Get the set of excluded command names for an integration.
 *
 * Reads from commands.json in the integration directory:
 *   { "include": ["plan", "work"] }       → only include these
 *   { "exclude": ["daily-sync"] }          → include all except these
 */
function getExcludedCommands(integration: Integration): Set<string> {
  const configPath = join(integration.path, 'commands.json');
  if (!existsSync(configPath)) return new Set();

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const allCommandNames = integration.commands.map(c => c.name);

    if (Array.isArray(config.include)) {
      // Include mode: exclude everything NOT in the include list
      const includeSet = new Set(config.include as string[]);
      return new Set(allCommandNames.filter(n => !includeSet.has(n)));
    }

    if (Array.isArray(config.exclude)) {
      return new Set(config.exclude as string[]);
    }
  } catch {
    // Invalid JSON
  }

  return new Set();
}

/**
 * Get command renames for an integration.
 * Reads from commands.json: { "rename": { "old-name": "new-name" } }
 */
function getCommandRenames(integration: Integration): Map<string, string> {
  const configPath = join(integration.path, 'commands.json');
  if (!existsSync(configPath)) return new Map();

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.rename && typeof config.rename === 'object') {
      return new Map(Object.entries(config.rename as Record<string, string>));
    }
  } catch {
    // Invalid JSON
  }

  return new Map();
}

/**
 * Rename a command from an integration.
 * Updates commands.json in the integration directory.
 */
export function renameCommand(integrationName: string, oldName: string, newName: string): boolean {
  const intPath = join(INTEGRATIONS_DIR, integrationName);
  if (!existsSync(intPath)) return false;

  const configPath = join(intPath, 'commands.json');
  let config: { include?: string[]; exclude?: string[]; rename?: Record<string, string> } = {};

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      config = {};
    }
  }

  if (!config.rename) config.rename = {};
  config.rename[oldName] = newName;

  // Remove from exclude if it was excluded
  if (config.exclude) {
    config.exclude = config.exclude.filter(n => n !== oldName);
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return true;
}

/**
 * Remove a rename for a command (revert to original name).
 */
export function unreNameCommand(integrationName: string, commandName: string): boolean {
  const intPath = join(INTEGRATIONS_DIR, integrationName);
  const configPath = join(intPath, 'commands.json');
  if (!existsSync(configPath)) return false;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.rename && config.rename[commandName]) {
      delete config.rename[commandName];
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      return true;
    }
  } catch {
    // Invalid JSON
  }

  return false;
}

/**
 * Exclude a specific command from an integration.
 * Updates/creates commands.json in the integration directory.
 */
export function excludeCommand(integrationName: string, commandName: string): boolean {
  const intPath = join(INTEGRATIONS_DIR, integrationName);
  if (!existsSync(intPath)) return false;

  const configPath = join(intPath, 'commands.json');
  let config: { include?: string[]; exclude?: string[] } = {};

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      config = {};
    }
  }

  if (!config.exclude) config.exclude = [];
  if (!config.exclude.includes(commandName)) {
    config.exclude.push(commandName);
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return true;
}

/**
 * Include a previously excluded command.
 */
export function includeCommand(integrationName: string, commandName: string): boolean {
  const intPath = join(INTEGRATIONS_DIR, integrationName);
  const configPath = join(intPath, 'commands.json');
  if (!existsSync(configPath)) return false;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (Array.isArray(config.exclude)) {
      config.exclude = config.exclude.filter((n: string) => n !== commandName);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      return true;
    }
  } catch {
    // Invalid JSON
  }

  return false;
}

/**
 * Get a summary of all commands and their owners.
 */
export function getCommandRegistry(): Record<string, string> {
  const registry = readCommandRegistry();
  return registry.commands;
}

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * Ensure default integrations exist.
 * Only creates each integration on first run — never overwrites.
 */
export function bootstrapDefaultIntegrations(): void {
  mkdirSync(INTEGRATIONS_DIR, { recursive: true });

  bootstrapFlowCli();
}

function bootstrapFlowCli(): void {
  const flowCliDir = join(INTEGRATIONS_DIR, 'flow-cli');
  if (existsSync(flowCliDir)) return;

  mkdirSync(flowCliDir, { recursive: true });

  // Copy flow-cli skill from skills directory if available
  const existingSkill = join(homedir(), 'flow-data', 'skills', 'flow-cli.md');
  let skillContent: string;

  if (existsSync(existingSkill)) {
    const raw = readFileSync(existingSkill, 'utf-8');
    if (raw.startsWith('---')) {
      skillContent = raw;
    } else {
      skillContent = `---\nname: Flow CLI\ndescription: Manage AI workforce through the Flow CLI\nworker_access: always\n---\n\n${raw}`;
    }
  } else {
    skillContent = `---
name: Flow CLI
description: Manage AI workforce through the Flow CLI
worker_access: always
---

# Flow CLI Skill

Use \`flow\` commands to manage outcomes, tasks, and workers.
Run \`flow --help\` for available commands.
`;
  }

  writeFileSync(join(flowCliDir, 'skill.md'), skillContent, 'utf-8');

  writeFileSync(
    join(flowCliDir, 'permissions.json'),
    JSON.stringify([
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
    ], null, 2) + '\n',
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

## Integrations

To create integrations, use the CLI command (not from inside this chat):
\`\`\`
flow integrate <name> --analyze <url-or-path>
\`\`\`

When asked to audit or evaluate a repo for potential integration:
1. Fetch/read the repo's README and docs
2. Identify CLI commands, APIs, and integration surface
3. Recommend approach (CLI skill vs MCP vs hybrid)
4. Assess complexity and produce a structured report
5. Suggest: \`flow integrate <name> --analyze <url>\` for the user to run

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
# commands_source: ~/path/to/source  (optional — syncs .claude/commands/ from this path)
---

# ${name} Skill

TODO: Document the commands and capabilities this integration provides.

## Bringing Your Own Commands

Place .md command files in the \`commands/\` directory of this integration,
or set \`commands_source\` in frontmatter to point to a directory with \`.claude/commands/\`.

To control which commands are synced, create a \`commands.json\`:
\`\`\`json
{ "include": ["cmd1", "cmd2"] }     // only these
{ "exclude": ["cmd3"] }             // all except these
\`\`\`
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
