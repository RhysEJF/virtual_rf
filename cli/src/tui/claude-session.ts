/**
 * Claude Session Manager
 *
 * Spawns real Claude Code CLI processes (like the Telegram bot does).
 * Each message spawns `claude -p` with --resume for conversation continuity.
 * Streams JSON output for real-time tool call visibility.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  scanIntegrations,
  bootstrapDefaultIntegrations,
  mergeIntegrationPermissions,
  mergeMcpConfigs,
  mergeIntegrationCommands,
  buildClaudeMd,
} from './integrations.js';

// ============================================================================
// Types
// ============================================================================

export interface ActivityEvent {
  type: 'tool_start' | 'tool_end' | 'text_chunk' | 'complete' | 'error';
  toolName?: string;
  toolInput?: string;
  text?: string;
  sessionId?: string;
  error?: string;
}

export interface ToolAttempt {
  name: string;
  input?: Record<string, unknown>;
  description: string;
}

export interface ClaudeSessionOptions {
  /** Skip all permission checks (--dangerously-skip-permissions) */
  yolo?: boolean;
}

// ============================================================================
// Converse Workspace & Settings
// ============================================================================

const CONVERSE_WORKSPACE = join(homedir(), 'flow-data', 'converse-workspace');
const SETTINGS_DIR = join(CONVERSE_WORKSPACE, '.claude');
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json');

interface ConverseSettings {
  permissions: {
    allow: string[];
    deny: string[];
  };
}

const DEFAULT_SETTINGS: ConverseSettings = {
  permissions: {
    allow: [],
    deny: [
      'Bash(rm -rf /*)',
      'Bash(sudo *)',
    ],
  },
};

function ensureSettings(): void {
  if (existsSync(SETTINGS_PATH)) return;
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeSettings(DEFAULT_SETTINGS);
}

export function readSettings(): ConverseSettings {
  if (!existsSync(SETTINGS_PATH)) return DEFAULT_SETTINGS;
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as ConverseSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: ConverseSettings): void {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export function addPermission(pattern: string): boolean {
  const settings = readSettings();
  if (settings.permissions.allow.includes(pattern)) return false;
  settings.permissions.allow.push(pattern);
  settings.permissions.deny = settings.permissions.deny.filter(p => p !== pattern);
  writeSettings(settings);
  return true;
}

export function denyPermission(pattern: string): boolean {
  const settings = readSettings();
  const wasAllowed = settings.permissions.allow.includes(pattern);
  settings.permissions.allow = settings.permissions.allow.filter(p => p !== pattern);
  if (!settings.permissions.deny.includes(pattern)) {
    settings.permissions.deny.push(pattern);
  }
  writeSettings(settings);
  return wasAllowed;
}

export function getSettingsPath(): string {
  return SETTINGS_PATH.replace(homedir(), '~');
}

// ============================================================================
// Permission Detection
// ============================================================================

const PERMISSION_KEYWORDS = [
  'permission', 'approval', 'approve', 'not allowed',
  'blocked', 'denied', 'needs your', 'authorize',
];

export function generatePermissionPattern(toolName: string, input?: Record<string, unknown>): string {
  if (toolName !== 'Bash' || !input?.command) return toolName;
  const cmd = String(input.command).trim();
  const parts = cmd.split(/\s+/);
  if (parts.length === 0) return 'Bash';
  return `Bash(${parts[0]} *)`;
}

export function detectPermissionFailure(responseText: string): boolean {
  const lower = responseText.toLowerCase();
  return PERMISSION_KEYWORDS.some(keyword => lower.includes(keyword));
}

// ============================================================================
// Workspace Setup
// ============================================================================

function ensureWorkspace(): { workspacePath: string } {
  // Create workspace
  mkdirSync(CONVERSE_WORKSPACE, { recursive: true });

  // Create default settings (first run only)
  ensureSettings();

  // Bootstrap default integrations (first run only)
  bootstrapDefaultIntegrations();

  // Scan all integrations
  const integrations = scanIntegrations();

  // Merge permissions from active integrations into settings
  mergeIntegrationPermissions(integrations);

  // Merge MCP configs (writes to .claude/mcp_servers.json if any exist)
  mergeMcpConfigs(integrations);

  // Merge slash commands from integrations (copies .md files to .claude/commands/)
  mergeIntegrationCommands(integrations);

  // Build and write CLAUDE.md from all active integration skills
  const claudeMd = buildClaudeMd(integrations);
  writeFileSync(join(CONVERSE_WORKSPACE, 'CLAUDE.md'), claudeMd, 'utf-8');

  return { workspacePath: CONVERSE_WORKSPACE };
}

// ============================================================================
// Stream JSON Parser
// ============================================================================

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: string | Array<{ type: string; text?: string }>;
}

interface StreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: ContentBlock[];
    stop_reason?: string;
  };
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  cost_usd?: number;
  num_turns?: number;
}

