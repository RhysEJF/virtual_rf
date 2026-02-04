/**
 * Outputs Command
 *
 * Lists deliverable outputs (HTML, images, PDFs, etc.) for an outcome.
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

/**
 * Get file type description from filename
 */
function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const typeMap: Record<string, string> = {
    html: 'HTML document',
    htm: 'HTML document',
    css: 'Stylesheet',
    js: 'JavaScript',
    ts: 'TypeScript',
    json: 'JSON file',
    png: 'Image',
    jpg: 'Image',
    jpeg: 'Image',
    gif: 'Image',
    svg: 'SVG image',
    pdf: 'PDF document',
    md: 'Markdown',
    txt: 'Text file',
  };
  return typeMap[ext || ''] || 'File';
}

interface OutputsOptions {
  json?: boolean;
  quiet?: boolean;
}

// Interface for outcome-specific items
interface OutcomeItem {
  id: string;
  outcome_id: string;
  item_type: 'skill' | 'tool' | 'output' | 'file';
  filename: string;
  file_path: string;
  target_override: string | null;
  created_at: number;
  updated_at: number;
}

interface OutcomeItemsResponse {
  items: OutcomeItem[];
}

interface OutcomeResponse {
  outcome: {
    id: string;
    name: string;
  };
}

const command = new Command('outputs')
  .description('List output files for an outcome')
  .argument('<outcome-id>', 'Outcome ID')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Output paths only');

export const outputsCommand = command
  .action(async (outcomeId: string, options: OutputsOptions) => {
    try {
      // Fetch outcome details first
      let outcomeName = outcomeId;
      try {
        const outcomeResponse = await api.get<OutcomeResponse>(`/outcomes/${outcomeId}`);
        outcomeName = outcomeResponse.outcome.name;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome "${outcomeId}" not found`);
          process.exit(1);
        }
        throw error;
      }

      // Fetch output items
      const response = await api.get<OutcomeItemsResponse>(
        `/outcomes/${outcomeId}/items?type=output`
      );
      const outputs = response.items || [];

      // Handle JSON output
      if (options.json) {
        console.log(JSON.stringify({
          outcomeId,
          outcomeName,
          outputs,
        }, null, 2));
        return;
      }

      // Handle quiet output (paths only)
      if (options.quiet) {
        for (const output of outputs) {
          console.log(output.file_path);
        }
        return;
      }

      // Print formatted output
      console.log();
      console.log(chalk.bold(`Outputs (${outputs.length}) - ${outcomeName}`));

      if (outputs.length === 0) {
        console.log(chalk.gray('  No outputs found'));
      } else {
        for (const output of outputs) {
          const name = padEnd(output.filename, 20);
          const fileType = getFileType(output.filename);
          console.log(`  ${chalk.cyan(name)} ${chalk.gray(fileType)}`);
        }
      }

      console.log();
      if (outputs.length > 0) {
        console.log(chalk.gray(`Use \`open workspaces/${outcomeId}/<file>\` to view`));
        console.log();
      }

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

export default outputsCommand;
