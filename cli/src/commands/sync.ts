/**
 * Sync Command
 *
 * Syncs outcome items (skills, tools, outputs) to configured repositories.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

interface SyncOptions {
  repo?: string;
  type?: 'skill' | 'tool' | 'output';
  json?: boolean;
  quiet?: boolean;
}

// Interface for outcome item
interface OutcomeItem {
  id: string;
  outcome_id: string;
  item_type: 'skill' | 'tool' | 'file' | 'output';
  filename: string;
  file_path: string;
  target_override: string | null;
  created_at: number;
  updated_at: number;
  syncs?: ItemSync[];
}

interface ItemSync {
  repo_id: string;
  repo_name: string;
  synced_at: number | null;
  sync_status: string;
  commit_hash: string | null;
}

interface ItemsResponse {
  items: OutcomeItem[];
  available_repos?: Repository[];
}

interface Repository {
  id: string;
  name: string;
  local_path: string;
  remote_url: string | null;
  auto_push: boolean;
}

interface RepositoriesResponse {
  repositories: Repository[];
}

interface SyncResult {
  success: boolean;
  target?: string;
  repository?: string;
  error?: string;
}

interface SyncItemResult {
  item: string;
  type: string;
  success: boolean;
  repository?: string;
  error?: string;
}

const command = new Command('sync')
  .description('Sync outcome items to a repository')
  .argument('<outcome-id>', 'Outcome ID to sync')
  .option('--repo <id>', 'Sync to specific repository')
  .option('--type <type>', 'Sync only specific type (skill|tool|output)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output');

export const syncCommand = command
  .action(async (outcomeId: string, options: SyncOptions) => {
    try {
      // Fetch items with sync details
      const itemsResponse = await api.get<ItemsResponse>(
        `/outcomes/${outcomeId}/items?include_syncs=true`
      );

      let items = itemsResponse.items;

      // Filter by type if specified
      if (options.type) {
        items = items.filter(item => item.item_type === options.type);
      }

      // Exclude 'file' type items (not typically synced)
      items = items.filter(item => item.item_type !== 'file');

      if (items.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ synced: 0, skipped: 0, results: [] }, null, 2));
        } else if (!options.quiet) {
          console.log(chalk.yellow('No items to sync'));
        }
        return;
      }

      // Get repository info if --repo specified
      let targetRepo: Repository | undefined;
      if (options.repo) {
        const reposResponse = await api.get<RepositoriesResponse>('/repositories');
        targetRepo = reposResponse.repositories.find(
          r => r.id === options.repo || r.name === options.repo
        );
        if (!targetRepo) {
          console.error(chalk.red('Error:'), `Repository "${options.repo}" not found`);
          process.exit(1);
        }
      }

      // Sync each item
      const results: SyncItemResult[] = [];
      let synced = 0;
      let skipped = 0;

      if (!options.json && !options.quiet) {
        if (targetRepo) {
          console.log();
          console.log(`Syncing to repository: ${chalk.cyan(targetRepo.name)} ${chalk.gray(`(${targetRepo.remote_url || targetRepo.local_path})`)}`);
        } else {
          console.log();
          console.log('Syncing items to default repository...');
        }
        console.log();
      }

      for (const item of items) {
        try {
          let result: SyncResult;

          if (options.repo && targetRepo) {
            // Sync to specific repo using sync action
            const syncResponse = await api.patch<{ success: boolean; results?: Array<{ success: boolean; repo_name?: string; error?: string }> }>(
              `/outcomes/${outcomeId}/items`,
              {
                action: 'sync',
                item_type: item.item_type,
                filename: item.filename,
                repo_ids: [targetRepo.id],
              }
            );

            const firstResult = syncResponse.results?.[0];
            result = {
              success: syncResponse.success,
              repository: firstResult?.repo_name || targetRepo.name,
              error: firstResult?.error,
            };
          } else {
            // Use promote action with 'repo' target (default repo)
            result = await api.patch<SyncResult>(
              `/outcomes/${outcomeId}/items`,
              {
                action: 'promote',
                target: 'repo',
                item_type: item.item_type,
                filename: item.filename,
              }
            );
          }

          const itemPath = `${item.item_type}s/${item.filename}`;

          if (result.success) {
            synced++;
            results.push({
              item: itemPath,
              type: item.item_type,
              success: true,
              repository: result.repository,
            });

            if (!options.json && !options.quiet) {
              console.log(`  ${chalk.green('✓')} ${itemPath}`);
            }
          } else {
            skipped++;
            results.push({
              item: itemPath,
              type: item.item_type,
              success: false,
              error: result.error || 'Unknown error',
            });

            if (!options.json && !options.quiet) {
              const reason = result.error || 'sync failed';
              console.log(`  ${chalk.red('✗')} ${itemPath} ${chalk.gray(`(${reason})`)}`);
            }
          }
        } catch (error) {
          const itemPath = `${item.item_type}s/${item.filename}`;
          skipped++;

          let errorMessage = 'Unknown error';
          if (error instanceof ApiError) {
            errorMessage = error.message;
          } else if (error instanceof Error) {
            errorMessage = error.message;
          }

          results.push({
            item: itemPath,
            type: item.item_type,
            success: false,
            error: errorMessage,
          });

          if (!options.json && !options.quiet) {
            console.log(`  ${chalk.red('✗')} ${itemPath} ${chalk.gray(`(${errorMessage})`)}`);
          }
        }
      }

      // Output results
      if (options.json) {
        console.log(JSON.stringify({
          synced,
          skipped,
          results,
        }, null, 2));
      } else if (options.quiet) {
        console.log(`${synced}`);
      } else {
        console.log();
        console.log(`${chalk.green(synced)} items synced, ${chalk.yellow(skipped)} skipped`);
        console.log();
      }

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome "${outcomeId}" not found`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default syncCommand;
