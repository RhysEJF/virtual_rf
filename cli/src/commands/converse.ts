/**
 * Converse Command
 *
 * Interactive REPL for natural language conversation with Digital Twin.
 * Creates a session on start and maintains context across messages.
 * Uses the /api/converse-agent endpoint with Claude as an agent with tools.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { api, ApiError, NetworkError, ConverseResponse, ConverseAgentResponse } from '../api.js';

// Get terminal width, with sensible bounds
function getTerminalWidth(): number {
  const cols = process.stdout.columns || 80;
  // Clamp between 60 and 120 to avoid mangled tables
  return Math.max(60, Math.min(cols - 2, 120));
}

// Configure marked with terminal renderer
marked.use(markedTerminal({
  // Styling options
  reflowText: true,
  width: getTerminalWidth(),
  // Table styling - use simpler ASCII for better compatibility
  tableOptions: {
    chars: {
      'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
      'right': '│', 'right-mid': '┤', 'middle': '│'
    },
    style: { head: ['bold'] }
  }
}));

/**
 * Render markdown to styled terminal output
 */
function renderMarkdown(text: string): string {
  try {
    const rendered = marked.parse(text);
    // marked.parse returns string | Promise<string>, but with our sync setup it's string
    return (typeof rendered === 'string' ? rendered : text).trim();
  } catch {
    // If rendering fails, return original text
    return text;
  }
}

// Mode flag - use the agentic endpoint by default
let useAgentMode = true;

/**
 * REPL state that tracks session info and context
 */
interface ReplState {
  sessionId: string;
  currentOutcomeId: string | null;
  messageCount: number;
}

/**
 * Format the assistant's response with appropriate styling (intent-based mode)
 */
function formatIntentResponse(response: ConverseResponse): void {
  // Show intent classification in debug-like style (subtle)
  if (response.intent) {
    const confidence = Math.round(response.intent.confidence * 100);
    console.log(chalk.gray(`[${response.intent.type} • ${confidence}% confidence]`));
  }

  // Main response message - render markdown for terminal
  console.log();
  console.log(chalk.cyan('Assistant:'));
  console.log(renderMarkdown(response.message));

  // Show actions taken if any
  if (response.actions_taken && response.actions_taken.length > 0) {
    console.log();
    console.log(chalk.gray('Actions taken:'));
    for (const action of response.actions_taken) {
      const icon = action.success ? chalk.green('✓') : chalk.red('✗');
      const target = action.target ? chalk.white(` → ${action.target}`) : '';
      console.log(`  ${icon} ${action.action}${target}`);
      if (action.result) {
        console.log(chalk.gray(`    ${action.result}`));
      }
    }
  }

  // Show follow-up questions if any
  if (response.follow_up_questions && response.follow_up_questions.length > 0) {
    console.log();
    console.log(chalk.yellow('Suggested follow-ups:'));
    for (const question of response.follow_up_questions) {
      console.log(chalk.gray(`  • ${question}`));
    }
  }

  console.log();
}

/**
 * Format the assistant's response with appropriate styling (agent mode)
 */
