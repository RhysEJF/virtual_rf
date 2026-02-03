/**
 * Items API
 *
 * Manages outcome items (skills, tools, files, outputs) and their sync status.
 * Supports multi-destination repository syncing.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOutcomeItems,
  upsertOutcomeItem,
  getOutcomeItem,
  updateOutcomeItem,
  getItemRepoSyncsWithDetails,
  getAllRepositories,
} from '@/lib/db/repositories';
import { getOutcomeById } from '@/lib/db/outcomes';
import {
  syncItem,
  promoteItem,
  syncItemToRepos,
  unsyncItemFromRepo,
  getItemSyncStatusFull,
} from '@/lib/sync/repository-sync';
import type { OutcomeItemType, SaveTarget } from '@/lib/db/schema';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/outcomes/[id]/items
 * List all tracked items for an outcome with sync details
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    // Optional filter by type
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type') as OutcomeItemType | null;
    const includeSyncs = searchParams.get('include_syncs') === 'true';

    let items = getOutcomeItems(id);

    if (typeFilter) {
      items = items.filter(item => item.item_type === typeFilter);
    }

    // Optionally include sync details from junction table
    if (includeSyncs) {
      const itemsWithSyncs = items.map(item => {
        const syncs = getItemRepoSyncsWithDetails(item.id);
        return {
          ...item,
          syncs: syncs.map(s => ({
            repo_id: s.repo_id,
            repo_name: s.repo_name,
            synced_at: s.synced_at,
            sync_status: s.sync_status,
            commit_hash: s.commit_hash,
          })),
        };
      });
      return NextResponse.json({
        items: itemsWithSyncs,
        available_repos: getAllRepositories(),
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    console.error('[Items API] Error listing items:', error);
    return NextResponse.json(
      { error: 'Failed to list items' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/outcomes/[id]/items
 * Register a new item or sync an existing item
 *
 * Body: {
 *   item_type: 'skill' | 'tool' | 'file' | 'output',
 *   filename: string,
 *   file_path: string,
 *   action?: 'register' | 'sync'
 * }
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const body = await request.json();
    const { item_type, filename, file_path, action = 'register' } = body;

    // Validate item_type
    const validTypes: OutcomeItemType[] = ['skill', 'tool', 'file', 'output'];
    if (!validTypes.includes(item_type)) {
      return NextResponse.json(
        { error: 'Invalid item_type. Must be: skill, tool, file, or output' },
        { status: 400 }
      );
    }

    if (!filename || !file_path) {
      return NextResponse.json(
        { error: 'filename and file_path are required' },
        { status: 400 }
      );
    }

    // Register the item
    const item = upsertOutcomeItem({
      outcome_id: id,
      item_type,
      filename,
      file_path,
    });

    // If action is sync, trigger sync immediately
    if (action === 'sync') {
      const result = await syncItem(id, item_type, filename, file_path);
      return NextResponse.json({
        item,
        sync: result,
      });
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error('[Items API] Error creating item:', error);
    return NextResponse.json(
      { error: 'Failed to create item' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/outcomes/[id]/items
 * Update an item (e.g., promote to different target, sync to specific repos)
 *
 * Actions:
 * - promote: Sync to outcome's default repo (legacy)
 *   { action: 'promote', target: 'local' | 'repo', item_type, filename }
 *
 * - sync: Sync to specific repository/repositories
 *   { action: 'sync', repo_ids: string[], item_type, filename }
 *
 * - unsync: Remove from specific repository
 *   { action: 'unsync', repo_id: string, item_type, filename }
 *
 * - get_sync_status: Get detailed sync status for an item
 *   { action: 'get_sync_status', item_type, filename }
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const body = await request.json();
    const { item_type, filename, action, target, repo_ids, repo_id } = body;

    // Validate item_type
    const validTypes: OutcomeItemType[] = ['skill', 'tool', 'file', 'output'];
    if (!validTypes.includes(item_type)) {
      return NextResponse.json(
        { error: 'Invalid item_type' },
        { status: 400 }
      );
    }

    // Handle get_sync_status action (doesn't require existing item)
    if (action === 'get_sync_status') {
      const status = getItemSyncStatusFull(id, item_type, filename);
      return NextResponse.json(status);
    }

    // Get existing item for other actions
    const item = getOutcomeItem(id, item_type, filename);
    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      );
    }

    // Handle promote action (legacy - uses outcome's default repo)
    if (action === 'promote') {
      if (target !== 'local' && target !== 'repo') {
        return NextResponse.json(
          { error: 'Invalid target. Must be: local or repo' },
          { status: 400 }
        );
      }

      const result = await promoteItem(id, item_type, filename, target);
      return NextResponse.json({
        success: result.success,
        target: result.target,
        repository: result.repository,
        error: result.error,
      });
    }

    // Handle sync action (multi-repo - sync to specific repos)
    if (action === 'sync') {
      if (!Array.isArray(repo_ids) || repo_ids.length === 0) {
        return NextResponse.json(
          { error: 'repo_ids array is required for sync action' },
          { status: 400 }
        );
      }

      const results = await syncItemToRepos(id, item_type, filename, repo_ids);
      const allSucceeded = results.every(r => r.success);

      return NextResponse.json({
        success: allSucceeded,
        results,
        partial: !allSucceeded && results.some(r => r.success),
      });
    }

    // Handle unsync action (remove from specific repo)
    if (action === 'unsync') {
      if (!repo_id || typeof repo_id !== 'string') {
        return NextResponse.json(
          { error: 'repo_id is required for unsync action' },
          { status: 400 }
        );
      }

      const result = await unsyncItemFromRepo(id, item_type, filename, repo_id);
      return NextResponse.json(result);
    }

    // Generic update (target_override only)
    if (target) {
      const validTargets: SaveTarget[] = ['local', 'repo', 'inherit'];
      if (!validTargets.includes(target)) {
        return NextResponse.json(
          { error: 'Invalid target. Must be: local, repo, or inherit' },
          { status: 400 }
        );
      }

      updateOutcomeItem(item.id, { target_override: target });
      const updated = getOutcomeItem(id, item_type, filename);
      return NextResponse.json({ item: updated });
    }

    return NextResponse.json(
      { error: 'No valid action or update provided' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Items API] Error updating item:', error);
    return NextResponse.json(
      { error: 'Failed to update item' },
      { status: 500 }
    );
  }
}