function extractToolDescription(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;

  if (name === 'Bash' && input.command) {
    const cmd = String(input.command);
    return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
  }
  if (name === 'Read' && input.file_path) {
    return String(input.file_path).replace(homedir(), '~');
  }
  if (name === 'Grep' && input.pattern) {
    return `"${input.pattern}"${input.path ? ' in ' + String(input.path).replace(homedir(), '~') : ''}`;
  }
  if (name === 'Glob' && input.pattern) {
    return String(input.pattern);
  }
  if (name === 'Write' && input.file_path) {
    return String(input.file_path).replace(homedir(), '~');
  }
  if (name === 'Edit' && input.file_path) {
    return String(input.file_path).replace(homedir(), '~');
  }
  if (input.description) {
    return String(input.description);
  }

  return name;
}

// ============================================================================
// Claude Session
// ============================================================================

export class ClaudeSession extends EventEmitter {
  private sessionId: string | null = null;
  private workspacePath: string;
  private isRunning = false;
  private yolo: boolean;
  private currentToolAttempts: ToolAttempt[] = [];

  constructor(options: ClaudeSessionOptions = {}) {
    super();
    this.yolo = options.yolo ?? false;
    const ws = ensureWorkspace();
    this.workspacePath = ws.workspacePath;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getLastToolAttempts(): ToolAttempt[] {
    return [...this.currentToolAttempts];
  }

  /** Re-scan integrations and rebuild workspace (after adding/removing integrations) */
  refreshIntegrations(): void {
    ensureWorkspace();
  }

  async sendMessage(message: string): Promise<string> {
    if (this.isRunning) {
      throw new Error('A message is already being processed');
    }

    this.isRunning = true;
    this.currentToolAttempts = [];

    return new Promise<string>((resolve, reject) => {
      const args = [
        '-p', message,
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', '25',
      ];

      if (this.yolo) {
        args.push('--dangerously-skip-permissions');
      }

      if (this.sessionId) {
        args.push('--resume', this.sessionId);
      }

      const env = { ...process.env };
      delete env.CLAUDECODE;

      const proc = spawn('claude', args, {
        cwd: this.workspacePath,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let buffer = '';
      let finalResult = '';
      let lastTextContent = '';

      proc.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg: StreamMessage = JSON.parse(trimmed);
            this.processStreamMessage(msg);

            if (msg.session_id) this.sessionId = msg.session_id;

            if (msg.type === 'result') {
              finalResult = msg.result || lastTextContent;
              if (msg.session_id) this.sessionId = msg.session_id;
            }

            if (msg.type === 'assistant' && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === 'text' && block.text) {
                  lastTextContent = block.text;
                }
              }
            }
          } catch {
            // Non-JSON line
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          this.emit('activity', {
            type: 'text_chunk',
            text: text.slice(0, 100),
          } satisfies ActivityEvent);
        }
      });

      proc.on('error', (err) => {
        this.isRunning = false;
        const errorMsg = err.message.includes('ENOENT')
          ? 'Claude CLI not found. Make sure `claude` is installed and in your PATH.'
          : `Failed to spawn Claude: ${err.message}`;
        this.emit('activity', { type: 'error', error: errorMsg } satisfies ActivityEvent);
        reject(new Error(errorMsg));
      });

      proc.on('close', (code) => {
        this.isRunning = false;

        if (buffer.trim()) {
          try {
            const msg: StreamMessage = JSON.parse(buffer.trim());
            if (msg.type === 'result') {
              finalResult = msg.result || lastTextContent;
              if (msg.session_id) this.sessionId = msg.session_id;
            }
          } catch {
            // Not valid JSON
          }
        }

        const response = finalResult || lastTextContent;

        if (code !== 0 && !response) {
          const errorMsg = `Claude exited with code ${code}`;
          this.emit('activity', { type: 'error', error: errorMsg } satisfies ActivityEvent);
          reject(new Error(errorMsg));
          return;
        }

        this.emit('activity', {
          type: 'complete',
          sessionId: this.sessionId || undefined,
        } satisfies ActivityEvent);

        resolve(response);
      });

      proc.stdin.end();
    });
  }

  private processStreamMessage(msg: StreamMessage): void {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          const desc = extractToolDescription(block.name || 'unknown', block.input);
          this.currentToolAttempts.push({
            name: block.name || 'unknown',
            input: block.input,
            description: desc,
          });
          this.emit('activity', {
            type: 'tool_start',
            toolName: block.name,
            toolInput: desc,
          } satisfies ActivityEvent);
        }
        if (block.type === 'text' && block.text) {
          this.emit('activity', {
            type: 'text_chunk',
            text: block.text.slice(0, 80),
          } satisfies ActivityEvent);
        }
      }
    }

    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result') {
          this.emit('activity', {
            type: 'tool_end',
            toolName: block.name,
          } satisfies ActivityEvent);
        }
      }
    }
  }

  reset(): void {
    this.sessionId = null;
    this.currentToolAttempts = [];
    this.refreshIntegrations();
  }
}
