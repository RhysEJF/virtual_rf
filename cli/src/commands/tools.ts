/**
 * Tools Command
 *
 * Lists available tools (global and outcome-specific).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

/**
 * Pads a string to a specified length
 */
function padEnd(str: string, length: number): string {
  if (str.length >= length) {
    return str.substring(0, length - 1) + '…';
  }
  return str + ' '.repeat(length - str.length);
}

interface ToolsOptions {
  outcome?: string;
  json?: boolean;
  quiet?: boolean;
}

// Interface for global tools from resources API
interface GlobalTool {
  name: string;
  path: string;
  description?: string;
}

interface GlobalToolsResponse {
  tools: GlobalTool[];
}

// Interface for outcome-specific items
interface OutcomeItem {
  id: string;
  outcome_id: string;
  type: 'skill' | 'tool' | 'output';
  name: string;
  path: string;
  save_target: string;
  sync_status: string;
  created_at: number;
  updated_at: number;
}

interface OutcomeItemsResponse {
  items: OutcomeItem[];
}

const command = new Command('tools')
  .description('List available tools')
  .option('--outcome <id>', 'Show outcome-specific tools')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Output names only');

export const toolsCommand = command
  .action(async (options: ToolsOptions) => {
    try {
      // Fetch global tools
      let globalTools: GlobalTool[] = [];
      try {
        const globalResponse = await api.get<GlobalToolsResponse>('/resources/tools');
        globalTools = globalResponse.tools || [];
      } catch (error) {
        // The endpoint might not exist yet, so we handle 404 gracefully
        if (error instanceof ApiError && error.status === 404) {
          globalTools = [];
        } else {
          throw error;
        }
      }

      // Fetch outcome-specific tools if --outcome provided
      let outcomeTools: OutcomeItem[] = [];
      if (options.outcome) {
        try {
          const outcomeResponse = await api.get<OutcomeItemsResponse>(
            `/outcomes/${options.outcome}/items?type=tool`
          );
          outcomeTools = outcomeResponse.items || [];
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            console.error(chalk.red('Error:'), `Outcome "${options.outcome}" not found`);
            process.exit(1);
          }
          throw error;
        }
      }

      // Handle JSON output
      if (options.json) {
        const output = {
          global: globalTools,
          outcome: options.outcome ? {
            id: options.outcome,
            tools: outcomeTools,
          } : undefined,
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Handle quiet output (names only)
      if (options.quiet) {
        for (const tool of globalTools) {
          console.log(tool.name);
        }
        for (const tool of outcomeTools) {
          console.log(tool.name);
        }
        return;
      }

      // Print formatted output
      console.log();

      // Global tools section
      console.log(chalk.bold(`Global Tools (${globalTools.length})`));
      if (globalTools.length === 0) {
        console.log(chalk.gray('  No global tools found'));
      } else {
        for (const tool of globalTools) {
          const name = padEnd(tool.name, 20);
          const description = tool.description || chalk.gray(tool.path);
          console.log(`  ${chalk.cyan(name)} ${description}`);
        }
      }

      // Outcome tools section (if requested)
      if (options.outcome) {
        console.log();
        console.log(chalk.bold(`Outcome Tools (${outcomeTools.length}) - ${options.outcome}`));
        if (outcomeTools.length === 0) {
          console.log(chalk.gray('  No outcome-specific tools found'));
        } else {
          for (const tool of outcomeTools) {
            const name = padEnd(tool.name, 20);
            console.log(`  ${chalk.cyan(name)} ${chalk.gray(tool.path)}`);
          }
        }
      }

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

export default toolsCommand;
