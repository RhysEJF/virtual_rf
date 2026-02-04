/**
 * Skills Command
 *
 * Lists available skills (global and outcome-specific).
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

interface SkillsOptions {
  outcome?: string;
  json?: boolean;
  quiet?: boolean;
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

const command = new Command('skills')
  .description('List available skills')
  .option('--outcome <id>', 'Show outcome-specific skills')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Output names only');

export const skillsCommand = command
  .action(async (options: SkillsOptions) => {
    try {
      // Fetch global skills
      const globalResponse = await api.skills.list();
      const globalSkills = globalResponse.skills;

      // Fetch outcome-specific skills if --outcome provided
      let outcomeSkills: OutcomeItem[] = [];
      if (options.outcome) {
        try {
          const outcomeResponse = await api.get<OutcomeItemsResponse>(
            `/outcomes/${options.outcome}/items?type=skill`
          );
          outcomeSkills = outcomeResponse.items || [];
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
          global: globalSkills,
          outcome: options.outcome ? {
            id: options.outcome,
            skills: outcomeSkills,
          } : undefined,
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Handle quiet output (names only)
      if (options.quiet) {
        for (const skill of globalSkills) {
          console.log(skill.name);
        }
        for (const skill of outcomeSkills) {
          console.log(skill.name);
        }
        return;
      }

      // Print formatted output
      console.log();

      // Global skills section
      console.log(chalk.bold(`Global Skills (${globalSkills.length})`));
      if (globalSkills.length === 0) {
        console.log(chalk.gray('  No global skills found'));
      } else {
        for (const skill of globalSkills) {
          const name = padEnd(skill.name, 20);
          const description = skill.description || chalk.gray('No description');
          console.log(`  ${chalk.cyan(name)} ${description}`);
        }
      }

      // Outcome skills section (if requested)
      if (options.outcome) {
        console.log();
        console.log(chalk.bold(`Outcome Skills (${outcomeSkills.length}) - ${options.outcome}`));
        if (outcomeSkills.length === 0) {
          console.log(chalk.gray('  No outcome-specific skills found'));
        } else {
          for (const skill of outcomeSkills) {
            const name = padEnd(skill.name, 20);
            console.log(`  ${chalk.cyan(name)} ${chalk.gray(skill.path)}`);
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

export default skillsCommand;
