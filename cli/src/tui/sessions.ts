/**
 * Session Persistence & Claude Code Session Browser
 *
 * - Persists TUI conversations to flat JSON files in ~/flow-data/converse-workspace/.sessions/
 * - Reads Claude Code JSONL session files from ~/.claude/projects/ for browsing
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface SessionRecord {
  id: string;
  startedAt: string;
  messages: SessionMessage[];
}

export interface SessionSummary {
  id: string;
  filePath: string;
  timestamp: Date;
  firstMessage: string;
  messageCount: number;
  source: 'flow' | 'claude-code';
}

// ============================================================================
// Paths
// ============================================================================

const SESSIONS_DIR = join(homedir(), 'flow-data', 'converse-workspace', '.sessions');
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// ============================================================================
// Flow TUI Session Persistence
// ============================================================================

function ensureSessionsDir(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Create a new session file and return the record.
 */
export function createSession(sessionId: string): SessionRecord {
  ensureSessionsDir();
  const record: SessionRecord = {
    id: sessionId,
    startedAt: new Date().toISOString(),
    messages: [],
  };
  writeSessionRecord(record);
  return record;
}

/**
 * Append a message to an existing session file.
 */
export function appendSessionMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): void {
  ensureSessionsDir();
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);

  let record: SessionRecord;
  if (existsSync(filePath)) {
    try {
      record = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      record = { id: sessionId, startedAt: new Date().toISOString(), messages: [] };
    }
  } else {
    record = { id: sessionId, startedAt: new Date().toISOString(), messages: [] };
  }

  record.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });

  writeSessionRecord(record);
}

