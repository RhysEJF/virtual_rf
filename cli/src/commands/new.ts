/**
 * New Command
 *
 * Creates a new outcome via the dispatch API.
 * Handles classification response types: outcome created, match_found, clarification needed.
 */

import { Command } from 'commander';
import { input, editor, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { api, ApiError, NetworkError, DispatchResponse, MatchedOutcome, IsolationMode } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

interface NewCommandOptions extends OutputOptions {
  quick?: boolean;
  skipMatching?: boolean;
  interactive?: boolean;
  isolated?: boolean;
  allowCodebase?: boolean;
}

/**
 * Display outcome creation result
 */
function displayOutcomeCreated(response: DispatchResponse): void {
  console.log();
  console.log(chalk.green('✓') + ' Outcome created successfully!');
  console.log();

  if (response.outcomeId) {
    console.log(`  ${chalk.bold('ID:')} ${chalk.cyan(response.outcomeId)}`);
  }

  if (response.response) {
    console.log();
    console.log(chalk.gray(response.response));
  }

  if (response.navigateTo) {
    console.log();
    console.log(chalk.gray(`View in browser: http://localhost:3000${response.navigateTo}`));
  }

  console.log();
}

/**
 * Display clarification questions
 */
function displayClarification(response: DispatchResponse): void {
  console.log();
  console.log(chalk.yellow('⚠') + ' More information needed:');
  console.log();

  if (response.response) {
    console.log(chalk.gray(response.response));
  }

  if (response.questions && response.questions.length > 0) {
    console.log();
    for (const question of response.questions) {
      console.log(`  ${chalk.yellow('•')} ${question}`);
    }
  }

  console.log();
  console.log(chalk.gray('Please provide more details and try again.'));
  console.log();
}

/**
 * Handle matched outcomes - let user choose to add to existing or create new
 */
async function handleMatchedOutcomes(
  matches: MatchedOutcome[],
  originalInput: string
): Promise<void> {
  console.log();
  console.log(chalk.cyan('Found related outcomes:'));
  console.log();

  // Display matches
  for (const match of matches) {
    const confidenceColor = match.confidence === 'high' ? chalk.green : chalk.yellow;
    console.log(`  ${chalk.bold(match.name)}`);
    console.log(`    ${chalk.gray('ID:')} ${match.id}`);
    console.log(`    ${chalk.gray('Match:')} ${confidenceColor(match.confidence)} - ${match.reason}`);
    if (match.brief) {
      console.log(`    ${chalk.gray('About:')} ${match.brief.substring(0, 80)}${match.brief.length > 80 ? '...' : ''}`);
    }
    console.log();
  }

  // Build choices for selection
  const choices = [
    ...matches.map(m => ({
      name: `Add to: ${m.name}`,
      value: m.id,
      description: m.reason,
    })),
    {
      name: 'Create new outcome instead',
      value: 'new',
      description: 'Ignore matches and create a fresh outcome',
    },
    {
      name: 'Cancel',
      value: 'cancel',
      description: 'Do nothing',
    },
  ];

  const choice = await select({
    message: 'What would you like to do?',
    choices,
  });

  if (choice === 'cancel') {
    console.log();
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  if (choice === 'new') {
    // Create new outcome, skipping matching
    console.log();
    console.log(chalk.gray('Creating new outcome...'));

    const response = await api.dispatch.createNew(originalInput, 'long');
    handleDispatchResponse(response, originalInput);
    return;
  }

  // User chose an existing outcome - send the message via chat/iterate
  const selectedOutcome = matches.find(m => m.id === choice);
  console.log();
  console.log(chalk.green('✓') + ` Selected: ${selectedOutcome?.name}`);
  console.log();
  console.log(chalk.gray('Adding to outcome...'));

  try {
    // Use the iterate API to process the request and create tasks
    const iterateResponse = await api.iterate.submit(choice, originalInput);

    console.log();
    if (iterateResponse.tasksCreated && iterateResponse.tasksCreated > 0) {
      console.log(chalk.green('✓') + ` Created ${iterateResponse.tasksCreated} task(s) from your request`);
      if (iterateResponse.taskIds && iterateResponse.taskIds.length > 0) {
        for (const taskId of iterateResponse.taskIds) {
          console.log(`  ${chalk.gray('•')} ${taskId}`);
        }
      }
      if (iterateResponse.workerId) {
        console.log();
        console.log(chalk.cyan('ℹ') + ` Worker started: ${iterateResponse.workerId}`);
      }
    } else {
      console.log(chalk.yellow('ℹ') + ' Request processed, but no new tasks created');
    }

    console.log();
    console.log(chalk.gray(`View outcome: flow show ${choice}`));
    console.log(chalk.gray(`Start worker: flow start ${choice}`));
    console.log();
  } catch (err) {
    console.error(chalk.red('Error adding to outcome:'), err instanceof Error ? err.message : 'Unknown error');
    console.log();
    console.log(chalk.gray(`Try manually: flow chat ${choice} "${originalInput.substring(0, 50)}..."`));
    console.log();
  }
}

/**
 * Handle dispatch response based on type
 */
async function handleDispatchResponse(response: DispatchResponse, originalInput: string): Promise<void> {
  switch (response.type) {
    case 'outcome':
    case 'deep':
    case 'research':
      displayOutcomeCreated(response);
      break;

    case 'quick':
      // Quick response - just show the response
      console.log();
      if (response.response) {
        console.log(response.response);
      } else if (response.error) {
        console.log(chalk.red('Error:'), response.error);
      }
      console.log();
      break;

    case 'match_found':
      if (response.matchedOutcomes && response.matchedOutcomes.length > 0) {
        await handleMatchedOutcomes(response.matchedOutcomes, originalInput);
      } else {
        // Shouldn't happen, but fallback
        displayClarification(response);
      }
      break;

    case 'clarification':
      displayClarification(response);
      break;

    default:
      // Unknown response type
      if (response.error) {
        console.error(chalk.red('Error:'), response.error);
      } else if (response.response) {
        console.log(response.response);
      } else {
        console.error(chalk.red('Unexpected response from server'));
      }
  }
}

const command = new Command('new')
  .description('Create a new outcome via the dispatch API')
  .argument('[description...]', 'Description of what you want to achieve')
  .option('-q, --quick', 'Request quick mode (immediate response, no outcome)')
  .option('-s, --skip-matching', 'Skip matching against existing outcomes')
  .option('-i, --interactive', 'Force interactive mode to enter description')
  .option('--isolated', 'Create outcome in isolated workspace (default)')
  .option('--allow-codebase', 'Allow outcome to modify main codebase');

addOutputFlags(command);

export const newCommand = command
  .action(async (descriptionParts: string[], options: NewCommandOptions) => {
    try {
      let description = descriptionParts.join(' ').trim();

      // Interactive mode: prompt for description if not provided
      if (!description || options.interactive) {
        console.log();
        console.log(chalk.bold.cyan('Create New Outcome'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log();

        if (!description) {
          const useEditor = await confirm({
            message: 'Use editor for multi-line description?',
            default: false,
          });

          if (useEditor) {
            description = await editor({
              message: 'Describe what you want to achieve (save and close editor when done):',
              postfix: '.md',
            });
          } else {
            description = await input({
              message: 'What would you like to achieve?',
              validate: (value) => {
                if (!value.trim()) {
                  return 'Description is required';
                }
                return true;
              },
            });
          }
        }
      }

      description = description.trim();

      if (!description) {
        console.error(chalk.red('Error:'), 'Description is required');
        process.exit(1);
      }

      // Determine isolation mode from flags
      let isolationMode: IsolationMode | undefined;
      if (options.isolated) {
        isolationMode = 'workspace';
      } else if (options.allowCodebase) {
        isolationMode = 'codebase';
      }
      // If neither flag specified, the server will use the default

      // Send to dispatch API
      if (!options.json && !options.quiet) {
        console.log();
        console.log(chalk.gray('Processing request...'));
        if (isolationMode) {
          const modeLabel = isolationMode === 'workspace' ? 'isolated workspace' : 'codebase access';
          console.log(chalk.gray(`Mode: ${modeLabel}`));
        }
      }

      const response = await api.dispatch.send(description, {
        modeHint: options.quick ? 'quick' : 'smart',
        skipMatching: options.skipMatching,
        isolationMode,
      });

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        if (handleOutput(response, options, response.outcomeId)) {
          return;
        }
      }

      // Handle the response based on type
      await handleDispatchResponse(response, description);

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('API Error:'), error.message);
        if (error.body && typeof error.body === 'object' && 'error' in error.body) {
          console.error(chalk.gray((error.body as { error: string }).error));
        }
        process.exit(1);
      }
      // Handle user cancellation (Ctrl+C during prompts)
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log();
        console.log(chalk.gray('Cancelled.'));
        process.exit(0);
      }
      throw error;
    }
  });

export default newCommand;
