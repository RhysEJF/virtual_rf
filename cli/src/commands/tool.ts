/**
 * Tool Command (singular)
 *
 * Shows the content of a specific tool by name or ID.
 * Tools can be outcome-specific or from the global resources.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import fs from 'fs';

interface ToolShowOptions {
  outcome?: string;
  json?: boolean;
  quiet?: boolean;
}

// Interface for outcome-specific items
interface OutcomeItem {
  id: string;
  outcome_id: string;
  item_type: 'skill' | 'tool' | 'file' | 'output';
  filename: string;
  file_path: string;
  target_override: string | null;
  synced_to: string | null;
  created_at: number;
  updated_at: number;
}

interface OutcomeItemsResponse {
  items: OutcomeItem[];
}

// Interface for global tools from resources API
interface GlobalToolsResponse {
  byOutcome: Record<string, Array<{
    id: string;
    name: string;
    outcomeId: string;
    outcomeName: string;
    path: string;
    syncStatus: string;
  }>>;
  total: number;
}

const command = new Command('tool')
  .description('Show tool content')
  .argument('<name-or-id>', 'Tool name or ID')
  .option('--outcome <id>', 'Outcome ID (required for outcome-specific tools)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Output path only');

export const toolCommand = command
  .action(async (nameOrId: string, options: ToolShowOptions) => {
    try {
      let toolPath: string | null = null;
      let toolName: string = nameOrId;
      let outcomeId: string | undefined = options.outcome;
      let outcomeName: string | undefined;

      // If outcome is specified, search within that outcome's tools
      if (options.outcome) {
        try {
          const response = await api.get<OutcomeItemsResponse>(
            `/outcomes/${options.outcome}/items?type=tool`
          );

          const tool = response.items.find(
            t => t.id === nameOrId ||
                 t.filename.toLowerCase() === nameOrId.toLowerCase() ||
                 t.filename.toLowerCase().includes(nameOrId.toLowerCase())
          );

          if (tool) {
            toolPath = tool.file_path;
            toolName = tool.filename;
            outcomeId = tool.outcome_id;
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            console.error(chalk.red('Error:'), `Outcome "${options.outcome}" not found`);
            process.exit(1);
          }
          throw error;
        }
      } else {
        // Search across all outcomes' tools via resources API
        try {
          const response = await api.get<GlobalToolsResponse>('/resources/tools');

          // Search through all outcomes
          for (const [outName, tools] of Object.entries(response.byOutcome)) {
            const tool = tools.find(
              t => t.id === nameOrId ||
                   t.name.toLowerCase() === nameOrId.toLowerCase() ||
                   t.name.toLowerCase().includes(nameOrId.toLowerCase())
            );

            if (tool) {
              toolPath = tool.path;
              toolName = tool.name;
              outcomeId = tool.outcomeId;
              outcomeName = outName;
              break;
            }
          }
        } catch (error) {
          // Global tools endpoint might not exist
          if (!(error instanceof ApiError && error.status === 404)) {
            throw error;
          }
        }
      }

      if (!toolPath) {
        console.error(chalk.red('Error:'), `Tool "${nameOrId}" not found`);
        if (!options.outcome) {
          console.error(chalk.gray('Hint: Use --outcome <id> to search within a specific outcome'));
        }
        process.exit(1);
      }

      // Handle quiet output (path only)
      if (options.quiet) {
        console.log(toolPath);
        return;
      }

      // Read the tool content from file
      let content: string;
      try {
        content = fs.readFileSync(toolPath, 'utf-8');
      } catch (err) {
        console.error(chalk.red('Error:'), `Could not read tool file at "${toolPath}"`);
        if (err instanceof Error) {
          console.error(chalk.gray(err.message));
        }
        process.exit(1);
      }

      // Handle JSON output
      if (options.json) {
        const output = {
          tool: {
            name: toolName,
            path: toolPath,
            outcomeId,
            outcomeName,
          },
          content,
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Print formatted output
      console.log();
      console.log(chalk.bold(`Tool: ${toolName}`));
      console.log(`Path: ${chalk.gray(toolPath)}`);
      if (outcomeId) {
        console.log(`Outcome: ${chalk.cyan(outcomeName || outcomeId)}`);
      }
      console.log();
      console.log(chalk.gray('─'.repeat(40)));
      console.log(content);
      console.log(chalk.gray('─'.repeat(40)));
      console.log();

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
  });

export default toolCommand;