function writeSessionRecord(record: SessionRecord): void {
  const filePath = join(SESSIONS_DIR, `${record.id}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf-8');
}

/**
 * List recent Flow TUI sessions, sorted by most recent first.
 */
export function listFlowSessions(limit = 20): SessionSummary[] {
  ensureSessionsDir();

  if (!existsSync(SESSIONS_DIR)) return [];

  const files = readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const filePath = join(SESSIONS_DIR, f);
      const stat = statSync(filePath);
      return { name: f, filePath, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, limit);

  const summaries: SessionSummary[] = [];

  for (const file of files) {
    try {
      const record: SessionRecord = JSON.parse(readFileSync(file.filePath, 'utf-8'));
      const firstUser = record.messages.find(m => m.role === 'user');
      summaries.push({
        id: record.id,
        filePath: file.filePath,
        timestamp: new Date(record.startedAt),
        firstMessage: firstUser
          ? (firstUser.content.length > 80 ? firstUser.content.slice(0, 77) + '...' : firstUser.content)
          : '(empty session)',
        messageCount: record.messages.filter(m => m.role !== 'system').length,
        source: 'flow',
      });
    } catch {
      // Skip corrupt files
    }
  }

  return summaries;
}

/**
 * Load a full Flow TUI session.
 */
export function loadFlowSession(sessionId: string): SessionRecord | null {
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ============================================================================
// Claude Code JSONL Session Browser
// ============================================================================

interface ClaudeJsonlLine {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string }> | string;
  };
  session_id?: string;
  timestamp?: string;
}

/**
 * List recent Claude Code sessions across all projects.
 * Only reads first line of each file for speed.
 */
export function listClaudeCodeSessions(limit = 20): SessionSummary[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];

  const allFiles: Array<{ filePath: string; mtime: Date }> = [];

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = join(CLAUDE_PROJECTS_DIR, dir.name);

      try {
        const files = readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
          const filePath = join(projectPath, f);
          try {
            const stat = statSync(filePath);
            allFiles.push({ filePath, mtime: stat.mtime });
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }
  } catch {
    return [];
  }

  // Sort by most recent, take top N
  allFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const topFiles = allFiles.slice(0, limit);

  const summaries: SessionSummary[] = [];

  for (const file of topFiles) {
    try {
      const firstMessage = readFirstUserMessage(file.filePath);
      const sessionId = basename(file.filePath, '.jsonl');
      summaries.push({
        id: sessionId,
        filePath: file.filePath,
        timestamp: file.mtime,
        firstMessage: firstMessage.length > 80 ? firstMessage.slice(0, 77) + '...' : firstMessage,
        messageCount: 0, // Would need full parse to count
        source: 'claude-code',
      });
    } catch {
      // Skip corrupt files
    }
  }

  return summaries;
}

/**
 * Read the first user message from a JSONL file (fast — reads only until found).
 */
function readFirstUserMessage(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: ClaudeJsonlLine = JSON.parse(trimmed);
        if (parsed.type === 'human' || (parsed.message?.role === 'user')) {
          const msg = parsed.message;
          if (!msg) continue;
          if (typeof msg.content === 'string') return msg.content;
          if (Array.isArray(msg.content)) {
            const textBlock = msg.content.find(b => b.type === 'text' && b.text);
            if (textBlock?.text) return textBlock.text;
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  } catch {
    // File read error
  }
  return '(no content)';
}

/**
 * Read a full Claude Code JSONL session, extracting just user/assistant text messages.
 */
export function readClaudeCodeSession(filePath: string): SessionMessage[] {
  if (!existsSync(filePath)) return [];

  const messages: SessionMessage[] = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed: ClaudeJsonlLine = JSON.parse(trimmed);
        const role = parsed.type === 'human' ? 'user'
          : parsed.type === 'assistant' ? 'assistant'
          : parsed.message?.role === 'user' ? 'user'
          : parsed.message?.role === 'assistant' ? 'assistant'
          : null;

        if (!role || !parsed.message) continue;

        // Extract text content
        let text = '';
        if (typeof parsed.message.content === 'string') {
          text = parsed.message.content;
        } else if (Array.isArray(parsed.message.content)) {
          const textBlocks = parsed.message.content
            .filter(b => b.type === 'text' && b.text)
            .map(b => b.text as string);
          text = textBlocks.join('\n');
        }

        if (!text) continue;

        messages.push({
          role,
          content: text,
          timestamp: parsed.timestamp || '',
        });
      } catch {
        // Skip unparseable lines
      }
    }
  } catch {
    // File read error
  }

  return messages;
}

// ============================================================================
// Git Helpers
// ============================================================================

import { execSync } from 'child_process';

export interface GitInfo {
  branch: string;
  status: string;
  log: string;
  diff?: string;
  aheadBehind?: string;
}

/**
 * Get git info for a directory.
 */
export function getGitInfo(cwd: string, options?: { includeDiff?: boolean }): GitInfo | null {
  try {
    // Check if it's a git repo
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
  } catch {
    return null;
  }

  try {
    const branch = execSync('git branch --show-current', { cwd, stdio: 'pipe' })
      .toString().trim() || 'HEAD detached';

    const status = execSync('git status --short', { cwd, stdio: 'pipe' })
      .toString().trim();

    const log = execSync('git log --oneline -15 --no-decorate', { cwd, stdio: 'pipe' })
      .toString().trim();

    let aheadBehind = '';
    try {
      const ab = execSync('git rev-list --left-right --count HEAD...@{upstream}', { cwd, stdio: 'pipe' })
        .toString().trim();
      const [ahead, behind] = ab.split('\t').map(Number);
      const parts: string[] = [];
      if (ahead > 0) parts.push(`${ahead} ahead`);
      if (behind > 0) parts.push(`${behind} behind`);
      aheadBehind = parts.join(', ');
    } catch {
      // No upstream
    }

    let diff: string | undefined;
    if (options?.includeDiff) {
      const staged = execSync('git diff --cached --stat', { cwd, stdio: 'pipe' }).toString().trim();
      const unstaged = execSync('git diff --stat', { cwd, stdio: 'pipe' }).toString().trim();
      const parts: string[] = [];
      if (staged) parts.push('Staged:\n' + staged);
      if (unstaged) parts.push('Unstaged:\n' + unstaged);
      diff = parts.join('\n\n') || undefined;
    }

    return { branch, status, log, diff, aheadBehind };
  } catch {
    return null;
  }
}

/**
 * Get a full diff (not just stat) for a directory.
 */
export function getGitDiff(cwd: string): string | null {
  try {
    const staged = execSync('git diff --cached', { cwd, stdio: 'pipe', maxBuffer: 1024 * 1024 })
      .toString().trim();
    const unstaged = execSync('git diff', { cwd, stdio: 'pipe', maxBuffer: 1024 * 1024 })
      .toString().trim();

    const parts: string[] = [];
    if (staged) parts.push('=== Staged Changes ===\n\n' + staged);
    if (unstaged) parts.push('=== Unstaged Changes ===\n\n' + unstaged);

    return parts.join('\n\n') || null;
  } catch {
    return null;
  }
}

/**
 * Get full git log with details.
 */
export function getGitLog(cwd: string, count = 20): string | null {
  try {
    return execSync(
      `git log --oneline --decorate --graph -${count}`,
      { cwd, stdio: 'pipe' }
    ).toString().trim() || null;
  } catch {
    return null;
  }
}
