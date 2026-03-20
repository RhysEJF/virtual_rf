/**
 * Flow TUI Application
 *
 * A polished terminal chat interface for Flow, inspired by opencode's layout.
 * Spawns real Claude Code CLI sessions (like the Telegram bot) for full
 * shell access with the flow-cli skill.
 */

import blessed from 'blessed';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, existsSync } from 'fs';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import {
  ClaudeSession,
  ClaudeSessionOptions,
  ActivityEvent,
  detectPermissionFailure,
  generatePermissionPattern,
  addPermission,
  denyPermission,
  readSettings,
  getSettingsPath,
} from './claude-session.js';
import {
  scanIntegrations,
  scaffoldIntegration,
  cloneIntegration,
  disableIntegration,
  enableIntegration,
  excludeCommand,
  includeCommand,
  getIntegrationsDir,
  getCommandRegistry,
} from './integrations.js';
import {
  createSession,
  appendSessionMessage,
  listFlowSessions,
  loadFlowSession,
  listClaudeCodeSessions,
  readClaudeCodeSession,
  getGitInfo,
  getGitDiff,
  getGitLog,
  SessionSummary,
} from './sessions.js';

// ============================================================================
// Types
// ============================================================================

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface TUIState {
  messageCount: number;
  isLoading: boolean;
  inputHistory: string[];
  historyIndex: number;
  activityLogVisible: boolean;
  activityEntries: string[];
  /** Pending permission prompt state */
  permissionPrompt: {
    active: boolean;
    pattern: string;
    originalMessage: string;
  } | null;
  /** Autocomplete state */
  autocompleteIndex: number;
  autocompleteMatches: string[];
}

// ============================================================================
// Slash Commands (for autocomplete)
// ============================================================================

const SLASH_COMMANDS = [
  { cmd: '/clear', desc: 'Clear the chat' },
  { cmd: '/clear new', desc: 'Clear and start new session' },
  { cmd: '/context', desc: 'Show session context' },
  { cmd: '/copy', desc: 'Copy last response to clipboard' },
  { cmd: '/git', desc: 'Git status & recent commits' },
  { cmd: '/git log', desc: 'Git commit history' },
  { cmd: '/git diff', desc: 'Show current diff' },
  { cmd: '/history', desc: 'Browse past conversations' },
  { cmd: '/sessions', desc: 'Browse Claude Code sessions' },
  { cmd: '/settings', desc: 'View permissions' },
  { cmd: '/allow', desc: 'Add a permission' },
  { cmd: '/deny', desc: 'Block a pattern' },
  { cmd: '/commands', desc: 'List integration commands' },
  { cmd: '/commands exclude', desc: 'Exclude a command' },
  { cmd: '/commands include', desc: 'Re-include a command' },
  { cmd: '/integrations', desc: 'List loaded integrations' },
  { cmd: '/integrate', desc: 'Add a new integration' },
  { cmd: '/disable', desc: 'Disable an integration' },
  { cmd: '/enable', desc: 'Re-enable an integration' },
  { cmd: '/help', desc: 'Show this help' },
  { cmd: '/exit', desc: 'Exit' },
];

// ============================================================================
// Fun verbs (Claude-style)
// ============================================================================

const FLOW_VERBS = [
  'Pondering',
  'Researching',
  'Analyzing',
  'Contemplating',
  'Investigating',
  'Exploring',
  'Synthesizing',
  'Crafting',
  'Evaluating',
  'Orchestrating',
  'Deliberating',
  'Mapping',
  'Calibrating',
  'Navigating',
  'Untangling',
  'Assembling',
  'Distilling',
  'Harmonizing',
  'Illuminating',
  'Weaving',
  'Composing',
  'Architecting',
  'Channeling',
  'Conjuring',
  'Decoding',
  'Connecting dots',
  'Brewing ideas',
];

function randomVerb(): string {
  return FLOW_VERBS[Math.floor(Math.random() * FLOW_VERBS.length)];
}

// ============================================================================
// Markdown setup
// ============================================================================

function getWidth(cols: number): number {
  return Math.max(40, Math.min(cols - 10, 120));
}

function configureMarkdown(cols: number): void {
  marked.use(markedTerminal({
    reflowText: true,
    width: getWidth(cols),
    tableOptions: {
      chars: {
        'top': '\u2500', 'top-mid': '\u252c', 'top-left': '\u250c', 'top-right': '\u2510',
        'bottom': '\u2500', 'bottom-mid': '\u2534', 'bottom-left': '\u2514', 'bottom-right': '\u2518',
        'left': '\u2502', 'left-mid': '\u251c', 'mid': '\u2500', 'mid-mid': '\u253c',
        'right': '\u2502', 'right-mid': '\u2524', 'middle': '\u2502',
      },
      style: { head: ['bold'] },
    },
  }) as Parameters<typeof marked.use>[0]);
}

function renderMarkdown(text: string): string {
  try {
    const rendered = marked.parse(text);
    return (typeof rendered === 'string' ? rendered : text).trim();
  } catch {
    return text;
  }
}

// ============================================================================
// Logo
// ============================================================================

const FLOW_LOGO = [
  '{bold}{#8fbc8f-fg}\u2726  F L O W{/}',
  '{#6b6b6b-fg}AI Workforce Manager{/}',
];

// ============================================================================
// Main TUI Class
// ============================================================================

export class FlowTUI {
  private screen!: blessed.Widgets.Screen;
  private chatLog!: blessed.Widgets.Log;
  private statusBox!: blessed.Widgets.BoxElement;
  private inputBox!: blessed.Widgets.TextareaElement;
  private footerBox!: blessed.Widgets.BoxElement;
  private messages: Message[] = [];
  private claude: ClaudeSession;
  private state: TUIState = {
    messageCount: 0,
    isLoading: false,
    inputHistory: [],
    historyIndex: -1,
    activityLogVisible: false,
    activityEntries: [],
    permissionPrompt: null,
    autocompleteIndex: -1,
    autocompleteMatches: [],
  };
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private currentVerb = '';
  private verbInterval: ReturnType<typeof setInterval> | null = null;
  /** Current session ID for persistence */
  private currentSessionId: string | null = null;
  /** Default git directory (the Flow repo) */
  private gitDir: string = join(homedir(), 'flow');

  constructor(options: ClaudeSessionOptions = {}) {
    this.claude = new ClaudeSession(options);
    this.setupClaudeListeners();
  }

  async start(): Promise<void> {
    this.createScreen();
    this.createLayout();
    this.setupKeybindings();

    configureMarkdown(this.screen.width as number);

    // Show welcome
    this.showWelcome();

    // Focus input and render
    this.inputBox.focus();
    this.screen.render();
  }

  // --------------------------------------------------------------------------
  // Claude Event Listeners
  // --------------------------------------------------------------------------

  private setupClaudeListeners(): void {
    this.claude.on('activity', (event: ActivityEvent) => {
      switch (event.type) {
        case 'tool_start':
          this.addActivityEntry(
            `{#8fbc8f-fg}\u2503{/} {#6b6b6b-fg}${event.toolName}{/} {#404040-fg}\u203a{/} ${event.toolInput || ''}`
          );
          break;
        case 'tool_end':
          break;
        case 'text_chunk':
          break;
        case 'error':
          this.addActivityEntry(`{red-fg}\u2503 ${event.error}{/}`);
          break;
        case 'complete':
          break;
      }
    });
  }

