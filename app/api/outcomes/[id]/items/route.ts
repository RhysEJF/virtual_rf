/**
 * Items API
 *
 * Manages outcome items (skills, tools, files, outputs) and their sync status.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOutcomeItems,
  upsertOutcomeItem,
  getOutcomeItem,
  updateOutcomeItem,
} from '@/lib/db/repositories';
import { getOutcomeById } from '@/lib/db/outcomes';
import { syncItem, promoteItem } from '@/lib/sync/repository-sync';
import type { OutcomeItemType, SaveTarget } from '@/lib/db/schema';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/outcomes/[id]/items
 * List all tracked items for an outcome
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

    let items = getOutcomeItems(id);

    if (typeFilter) {
      items = items.filter(item => item.item_type === typeFilter);
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
 * Update an item (e.g., promote to different target)
 *
 * Body: {
 *   item_type: 'skill' | 'tool' | 'file' | 'output',
 *   filename: string,
 *   action: 'promote',
 *   target: 'local' | 'private' | 'team'
 * }
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
    const { item_type, filename, action, target } = body;

    // Validate item_type
    const validTypes: OutcomeItemType[] = ['skill', 'tool', 'file', 'output'];
    if (!validTypes.includes(item_type)) {
      return NextResponse.json(
        { error: 'Invalid item_type' },
        { status: 400 }
      );
    }

    // Get existing item
    const item = getOutcomeItem(id, item_type, filename);
    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      );
    }

    if (action === 'promote') {
      // Validate target
      const validTargets: SaveTarget[] = ['local', 'private', 'team'];
      if (!validTargets.includes(target)) {
        return NextResponse.json(
          { error: 'Invalid target. Must be: local, private, or team' },
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

    // Generic update (target_override only)
    if (target) {
      const validTargets: SaveTarget[] = ['local', 'private', 'team'];
      if (!validTargets.includes(target)) {
        return NextResponse.json(
          { error: 'Invalid target' },
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