function formatAgentResponse(response: ConverseAgentResponse): void {
  // Main response message - render markdown for terminal
  console.log();
  console.log(chalk.cyan('Assistant:'));
  console.log(renderMarkdown(response.message));

  // Show tool call results if any
  if (response.tool_calls && response.tool_calls.length > 0) {
    console.log();
    console.log(chalk.gray('Tools used:'));
    for (const toolCall of response.tool_calls) {
      const icon = toolCall.success ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${icon} ${toolCall.name}`);
    }
  }

  console.log();
}

/**
 * Display welcome message when starting the REPL
 */
function displayWelcome(state: ReplState): void {
  console.log();
  console.log(chalk.bold.cyan('Flow Conversation Mode'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray(`Session: ${state.sessionId}`));
  console.log(chalk.gray(`Mode: ${useAgentMode ? 'Agent (tools)' : 'Intent (classification)'}`));
  if (state.currentOutcomeId) {
    console.log(chalk.gray(`Outcome: ${state.currentOutcomeId}`));
  }
  console.log();
  console.log(chalk.gray('Commands:'));
  console.log(chalk.gray('  /exit, /quit, /q    - Exit the conversation'));
  console.log(chalk.gray('  /clear [new]        - Clear screen (new = start new session)'));
  console.log(chalk.gray('  /context            - Show current session context'));
  console.log(chalk.gray('  /switch <outcome>   - Switch to a different outcome'));
  console.log(chalk.gray('  /mode               - Toggle between agent/intent mode'));
  console.log(chalk.gray('  /help               - Show available commands'));
  console.log(chalk.gray('  Ctrl+C              - Exit'));
  console.log();
  console.log(chalk.gray('Start chatting to stay in flow.'));
  console.log();
}

/**
 * Display help for all available commands
 */
function displayHelp(): void {
  console.log();
  console.log(chalk.bold('Available Commands:'));
  console.log();
  console.log(chalk.cyan('  /exit, /quit, /q'));
  console.log(chalk.gray('    Exit the conversation'));
  console.log();
  console.log(chalk.cyan('  /clear [new]'));
  console.log(chalk.gray('    Clear the screen. Add "new" to start a fresh session.'));
  console.log();
  console.log(chalk.cyan('  /context'));
  console.log(chalk.gray('    Show current session context (outcome, escalations, message count)'));
  console.log();
  console.log(chalk.cyan('  /switch <outcome-id>'));
  console.log(chalk.gray('    Switch conversation context to a different outcome'));
  console.log();
  console.log(chalk.cyan('  /help'));
  console.log(chalk.gray('    Show this help message'));
  console.log();
}

/**
 * Handle the /context command - show current session context
 */
async function handleContextCommand(state: ReplState): Promise<void> {
  console.log();
  console.log(chalk.bold('Session Context'));
  console.log(chalk.gray('─'.repeat(30)));
  console.log(`  ${chalk.cyan('Session ID:')} ${state.sessionId}`);
  console.log(`  ${chalk.cyan('Messages:')} ${state.messageCount}`);

  if (state.currentOutcomeId) {
    console.log(`  ${chalk.cyan('Outcome:')} ${state.currentOutcomeId}`);

    // Try to fetch outcome details and escalations
    try {
      const [outcomeRes, escalationsRes] = await Promise.all([
        api.outcomes.get(state.currentOutcomeId),
        api.homr.escalations(state.currentOutcomeId, { pending: true }),
      ]);

      console.log(`  ${chalk.cyan('Outcome Name:')} ${outcomeRes.outcome.name}`);
      console.log(`  ${chalk.cyan('Status:')} ${outcomeRes.outcome.status}`);

      if (escalationsRes.pendingCount > 0) {
        console.log(`  ${chalk.yellow('Pending Escalations:')} ${escalationsRes.pendingCount}`);
      } else {
        console.log(`  ${chalk.gray('Pending Escalations:')} 0`);
      }
    } catch {
      // Silently ignore errors fetching details
    }
  } else {
    console.log(`  ${chalk.gray('Outcome:')} None (global context)`);
  }
  console.log();
}

/**
 * Handle the /switch command - switch to a different outcome
 */
async function handleSwitchCommand(args: string, state: ReplState): Promise<boolean> {
  const outcomeId = args.trim();

  if (!outcomeId) {
    console.log(chalk.yellow('Usage: /switch <outcome-id>'));
    console.log(chalk.gray('Example: /switch out_abc123'));
    console.log();
    return true;
  }

  // Verify the outcome exists
  try {
    const res = await api.outcomes.get(outcomeId);
    state.currentOutcomeId = outcomeId;
    console.log();
    console.log(chalk.green('✓'), `Switched to outcome: ${chalk.bold(res.outcome.name)}`);
    console.log(chalk.gray(`  ID: ${outcomeId}`));
    console.log(chalk.gray(`  Status: ${res.outcome.status}`));
    console.log();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      console.log(chalk.red('Error:'), `Outcome not found: ${outcomeId}`);
    } else if (error instanceof NetworkError) {
      console.log(chalk.red('Error:'), 'Could not connect to API');
    } else {
      console.log(chalk.red('Error:'), 'Failed to switch outcome');
    }
    console.log();
    return true;
  }
}

/**
 * Handle the /clear command with optional new session
 */
async function handleClearCommand(
  args: string,
  state: ReplState,
  reinitSession: () => Promise<void>
): Promise<void> {
  const shouldStartNew = args.toLowerCase() === 'new';

  // Clear the screen
  process.stdout.write('\x1B[2J\x1B[0f');

  if (shouldStartNew) {
    // Create a new session
    try {
      await reinitSession();
      console.log(chalk.green('✓'), 'Started new session');
    } catch {
      console.log(chalk.yellow('Warning:'), 'Could not create new session, keeping existing');
    }
  }

  displayWelcome(state);
}

/**
 * Handle special commands that start with /
 * Returns true if the input was a command (handled), false otherwise
 */
async function handleSpecialCommand(
  input: string,
  state: ReplState,
  rl: readline.Interface,
  reinitSession: () => Promise<void>
): Promise<boolean> {
  const trimmed = input.trim();
  const lowerInput = trimmed.toLowerCase();

  // Parse command and arguments
  const spaceIndex = trimmed.indexOf(' ');
  const cmd = spaceIndex === -1 ? lowerInput : lowerInput.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  // /exit, /quit, /q - Exit the conversation
  if (cmd === '/exit' || cmd === '/quit' || cmd === '/q') {
    console.log();
    console.log(chalk.gray('Goodbye!'));
    rl.close();
    process.exit(0);
  }

  // /clear [new] - Clear screen, optionally start new session
  if (cmd === '/clear') {
    await handleClearCommand(args, state, reinitSession);
    return true;
  }

  // /context - Show current session context
  if (cmd === '/context') {
    await handleContextCommand(state);
    return true;
  }

  // /switch <outcome-id> - Switch to different outcome
  if (cmd === '/switch') {
    return await handleSwitchCommand(args, state);
  }

  // /help - Show help
  if (cmd === '/help') {
    displayHelp();
    return true;
  }

  // /session - Show session ID (kept for backwards compatibility)
  if (cmd === '/session') {
    console.log();
    console.log(chalk.gray(`Session ID: ${state.sessionId}`));
    console.log();
    return true;
  }

  // /mode - Toggle between agent and intent mode
  if (cmd === '/mode') {
    useAgentMode = !useAgentMode;
    console.log();
    console.log(chalk.green('✓'), `Switched to ${useAgentMode ? 'Agent (tools)' : 'Intent (classification)'} mode`);
    console.log();
    return true;
  }

  // Unknown command
  if (cmd.startsWith('/')) {
    console.log(chalk.yellow(`Unknown command: ${cmd}`));
    console.log(chalk.gray('Use /help to see available commands'));
    console.log();
    return true;
  }

  return false;
}

/**
 * Run the interactive REPL loop
 */
async function runRepl(): Promise<void> {
  // Initialize REPL state
  const state: ReplState = {
    sessionId: '',
    currentOutcomeId: null,
    messageCount: 0,
  };

  // Function to initialize or reinitialize a session
  async function initSession(): Promise<void> {
    if (useAgentMode) {
      const initResponse = await api.converseAgent.send('hello');
      state.sessionId = initResponse.session_id;
      state.messageCount = 1;
      if (initResponse.data && typeof initResponse.data === 'object' && 'outcome_id' in initResponse.data) {
        state.currentOutcomeId = initResponse.data.outcome_id as string | null;
      }
    } else {
      const initResponse = await api.converse.send('hello');
      state.sessionId = initResponse.session_id;
      state.messageCount = 1;
      if (initResponse.data && typeof initResponse.data === 'object' && 'outcome_id' in initResponse.data) {
        state.currentOutcomeId = initResponse.data.outcome_id as string | null;
      }
    }
  }

  // Initialize session with a greeting
  try {
    await initSession();
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      console.error(chalk.red('API Error:'), error.message);
      process.exit(1);
    }
    throw error;
  }

  // Display welcome
  displayWelcome(state);

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('You: '),
    terminal: true,
  });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    console.log();
    console.log(chalk.gray('Goodbye!'));
    rl.close();
    process.exit(0);
  });

  // Handle close event
  rl.on('close', () => {
    process.exit(0);
  });

  // Main REPL loop
  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmedInput = input.trim();

    // Skip empty input
    if (!trimmedInput) {
      rl.prompt();
      return;
    }

    // Handle special commands (async)
    if (trimmedInput.startsWith('/')) {
      const wasCommand = await handleSpecialCommand(trimmedInput, state, rl, initSession);
      if (wasCommand) {
        rl.prompt();
        return;
      }
    }

    // Send message to API
    try {
      // Show thinking indicator
      process.stdout.write(chalk.gray('Thinking...'));

      if (useAgentMode) {
        const response = await api.converseAgent.send(trimmedInput, state.sessionId);

        // Clear thinking indicator
        process.stdout.write('\r' + ' '.repeat(20) + '\r');

        // Update state from response
        if (response.session_id) {
          state.sessionId = response.session_id;
        }
        state.messageCount++;

        // Extract outcome ID if present in response data
        if (response.data && typeof response.data === 'object' && 'outcome_id' in response.data) {
          state.currentOutcomeId = response.data.outcome_id as string | null;
        }

        // Format and display response
        formatAgentResponse(response);
      } else {
        const response = await api.converse.send(trimmedInput, state.sessionId);

        // Clear thinking indicator
        process.stdout.write('\r' + ' '.repeat(20) + '\r');

        // Update state from response
        if (response.session_id) {
          state.sessionId = response.session_id;
        }
        state.messageCount++;

        // Extract outcome ID if present in response data
        if (response.data && typeof response.data === 'object' && 'outcome_id' in response.data) {
          state.currentOutcomeId = response.data.outcome_id as string | null;
        }

        // Format and display response
        formatIntentResponse(response);
      }

    } catch (error) {
      // Clear thinking indicator
      process.stdout.write('\r' + ' '.repeat(20) + '\r');

      if (error instanceof NetworkError) {
        console.log(chalk.red('Error:'), 'Lost connection to API');
        console.log(chalk.gray('The server may have stopped. Use /exit to quit.'));
        console.log();
      } else if (error instanceof ApiError) {
        console.log(chalk.red('Error:'), error.message);
        console.log();
      } else {
        console.log(chalk.red('Error:'), 'Something went wrong');
        console.log();
      }
    }

    rl.prompt();
  });
}

export const converseCommand = new Command('converse')
  .alias('talk')
  .description('Start an interactive conversation with Digital Twin')
  .option('--session <id>', 'Resume an existing session by ID')
  .option('--intent', 'Use intent-classification mode instead of agent mode')
  .action(async (options: { session?: string; intent?: boolean }) => {
    // If session ID provided, we could resume it
    // For now, just start fresh (session resume can be added later)
    if (options.session) {
      console.log(chalk.gray(`Note: Session resume not yet implemented. Starting new session.`));
    }

    // Set mode based on flag
    if (options.intent) {
      useAgentMode = false;
    }

    await runRepl();
  });

export default converseCommand;