  // --------------------------------------------------------------------------
  // Screen & Layout
  // --------------------------------------------------------------------------

  private createScreen(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Flow',
      fullUnicode: true,
      cursor: {
        artificial: true,
        shape: 'line',
        blink: true,
        color: '#8fbc8f',
      },
    });
  }

  private createLayout(): void {
    // Header
    blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 4,
      tags: true,
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      style: {
        fg: 'white',
        border: { fg: '#2a2a2a' },
      },
      border: { type: 'line' },
      content: `\n ${FLOW_LOGO[0]}  ${FLOW_LOGO[1]}`,
    });

    // Chat area
    this.chatLog = blessed.log({
      parent: this.screen,
      top: 4,
      left: 0,
      width: '100%',
      bottom: 7,
      tags: true,
      padding: { left: 2, right: 2, top: 1, bottom: 0 },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        style: { bg: '#2a2a2a' },
        track: { bg: undefined },
      },
      mouse: true,
      keys: true,
      vi: true,
      style: {
        fg: '#e0e0e0',
        border: { fg: '#2a2a2a' },
        scrollbar: { bg: '#2a2a2a' },
      },
      border: { type: 'line' },
    });

    // Status area (spinner + activity log + permission prompt)
    this.statusBox = blessed.box({
      parent: this.screen,
      bottom: 5,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      padding: { left: 3, right: 2 },
      style: {
        fg: '#6b6b6b',
      },
      content: '',
    });

    // Input area
    this.inputBox = blessed.textarea({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: '100%',
      height: 4,
      tags: false,
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      inputOnFocus: true,
      mouse: true,
      keys: true,
      style: {
        fg: '#e0e0e0',
        border: { fg: '#2a2a2a' },
        focus: {
          border: { fg: '#8fbc8f' },
        },
      },
      border: { type: 'line' },
    });

    // Footer
    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      padding: { left: 2, right: 2 },
      style: {
        fg: '#6b6b6b',
      },
      content: this.buildFooter(),
    });

    // Handle resize
    this.screen.on('resize', () => {
      configureMarkdown(this.screen.width as number);
      this.updateFooter();
      this.screen.render();
    });
  }

  // --------------------------------------------------------------------------
  // Keybindings
  // --------------------------------------------------------------------------

  private setupKeybindings(): void {
    // Quit
    this.screen.key(['C-c'], () => {
      this.cleanup();
      process.exit(0);
    });
    this.screen.key(['escape'], () => {
      // If permission prompt is active, dismiss it
      if (this.state.permissionPrompt) {
        this.dismissPermissionPrompt();
        return;
      }
      if (this.state.isLoading) return;
      this.cleanup();
      process.exit(0);
    });

    // Submit on Enter
    this.inputBox.key('enter', () => {
      if (this.state.isLoading) return;
      const value = this.inputBox.getValue().replace(/[\r\n]+$/, '').trim();
      if (!value) {
        this.inputBox.clearValue();
        this.screen.render();
        return;
      }
      this.inputBox.clearValue();
      this.screen.render();
      this.handleInput(value);
      return false;
    });

    // Tab: autocomplete slash commands OR toggle activity log
    this.screen.key(['tab'], () => {
      // If loading, toggle activity log
      if (this.state.isLoading) {
        this.toggleActivityLog();
        return;
      }

      // If input starts with /, do autocomplete
      const value = this.inputBox.getValue().replace(/[\r\n]+$/, '');
      if (value.startsWith('/')) {
        this.cycleAutocomplete(value);
        return;
      }
    });

    // Show autocomplete hints on keypress in input
    this.inputBox.on('keypress', () => {
      // Defer to next tick so getValue() reflects the latest keystroke
      setTimeout(() => {
        const value = this.inputBox.getValue().replace(/[\r\n]+$/, '');
        if (value.startsWith('/') && !this.state.isLoading) {
          this.showAutocompleteHints(value);
        } else {
          this.clearAutocompleteHints();
        }
      }, 0);
    });

    // Permission prompt keys — [a] Allow & Retry, [s] Skip
    this.screen.key(['a'], () => {
      if (!this.state.permissionPrompt?.active) return;
      this.handleAllowAndRetry();
    });
    this.screen.key(['s'], () => {
      if (!this.state.permissionPrompt?.active) return;
      this.dismissPermissionPrompt();
    });

    // Scroll chat
    this.screen.key(['pageup'], () => {
      this.chatLog.scroll(-((this.chatLog.height as number) - 2));
      this.screen.render();
    });
    this.screen.key(['pagedown'], () => {
      this.chatLog.scroll((this.chatLog.height as number) - 2);
      this.screen.render();
    });

    // Input history
    this.inputBox.key('up', () => {
      if (this.state.inputHistory.length === 0) return;
      if (this.state.historyIndex < this.state.inputHistory.length - 1) {
        this.state.historyIndex++;
        this.inputBox.setValue(this.state.inputHistory[this.state.historyIndex]);
        this.screen.render();
      }
    });
    this.inputBox.key('down', () => {
      if (this.state.historyIndex > 0) {
        this.state.historyIndex--;
        this.inputBox.setValue(this.state.inputHistory[this.state.historyIndex]);
        this.screen.render();
      } else if (this.state.historyIndex === 0) {
        this.state.historyIndex = -1;
        this.inputBox.clearValue();
        this.screen.render();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Permission Prompt
  // --------------------------------------------------------------------------

  private showPermissionPrompt(pattern: string, originalMessage: string): void {
    this.state.permissionPrompt = { active: true, pattern, originalMessage };

    // Blur input so screen-level keys (a/s/Esc) work
    this.chatLog.focus();

    // Show prompt in status area
    this.statusBox.height = 4;
    this.chatLog.bottom = 9;
    this.statusBox.setContent(
      `{#d4a574-fg}\u26a0{/} {bold}Permission needed:{/} ${blessed.escape(pattern)}\n` +
      `\n` +
      `  {#8fbc8f-fg}[a]{/} Allow & Retry  {#2a2a2a-fg}\u2502{/}  {#6b6b6b-fg}[s]{/} Skip  {#2a2a2a-fg}\u2502{/}  {#6b6b6b-fg}[Esc]{/} Dismiss`
    );
    this.screen.render();
  }

  private async handleAllowAndRetry(): Promise<void> {
    const prompt = this.state.permissionPrompt;
    if (!prompt) return;

    const { pattern, originalMessage } = prompt;

    // Add the permission permanently
    addPermission(pattern);

    // Dismiss prompt UI and refocus input
    this.state.permissionPrompt = null;
    this.statusBox.height = 2;
    this.chatLog.bottom = 7;
    this.statusBox.setContent('');
    this.inputBox.focus();

    // Remove the failed exchange from messages and re-render
    // Pop assistant response, then user message
    if (this.messages.length >= 2) {
      this.messages.pop(); // assistant
      this.messages.pop(); // user
    } else if (this.messages.length >= 1) {
      this.messages.pop();
    }

    // Re-render chat from scratch
    this.reRenderChat();

    // Show a brief confirmation
    this.showSystemMessage(`{#8fbc8f-fg}\u2713{/} Added permission: ${blessed.escape(pattern)}`);

    // Re-send the original message
    this.appendUserMessage(originalMessage);
    await this.sendMessage(originalMessage);
  }

  private dismissPermissionPrompt(): void {
    this.state.permissionPrompt = null;
    this.statusBox.height = 2;
    this.chatLog.bottom = 7;
    this.statusBox.setContent('');
    this.inputBox.focus();
    this.screen.render();
  }

  // --------------------------------------------------------------------------
  // Chat Re-render
  // --------------------------------------------------------------------------

  private reRenderChat(): void {
    this.chatLog.setContent('');
    this.showWelcome();

    // Re-render all stored messages
    for (const msg of this.messages) {
      if (msg.role === 'user') {
        this.renderUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        this.renderAssistantMessage(msg.content);
      } else {
        this.chatLog.log('');
        this.chatLog.log(`  {#6b6b6b-fg}\u25cb{/} ${blessed.escape(msg.content)}`);
      }
    }
    this.screen.render();
  }

  // --------------------------------------------------------------------------
  // Slash Command Autocomplete
  // --------------------------------------------------------------------------

  /** Get all slash commands: built-in + integration commands */
  private getAllSlashCommands(): Array<{ cmd: string; desc: string }> {
    const all = [...SLASH_COMMANDS];
    const registry = getCommandRegistry();
    for (const [name, owner] of Object.entries(registry)) {
      // Don't add if it conflicts with a built-in command
      if (!all.some(c => c.cmd === `/${name}`)) {
        all.push({ cmd: `/${name}`, desc: `${owner} command` });
      }
    }
    return all;
  }

  private cycleAutocomplete(currentInput: string): void {
    const prefix = currentInput.toLowerCase();
    const allCommands = this.getAllSlashCommands();
    const matches = allCommands.filter(c => c.cmd.startsWith(prefix));

    if (matches.length === 0) return;

    // Cycle through matches
    this.state.autocompleteIndex = (this.state.autocompleteIndex + 1) % matches.length;
    this.state.autocompleteMatches = matches.map(m => m.cmd);

    const selected = matches[this.state.autocompleteIndex];
    this.inputBox.setValue(selected.cmd);
    this.showAutocompleteHints(selected.cmd);
    this.screen.render();
  }

  private showAutocompleteHints(input: string): void {
    if (this.state.isLoading || this.state.permissionPrompt) return;

    const prefix = input.toLowerCase();
    const allCommands = this.getAllSlashCommands();
    const matches = allCommands.filter(c => c.cmd.startsWith(prefix));

    if (matches.length === 0) {
      this.clearAutocompleteHints();
      return;
    }

    const hints = matches.map(m => {
      const highlight = m.cmd === input
        ? `{#8fbc8f-fg}${m.cmd}{/}`
        : `{#6b6b6b-fg}${m.cmd}{/}`;
      return `${highlight} {#404040-fg}${m.desc}{/}`;
    }).join('  {#2a2a2a-fg}\u2502{/}  ');

    this.statusBox.setContent(hints);
    this.screen.render();
  }

  private clearAutocompleteHints(): void {
    if (!this.state.isLoading && !this.state.permissionPrompt) {
      this.state.autocompleteIndex = -1;
      this.state.autocompleteMatches = [];
      this.statusBox.setContent('');
      this.screen.render();
    }
  }

  // --------------------------------------------------------------------------
  // Activity Log Toggle
  // --------------------------------------------------------------------------

  private toggleActivityLog(): void {
    this.state.activityLogVisible = !this.state.activityLogVisible;

    if (this.state.activityLogVisible) {
      this.statusBox.height = 10;
      this.chatLog.bottom = 15;
    } else {
      this.statusBox.height = 2;
      this.chatLog.bottom = 7;
    }

    this.updateStatusArea();
    this.screen.render();
  }

  private addActivityEntry(entry: string): void {
    this.state.activityEntries.push(entry);
    if (this.state.activityEntries.length > 8) {
      this.state.activityEntries.shift();
    }
    if (this.state.isLoading) {
      this.updateStatusArea();
      this.screen.render();
    }
  }

  private updateStatusArea(): void {
    if (!this.state.isLoading) {
      this.statusBox.setContent('');
      return;
    }

    const spinner = this.spinnerFrames[this.spinnerFrame];
    const verbLine = `{#8fbc8f-fg}${spinner}{/} {#d4a574-fg}${this.currentVerb}...{/} {#6b6b6b-fg}to keep you in flow{/}`;

    if (this.state.activityLogVisible) {
      const logLines = this.state.activityEntries.slice(-7);
      const toggleHint = '{#404040-fg}  [Tab] hide activity{/}';
      const content = [verbLine, ...logLines, toggleHint].join('\n');
      this.statusBox.setContent(content);
    } else {
      const toggleHint = this.state.activityEntries.length > 0
        ? `{#404040-fg}  [Tab] view activity (${this.state.activityEntries.length}){/}`
        : '';
      this.statusBox.setContent(verbLine + '\n' + toggleHint);
    }
  }

  // --------------------------------------------------------------------------
  // Input Handling
  // --------------------------------------------------------------------------

  private async handleInput(input: string): Promise<void> {
    // Save to history
    this.state.inputHistory.unshift(input);
    if (this.state.inputHistory.length > 50) {
      this.state.inputHistory.pop();
    }
    this.state.historyIndex = -1;

    // Handle slash commands
    if (input.startsWith('/')) {
      await this.handleSlashCommand(input);
      return;
    }

    // Display user message
    this.appendUserMessage(input);

    // Send to Claude
    await this.sendMessage(input);
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case '/exit':
      case '/quit':
      case '/q':
        this.cleanup();
        process.exit(0);
        break;

      case '/clear':
        this.chatLog.setContent('');
        this.messages = [];
        if (args.toLowerCase() === 'new') {
          this.claude.reset();
          this.state.messageCount = 0;
          this.currentSessionId = null;
          this.showSystemMessage('{#8fbc8f-fg}\u2713{/} Started new session');
        }
        this.showWelcome();
        this.screen.render();
        break;

      case '/context':
        this.showContext();
        break;

      case '/settings':
        this.showSettings();
        break;

      case '/allow':
        this.handleAllowCommand(args);
        break;

      case '/deny':
        this.handleDenyCommand(args);
        break;

      case '/commands':
        this.handleCommandsCommand(args);
        break;

      case '/integrations':
        this.showIntegrations();
        break;

      case '/integrate':
        await this.handleIntegrateCommand(args);
        break;

      case '/disable':
        this.handleDisableCommand(args);
        break;

      case '/enable':
        this.handleEnableCommand(args);
        break;

      case '/copy':
        this.copyLastResponse();
        break;

      case '/git':
        this.showGitInfo(args);
        break;

      case '/history':
        this.showHistory(args);
        break;

      case '/sessions':
        this.showClaudeCodeSessions(args);
        break;

      case '/help':
        this.showHelp();
        break;

      default: {
        // Check if this is a synced integration command — inject as instructions
        const registry = getCommandRegistry();
        const cmdName = cmd.slice(1); // strip leading /
        if (registry[cmdName]) {
          await this.executeIntegrationCommand(cmdName, args, input);
        } else {
          this.showSystemMessage(`{#d4a574-fg}Unknown command: ${cmd}{/}  Type {bold}/help{/bold} for commands.`);
        }
        break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Settings Commands
  // --------------------------------------------------------------------------

  private showSettings(): void {
    const settings = readSettings();

    this.chatLog.log('');
    this.chatLog.log('  {bold}Permissions{/bold}');
    this.chatLog.log('');

    if (settings.permissions.allow.length > 0) {
      this.chatLog.log('  {#8fbc8f-fg}Allowed:{/}');
      for (const p of settings.permissions.allow) {
        this.chatLog.log(`    {#8fbc8f-fg}\u2713{/} ${blessed.escape(p)}`);
      }
    } else {
      this.chatLog.log('  {#6b6b6b-fg}No allowed permissions{/}');
    }

    this.chatLog.log('');

    if (settings.permissions.deny.length > 0) {
      this.chatLog.log('  {red-fg}Denied:{/}');
      for (const p of settings.permissions.deny) {
        this.chatLog.log(`    {red-fg}\u2717{/} ${blessed.escape(p)}`);
      }
    }

    this.chatLog.log('');
    this.chatLog.log(`  {#6b6b6b-fg}File: ${getSettingsPath()}{/}`);
    this.chatLog.log('  {#6b6b6b-fg}Use {bold}/allow "pattern"{/bold}{#6b6b6b-fg} or {bold}/deny "pattern"{/bold}{#6b6b6b-fg} to update.{/}');
    this.chatLog.log('');
    this.screen.render();
  }

  private handleAllowCommand(args: string): void {
    // Strip surrounding quotes
    const pattern = args.replace(/^["']|["']$/g, '').trim();
    if (!pattern) {
      this.showSystemMessage('{#d4a574-fg}Usage: /allow "Bash(git push *)"{/}');
      return;
    }
    const added = addPermission(pattern);
    if (added) {
      this.showSystemMessage(`{#8fbc8f-fg}\u2713{/} Added permission: ${blessed.escape(pattern)}`);
    } else {
      this.showSystemMessage(`{#6b6b6b-fg}Already allowed: ${blessed.escape(pattern)}{/}`);
    }
  }

  private handleDenyCommand(args: string): void {
    const pattern = args.replace(/^["']|["']$/g, '').trim();
    if (!pattern) {
      this.showSystemMessage('{#d4a574-fg}Usage: /deny "Bash(rm -rf *)"{/}');
      return;
    }
    denyPermission(pattern);
    this.showSystemMessage(`{red-fg}\u2717{/} Denied: ${blessed.escape(pattern)}`);
  }

  // --------------------------------------------------------------------------
  // Clipboard
  // --------------------------------------------------------------------------

  private copyLastResponse(): void {
    // Find the last assistant message
    const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) {
      this.showSystemMessage('{#6b6b6b-fg}No response to copy{/}');
      return;
    }

    try {
      // Use pbcopy on macOS, xclip on Linux
      const platform = process.platform;
      const cmd = platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard';
      execSync(cmd, { input: lastAssistant.content, stdio: ['pipe', 'pipe', 'pipe'] });
      this.showSystemMessage('{#8fbc8f-fg}\u2713{/} Copied last response to clipboard');
    } catch {
      this.showSystemMessage('{red-fg}Could not copy to clipboard{/}');
    }
  }

  // --------------------------------------------------------------------------
  // Integration Commands
  // --------------------------------------------------------------------------

  private showIntegrations(): void {
    const integrations = scanIntegrations();

    this.chatLog.log('');
    this.chatLog.log('  {bold}Integrations{/bold}');
    this.chatLog.log('');

    if (integrations.length === 0) {
      this.chatLog.log('  {#6b6b6b-fg}No integrations found.{/}');
      this.chatLog.log(`  {#6b6b6b-fg}Add integrations to: ${getIntegrationsDir().replace(process.env.HOME || '', '~')}{/}`);
    } else {
      for (const i of integrations) {
        const status = i.disabled
          ? '{#6b6b6b-fg}\u25cb disabled{/}'
          : '{#8fbc8f-fg}\u25cf active{/}';
        const remote = i.isRemote ? ' {#6b6b6b-fg}(git){/}' : '';
        const mcp = i.mcpConfig ? ' {#7aa2c9-fg}[MCP]{/}' : '';
        const perms = i.permissions.length > 0 ? ` {#6b6b6b-fg}(${i.permissions.length} perms){/}` : '';
        const cmds = i.commands.length > 0 ? ` {#d4a574-fg}(${i.commands.length} cmds){/}` : '';

        this.chatLog.log(`  ${status} {bold}${blessed.escape(i.displayName)}{/bold}${remote}${mcp}${perms}${cmds}`);
        if (i.description) {
          this.chatLog.log(`    {#6b6b6b-fg}${blessed.escape(i.description)}{/}`);
        }
        if (i.commands.length > 0) {
          const cmdNames = i.commands.map(c => `/${c.name}`).join(', ');
          this.chatLog.log(`    {#6b6b6b-fg}Commands: ${cmdNames}{/}`);
        }
      }
    }

    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Commands:{/}');
    this.chatLog.log('  {#6b6b6b-fg}  /integrate <name>         Scaffold a new integration{/}');
    this.chatLog.log('  {#6b6b6b-fg}  /integrate <git-url>      Clone a remote integration{/}');
    this.chatLog.log('  {#6b6b6b-fg}  /disable <name>           Disable an integration{/}');
    this.chatLog.log('  {#6b6b6b-fg}  /enable <name>            Re-enable an integration{/}');
    this.chatLog.log('');
    this.screen.render();
  }

  private async handleIntegrateCommand(args: string): Promise<void> {
    const input = args.replace(/^["']|["']$/g, '').trim();
    if (!input) {
      this.showSystemMessage('{#d4a574-fg}Usage: /integrate <name> or /integrate <git-url>{/}');
      return;
    }

    const isUrl = input.startsWith('http') || input.startsWith('git@');

    if (isUrl) {
      this.showSystemMessage(`{#6b6b6b-fg}Cloning ${blessed.escape(input)}...{/}`);
      try {
        const result = cloneIntegration(input);
        this.claude.refreshIntegrations();
        this.showSystemMessage(`{#8fbc8f-fg}\u2713{/} Cloned integration: {bold}${blessed.escape(result.name)}{/bold}`);
        this.showSystemMessage('{#6b6b6b-fg}Permissions and skills have been loaded.{/}');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Clone failed';
        this.showSystemMessage(`{red-fg}\u2717 ${blessed.escape(msg)}{/}`);
      }
    } else {
      try {
        scaffoldIntegration(input);
        this.showSystemMessage(`{#8fbc8f-fg}\u2713{/} Scaffolded integration: {bold}${blessed.escape(input)}{/bold}`);
        this.showSystemMessage(`{#6b6b6b-fg}Edit skill.md and permissions.json in ~/flow-data/integrations/${blessed.escape(input)}/{/}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Scaffold failed';
        this.showSystemMessage(`{red-fg}\u2717 ${blessed.escape(msg)}{/}`);
      }
    }
  }

  private handleDisableCommand(args: string): void {
    const name = args.trim();
    if (!name) {
      this.showSystemMessage('{#d4a574-fg}Usage: /disable <integration-name>{/}');
      return;
    }
    if (disableIntegration(name)) {
      this.claude.refreshIntegrations();
      this.showSystemMessage(`{#6b6b6b-fg}\u25cb{/} Disabled: ${blessed.escape(name)}`);
    } else {
      this.showSystemMessage(`{red-fg}Integration "${blessed.escape(name)}" not found{/}`);
    }
  }

  private handleEnableCommand(args: string): void {
    const name = args.trim();
    if (!name) {
      this.showSystemMessage('{#d4a574-fg}Usage: /enable <integration-name>{/}');
      return;
    }
    if (enableIntegration(name)) {
      this.claude.refreshIntegrations();
      this.showSystemMessage(`{#8fbc8f-fg}\u25cf{/} Enabled: ${blessed.escape(name)}`);
    } else {
      this.showSystemMessage(`{#6b6b6b-fg}"${blessed.escape(name)}" is already enabled or not found{/}`);
    }
  }

  // --------------------------------------------------------------------------
  // Commands Management
  // --------------------------------------------------------------------------

  private handleCommandsCommand(args: string): void {
    const parts = args.trim().split(/\s+/);
    const subCmd = parts[0]?.toLowerCase();

    if (subCmd === 'exclude') {
      this.handleExcludeCommand(parts.slice(1).join(' '));
      return;
    }
    if (subCmd === 'include') {
      this.handleIncludeCommand(parts.slice(1).join(' '));
      return;
    }

    // List all synced commands
    const registry = getCommandRegistry();
    const commandNames = Object.keys(registry).sort();

    this.chatLog.log('');
    this.chatLog.log('  {bold}Integration Commands{/bold}');
    this.chatLog.log('');

    if (commandNames.length === 0) {
      this.chatLog.log('  {#6b6b6b-fg}No commands synced from integrations.{/}');
      this.chatLog.log('  {#6b6b6b-fg}Add commands_source to an integration\'s skill.md frontmatter.{/}');
    } else {
      for (const name of commandNames) {
        const owner = registry[name];
        this.chatLog.log(
          `  {#8fbc8f-fg}/${name}{/}  {#6b6b6b-fg}from ${owner}{/}`
        );
      }
    }

    // Also show excluded commands from integrations
    const integrations = scanIntegrations();
    const excluded: Array<{ cmd: string; integration: string }> = [];
    for (const i of integrations) {
      if (i.disabled) continue;
      for (const cmd of i.commands) {
        if (!registry[cmd.name]) {
          // Command exists in integration but not in registry — might be excluded
          excluded.push({ cmd: cmd.name, integration: i.name });
        }
      }
    }

    if (excluded.length > 0) {
      this.chatLog.log('');
      this.chatLog.log('  {bold}Excluded:{/bold}');
      for (const e of excluded) {
        this.chatLog.log(
          `  {#6b6b6b-fg}/${e.cmd}{/}  {#6b6b6b-fg}from ${e.integration} (excluded){/}`
        );
      }
    }

    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Use {bold}/commands exclude <integration> <cmd>{/bold}{#6b6b6b-fg} to exclude.{/}');
    this.chatLog.log('  {#6b6b6b-fg}Use {bold}/commands include <integration> <cmd>{/bold}{#6b6b6b-fg} to re-include.{/}');
    this.chatLog.log('');
    this.screen.render();
  }

  private handleExcludeCommand(args: string): void {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      this.showSystemMessage('{#d4a574-fg}Usage: /commands exclude <integration> <command>{/}');
      return;
    }
    const [integrationName, commandName] = parts;
    if (excludeCommand(integrationName, commandName)) {
      this.claude.refreshIntegrations();
      this.showSystemMessage(`{#6b6b6b-fg}\u25cb{/} Excluded /${blessed.escape(commandName)} from ${blessed.escape(integrationName)}`);
    } else {
      this.showSystemMessage(`{red-fg}Integration "${blessed.escape(integrationName)}" not found{/}`);
    }
  }

  private handleIncludeCommand(args: string): void {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      this.showSystemMessage('{#d4a574-fg}Usage: /commands include <integration> <command>{/}');
      return;
    }
    const [integrationName, commandName] = parts;
    if (includeCommand(integrationName, commandName)) {
      this.claude.refreshIntegrations();
      this.showSystemMessage(`{#8fbc8f-fg}\u25cf{/} Re-included /${blessed.escape(commandName)} from ${blessed.escape(integrationName)}`);
    } else {
      this.showSystemMessage(`{red-fg}Not found or not excluded{/}`);
    }
  }

  // --------------------------------------------------------------------------
  // Integration Command Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a synced integration command by reading its .md file
   * and injecting the instructions into the message sent to Claude.
   */
  private async executeIntegrationCommand(cmdName: string, userArgs: string, originalInput: string): Promise<void> {
    const commandFile = join(homedir(), 'flow-data', 'converse-workspace', '.claude', 'commands', `${cmdName}.md`);

    if (!existsSync(commandFile)) {
      this.showSystemMessage(`{red-fg}Command file not found: ${cmdName}.md{/}`);
      return;
    }

    let instructions: string;
    try {
      instructions = readFileSync(commandFile, 'utf-8');
    } catch {
      this.showSystemMessage(`{red-fg}Could not read command: ${cmdName}{/}`);
      return;
    }

    // Show what the user typed
    this.appendUserMessage(originalInput);

    // Build the message: command instructions + user arguments
    const message = userArgs
      ? `Follow these instructions:\n\n${instructions}\n\n---\n\nUser request: ${userArgs}`
      : `Follow these instructions:\n\n${instructions}`;

    // Send to Claude
    await this.sendMessage(message);
  }

  // --------------------------------------------------------------------------
  // Claude Communication
  // --------------------------------------------------------------------------

  private async sendMessage(message: string): Promise<void> {
    this.state.isLoading = true;
    this.state.activityEntries = [];
    this.startSpinner();
    this.updateFooter();
    this.screen.render();

    try {
      const response = await this.claude.sendMessage(message);

      this.state.isLoading = false;
      this.stopSpinner();
      this.state.messageCount++;

      // Collapse activity log
      if (this.state.activityLogVisible) {
        this.state.activityLogVisible = false;
        this.statusBox.height = 2;
        this.chatLog.bottom = 7;
      }

      // Display response
      if (response) {
        this.appendAssistantMessage(response);

        // Check for permission failure and offer to fix it
        if (detectPermissionFailure(response)) {
          const attempts = this.claude.getLastToolAttempts();
          if (attempts.length > 0) {
            // Use the first tool attempt as the likely blocked one
            const blocked = attempts[0];
            const pattern = generatePermissionPattern(blocked.name, blocked.input);
            this.showPermissionPrompt(pattern, message);
          }
        }
      } else {
        this.showSystemMessage('{#6b6b6b-fg}No response received{/}');
      }

      this.updateFooter();
    } catch (error) {
      this.state.isLoading = false;
      this.stopSpinner();

      if (this.state.activityLogVisible) {
        this.state.activityLogVisible = false;
        this.statusBox.height = 2;
        this.chatLog.bottom = 7;
      }

      const msg = error instanceof Error ? error.message : 'Something went wrong';
      this.showSystemMessage(`{red-fg}${blessed.escape(msg)}{/}`);
      this.updateFooter();
    }

    this.inputBox.focus();
    this.screen.render();
  }

  // --------------------------------------------------------------------------
  // Message Display (store + render)
  // --------------------------------------------------------------------------

  private appendUserMessage(content: string): void {
    this.messages.push({ role: 'user', content, timestamp: new Date() });
    this.renderUserMessage(content);
    this.persistMessage('user', content);
  }

  private appendAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content, timestamp: new Date() });
    this.renderAssistantMessage(content);
    this.persistMessage('assistant', content);
  }

  private persistMessage(role: 'user' | 'assistant', content: string): void {
    // Ensure we have a session ID (use Claude's session or generate one)
    if (!this.currentSessionId) {
      const claudeId = this.claude.getSessionId();
      this.currentSessionId = claudeId || `flow_${Date.now()}`;
      createSession(this.currentSessionId);
    }
    appendSessionMessage(this.currentSessionId, role, content);
  }

  // --------------------------------------------------------------------------
  // Message Rendering (render only, no store)
  // --------------------------------------------------------------------------

  private renderUserMessage(content: string): void {
    const lines = content.split('\n');
    this.chatLog.log('');
    this.chatLog.log('{#8fbc8f-fg}\u2503{/} {bold}You{/bold}');
    for (const line of lines) {
      this.chatLog.log(`{#8fbc8f-fg}\u2503{/} ${blessed.escape(line)}`);
    }
    this.screen.render();
  }

  private renderAssistantMessage(content: string): void {
    const rendered = renderMarkdown(content);

    this.chatLog.log('');
    this.chatLog.log(`{#d4a574-fg}\u2503{/} {bold}{#d4a574-fg}Flow{/}`);

    const escaped = blessed.escape(rendered);
    const lines = escaped.split('\n');
    for (const line of lines) {
      this.chatLog.log(`{#d4a574-fg}\u2503{/}  ${line}`);
    }

    this.screen.render();
  }

  private showSystemMessage(content: string): void {
    this.chatLog.log('');
    this.chatLog.log(`  {#6b6b6b-fg}\u25cb{/} ${content}`);
    this.screen.render();
  }

  private showWelcome(): void {
    this.chatLog.log('');
    this.chatLog.log('  {bold}{#8fbc8f-fg}Welcome to Flow{/}');
    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Chat naturally to manage your AI workforce.{/}');
    this.chatLog.log('  {#6b6b6b-fg}Powered by Claude Code \u2014 full CLI access with flow-cli skill.{/}');
    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Try: "show me my outcomes" or "create a new outcome for..."{/}');
    this.chatLog.log('  {#6b6b6b-fg}Type {bold}/help{/bold}{#6b6b6b-fg} for commands, {bold}Esc{/bold}{#6b6b6b-fg} or {bold}Ctrl+C{/bold}{#6b6b6b-fg} to exit{/}');
    this.chatLog.log(`  {#2a2a2a-fg}${'─'.repeat(Math.max(20, (this.screen.width as number) - 12))}{/}`);
    this.screen.render();
  }

  private showHelp(): void {
    this.chatLog.log('');
    this.chatLog.log('  {bold}Context{/bold}');
    this.chatLog.log('');
    this.chatLog.log('  {#8fbc8f-fg}/git{/}                Git status & recent commits');
    this.chatLog.log('  {#8fbc8f-fg}/git log{/}            Full commit history');
    this.chatLog.log('  {#8fbc8f-fg}/git diff{/}           Show current diff');
    this.chatLog.log('  {#8fbc8f-fg}/history{/}            Browse past conversations');
    this.chatLog.log('  {#8fbc8f-fg}/history <n>{/}        View conversation transcript');
    this.chatLog.log('  {#8fbc8f-fg}/sessions{/}           Browse Claude Code sessions');
    this.chatLog.log('  {#8fbc8f-fg}/sessions <n>{/}       View session transcript');
    this.chatLog.log('');
    this.chatLog.log('  {bold}Session{/bold}');
    this.chatLog.log('');
    this.chatLog.log('  {#8fbc8f-fg}/clear{/}              Clear the chat');
    this.chatLog.log('  {#8fbc8f-fg}/clear new{/}          Clear and start new session');
    this.chatLog.log('  {#8fbc8f-fg}/context{/}            Show session context');
    this.chatLog.log('  {#8fbc8f-fg}/copy{/}               Copy last response to clipboard');
    this.chatLog.log('');
    this.chatLog.log('  {bold}Integrations & Commands{/bold}');
    this.chatLog.log('');
    this.chatLog.log('  {#8fbc8f-fg}/commands{/}                          List synced commands');
    this.chatLog.log('  {#8fbc8f-fg}/commands exclude <int> <cmd>{/}      Exclude a command');
    this.chatLog.log('  {#8fbc8f-fg}/commands include <int> <cmd>{/}      Re-include a command');
    this.chatLog.log('  {#8fbc8f-fg}/integrations{/}                      List loaded integrations');
    this.chatLog.log('  {#8fbc8f-fg}/integrate <name>{/}                  Add a new integration');
    this.chatLog.log('  {#8fbc8f-fg}/disable <name>{/}                    Disable an integration');
    this.chatLog.log('  {#8fbc8f-fg}/enable <name>{/}                     Re-enable an integration');
    this.chatLog.log('');
    this.chatLog.log('  {bold}Permissions{/bold}');
    this.chatLog.log('');
    this.chatLog.log('  {#8fbc8f-fg}/settings{/}           View permissions');
    this.chatLog.log('  {#8fbc8f-fg}/allow "pattern"{/}    Add a permission');
    this.chatLog.log('  {#8fbc8f-fg}/deny "pattern"{/}     Block a pattern');
    this.chatLog.log('');
    this.chatLog.log('  {#8fbc8f-fg}/help{/}               Show this help');
    this.chatLog.log('  {#8fbc8f-fg}/exit{/}               Exit');
    this.chatLog.log('');
    this.chatLog.log('  {bold}Navigation{/bold}');
    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Tab{/}              Autocomplete /commands (or toggle activity log)');
    this.chatLog.log('  {#6b6b6b-fg}PgUp/PgDn{/}        Scroll chat');
    this.chatLog.log('  {#6b6b6b-fg}Up/Down{/}          Input history');
    this.chatLog.log('  {#6b6b6b-fg}Enter{/}            Send message');
    this.chatLog.log('  {#6b6b6b-fg}Shift+Select{/}     Native text selection (copy with Cmd+C)');
    this.chatLog.log('  {#6b6b6b-fg}Esc/Ctrl+C{/}       Exit');
    this.chatLog.log('');
    this.screen.render();
  }

  private showContext(): void {
    const sessionId = this.claude.getSessionId();

    this.chatLog.log('');
    this.chatLog.log('  {bold}Session Context{/bold}');
    this.chatLog.log(`  {#6b6b6b-fg}Session:{/}   ${sessionId || 'not started'}`);
    this.chatLog.log(`  {#6b6b6b-fg}Messages:{/}  ${this.state.messageCount}`);
    this.chatLog.log(`  {#6b6b6b-fg}Engine:{/}    Claude Code CLI`);
    this.chatLog.log('');
    this.screen.render();
  }

  // --------------------------------------------------------------------------
  // Git Commands
  // --------------------------------------------------------------------------

  private showGitInfo(args: string): void {
    const subCmd = args.split(' ')[0]?.toLowerCase();

    if (subCmd === 'log') {
      this.showGitLog();
      return;
    }
    if (subCmd === 'diff') {
      this.showGitDiffView();
      return;
    }

    // Default: status + short log
    const cwd = this.resolveGitDir();
    const info = getGitInfo(cwd, { includeDiff: false });

    if (!info) {
      this.showSystemMessage(`{red-fg}Not a git repository: ${blessed.escape(cwd.replace(homedir(), '~'))}{/}`);
      return;
    }

    this.chatLog.log('');
    this.chatLog.log(`  {bold}Git Status{/bold}  {#6b6b6b-fg}${blessed.escape(cwd.replace(homedir(), '~'))}{/}`);
    this.chatLog.log('');
    this.chatLog.log(`  {#8fbc8f-fg}Branch:{/} ${blessed.escape(info.branch)}${info.aheadBehind ? `  {#6b6b6b-fg}(${info.aheadBehind}){/}` : ''}`);
    this.chatLog.log('');

    if (info.status) {
      this.chatLog.log('  {bold}Changes:{/bold}');
      for (const line of info.status.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const code = trimmed.slice(0, 2);
        const file = trimmed.slice(3);
        let color = '#e0e0e0';
        if (code.includes('M')) color = '#d4a574';
        else if (code.includes('A') || code.includes('?')) color = '#8fbc8f';
        else if (code.includes('D')) color = '#c97070';
        this.chatLog.log(`    {#6b6b6b-fg}${blessed.escape(code)}{/} {${color}-fg}${blessed.escape(file)}{/}`);
      }
    } else {
      this.chatLog.log('  {#8fbc8f-fg}Working tree clean{/}');
    }

    this.chatLog.log('');
    this.chatLog.log('  {bold}Recent Commits:{/bold}');
    if (info.log) {
      for (const line of info.log.split('\n').slice(0, 10)) {
        const [hash, ...rest] = line.split(' ');
        this.chatLog.log(`    {#6b6b6b-fg}${blessed.escape(hash)}{/} ${blessed.escape(rest.join(' '))}`);
      }
    } else {
      this.chatLog.log('    {#6b6b6b-fg}No commits{/}');
    }

    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Use {bold}/git log{/bold}{#6b6b6b-fg} for full history, {bold}/git diff{/bold}{#6b6b6b-fg} for changes{/}');
    this.chatLog.log('');
    this.screen.render();
  }

  private showGitLog(): void {
    const cwd = this.resolveGitDir();
    const log = getGitLog(cwd, 25);

    if (!log) {
      this.showSystemMessage(`{red-fg}No git log available for ${blessed.escape(cwd.replace(homedir(), '~'))}{/}`);
      return;
    }

    this.chatLog.log('');
    this.chatLog.log(`  {bold}Git Log{/bold}  {#6b6b6b-fg}${blessed.escape(cwd.replace(homedir(), '~'))}{/}`);
    this.chatLog.log('');
    for (const line of log.split('\n')) {
      this.chatLog.log(`    ${blessed.escape(line)}`);
    }
    this.chatLog.log('');
    this.screen.render();
  }

  private showGitDiffView(): void {
    const cwd = this.resolveGitDir();
    const diff = getGitDiff(cwd);

    if (!diff) {
      this.showSystemMessage('{#8fbc8f-fg}No changes to show{/}');
      return;
    }

    this.chatLog.log('');
    this.chatLog.log(`  {bold}Git Diff{/bold}  {#6b6b6b-fg}${blessed.escape(cwd.replace(homedir(), '~'))}{/}`);
    this.chatLog.log('');

    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        this.chatLog.log(`  {#8fbc8f-fg}${blessed.escape(line)}{/}`);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        this.chatLog.log(`  {#c97070-fg}${blessed.escape(line)}{/}`);
      } else if (line.startsWith('@@')) {
        this.chatLog.log(`  {#7ca8cf-fg}${blessed.escape(line)}{/}`);
      } else if (line.startsWith('===')) {
        this.chatLog.log(`  {bold}${blessed.escape(line)}{/bold}`);
      } else {
        this.chatLog.log(`  ${blessed.escape(line)}`);
      }
    }
    this.chatLog.log('');
    this.screen.render();
  }

  private resolveGitDir(): string {
    return this.gitDir;
  }

  // --------------------------------------------------------------------------
  // History & Sessions
  // --------------------------------------------------------------------------

  private showHistory(args: string): void {
    const trimmed = args.trim();

    // If a number, show that session
    if (trimmed && /^\d+$/.test(trimmed)) {
      const sessions = listFlowSessions(20);
      const idx = parseInt(trimmed, 10) - 1;
      if (idx < 0 || idx >= sessions.length) {
        this.showSystemMessage(`{red-fg}Session ${trimmed} not found. Use /history to see available sessions.{/}`);
        return;
      }
      this.showSessionTranscript(sessions[idx]);
      return;
    }

    // If a session ID, load directly
    if (trimmed && !trimmed.startsWith('-')) {
      const record = loadFlowSession(trimmed);
      if (record) {
        this.showFlowSessionTranscript(record);
        return;
      }
      this.showSystemMessage(`{red-fg}Session "${blessed.escape(trimmed)}" not found{/}`);
      return;
    }

    // List recent sessions
    const sessions = listFlowSessions(15);

    this.chatLog.log('');
    this.chatLog.log('  {bold}Recent Conversations{/bold}');
    this.chatLog.log('');

    if (sessions.length === 0) {
      this.chatLog.log('  {#6b6b6b-fg}No saved conversations yet. Your conversations are saved automatically.{/}');
    } else {
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const date = this.formatRelativeDate(s.timestamp);
        const msgs = s.messageCount > 0 ? `${s.messageCount} msgs` : '';
        this.chatLog.log(
          `  {#8fbc8f-fg}${String(i + 1).padStart(2)}{/}  {#6b6b6b-fg}${date}{/}  ${msgs ? `{#6b6b6b-fg}(${msgs}){/}  ` : ''}${blessed.escape(s.firstMessage)}`
        );
      }
    }

    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Use {bold}/history <n>{/bold}{#6b6b6b-fg} to view a conversation{/}');
    this.chatLog.log('');
    this.screen.render();
  }

  private showClaudeCodeSessions(args: string): void {
    const trimmed = args.trim();

    // If a number, view that session
    if (trimmed && /^\d+$/.test(trimmed)) {
      const sessions = listClaudeCodeSessions(20);
      const idx = parseInt(trimmed, 10) - 1;
      if (idx < 0 || idx >= sessions.length) {
        this.showSystemMessage(`{red-fg}Session ${trimmed} not found{/}`);
        return;
      }
      this.showClaudeCodeSessionTranscript(sessions[idx]);
      return;
    }

    // List Claude Code sessions
    const sessions = listClaudeCodeSessions(15);

    this.chatLog.log('');
    this.chatLog.log('  {bold}Claude Code Sessions{/bold}');
    this.chatLog.log('');

    if (sessions.length === 0) {
      this.chatLog.log('  {#6b6b6b-fg}No Claude Code sessions found at ~/.claude/projects/{/}');
    } else {
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const date = this.formatRelativeDate(s.timestamp);
        this.chatLog.log(
          `  {#d4a574-fg}${String(i + 1).padStart(2)}{/}  {#6b6b6b-fg}${date}{/}  ${blessed.escape(s.firstMessage)}`
        );
      }
    }

    this.chatLog.log('');
    this.chatLog.log('  {#6b6b6b-fg}Use {bold}/sessions <n>{/bold}{#6b6b6b-fg} to view a session transcript{/}');
    this.chatLog.log('');
    this.screen.render();
  }

  private showSessionTranscript(summary: SessionSummary): void {
    if (summary.source === 'flow') {
      const record = loadFlowSession(summary.id);
      if (!record) {
        this.showSystemMessage('{red-fg}Could not load session{/}');
        return;
      }
      this.showFlowSessionTranscript(record);
    } else {
      this.showClaudeCodeSessionTranscript(summary);
    }
  }

  private showFlowSessionTranscript(record: { id: string; startedAt: string; messages: Array<{ role: string; content: string; timestamp: string }> }): void {
    this.chatLog.log('');
    this.chatLog.log(`  {bold}Session{/bold}  {#6b6b6b-fg}${record.id}{/}`);
    this.chatLog.log(`  {#6b6b6b-fg}Started: ${new Date(record.startedAt).toLocaleString()}{/}`);
    this.chatLog.log(`  {#2a2a2a-fg}${'─'.repeat(Math.max(20, (this.screen.width as number) - 12))}{/}`);
    this.chatLog.log('');

    for (const msg of record.messages) {
      if (msg.role === 'user') {
        this.chatLog.log(`  {#8fbc8f-fg}\u2503{/} {bold}You{/bold}`);
        for (const line of msg.content.split('\n')) {
          this.chatLog.log(`  {#8fbc8f-fg}\u2503{/} ${blessed.escape(line)}`);
        }
      } else if (msg.role === 'assistant') {
        this.chatLog.log(`  {#d4a574-fg}\u2503{/} {bold}{#d4a574-fg}Flow{/}`);
        const preview = msg.content.length > 300 ? msg.content.slice(0, 297) + '...' : msg.content;
        for (const line of preview.split('\n')) {
          this.chatLog.log(`  {#d4a574-fg}\u2503{/}  ${blessed.escape(line)}`);
        }
      }
      this.chatLog.log('');
    }

    this.chatLog.log(`  {#2a2a2a-fg}${'─'.repeat(Math.max(20, (this.screen.width as number) - 12))}{/}`);
    this.chatLog.log('');
    this.screen.render();
  }

  private showClaudeCodeSessionTranscript(summary: SessionSummary): void {
    const messages = readClaudeCodeSession(summary.filePath);

    this.chatLog.log('');
    this.chatLog.log(`  {bold}Claude Code Session{/bold}  {#6b6b6b-fg}${summary.id.slice(0, 20)}...{/}`);
    this.chatLog.log(`  {#6b6b6b-fg}${summary.timestamp.toLocaleString()}{/}`);
    this.chatLog.log(`  {#2a2a2a-fg}${'─'.repeat(Math.max(20, (this.screen.width as number) - 12))}{/}`);
    this.chatLog.log('');

    if (messages.length === 0) {
      this.chatLog.log('  {#6b6b6b-fg}(no readable messages){/}');
    } else {
      for (const msg of messages) {
        if (msg.role === 'user') {
          this.chatLog.log(`  {#8fbc8f-fg}\u2503{/} {bold}You{/bold}`);
          const preview = msg.content.length > 200 ? msg.content.slice(0, 197) + '...' : msg.content;
          for (const line of preview.split('\n')) {
            this.chatLog.log(`  {#8fbc8f-fg}\u2503{/} ${blessed.escape(line)}`);
          }
        } else if (msg.role === 'assistant') {
          this.chatLog.log(`  {#7ca8cf-fg}\u2503{/} {bold}{#7ca8cf-fg}Claude{/}`);
          const preview = msg.content.length > 300 ? msg.content.slice(0, 297) + '...' : msg.content;
          for (const line of preview.split('\n')) {
            this.chatLog.log(`  {#7ca8cf-fg}\u2503{/}  ${blessed.escape(line)}`);
          }
        }
        this.chatLog.log('');
      }
    }

    this.chatLog.log(`  {#2a2a2a-fg}${'─'.repeat(Math.max(20, (this.screen.width as number) - 12))}{/}`);
    this.chatLog.log('');
    this.screen.render();
  }

  private formatRelativeDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  // --------------------------------------------------------------------------
  // Spinner with rotating verbs
  // --------------------------------------------------------------------------

  private readonly spinnerFrames = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];

  private startSpinner(): void {
    this.spinnerFrame = 0;
    this.currentVerb = randomVerb();

    this.verbInterval = setInterval(() => {
      this.currentVerb = randomVerb();
    }, 3000 + Math.random() * 2000);

    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerFrames.length;
      this.updateStatusArea();
      this.screen.render();
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (this.verbInterval) {
      clearInterval(this.verbInterval);
      this.verbInterval = null;
    }
    this.statusBox.setContent('');
    this.screen.render();
  }

  // --------------------------------------------------------------------------
  // Footer
  // --------------------------------------------------------------------------

  private buildFooter(): string {
    const sessionId = this.claude.getSessionId();
    const session = sessionId
      ? `{#6b6b6b-fg}Session: ${sessionId.slice(0, 12)}...{/}`
      : '{#6b6b6b-fg}New session{/}';

    const msgs = `{#6b6b6b-fg}${this.state.messageCount} msgs{/}`;

    const status = this.state.isLoading
      ? '{#d4a574-fg}Working...{/}'
      : '{#8fbc8f-fg}Ready{/}';

    const engine = '{#6b6b6b-fg}Claude Code CLI{/}';

    return `${session}  {#2a2a2a-fg}\u2502{/}  ${msgs}  {#2a2a2a-fg}\u2502{/}  ${status}  {#2a2a2a-fg}\u2502{/}  ${engine}`;
  }

  private updateFooter(): void {
    this.footerBox.setContent(this.buildFooter());
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  private cleanup(): void {
    this.stopSpinner();
    this.screen.destroy();
  }
}
