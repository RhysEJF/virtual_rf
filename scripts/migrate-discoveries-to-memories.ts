#!/usr/bin/env npx ts-node
/**
 * Migration Script: Index HOMЯ Discoveries as Memories
 *
 * This script migrates existing discoveries from homr_context to the memories table,
 * enabling cross-outcome memory retrieval.
 */

import { getDb, now } from '../lib/db/index';
import { createMemory, type CreateMemoryInput } from '../lib/db/memory';
import { generateId } from '../lib/utils/id';

interface HomrDiscovery {
  type: 'blocker' | 'constraint' | 'pattern' | 'dependency' | 'decision' | 'insight';
  content: string;
  relevantTasks: string[];
  source: string;
}

interface HomrContext {
  id: string;
  outcome_id: string;
  discoveries: string;
}

// Map discovery types to memory types (using valid MemoryType values)
const typeMapping: Record<string, CreateMemoryInput['type']> = {
  blocker: 'lesson',      // Blockers are lessons learned
  constraint: 'fact',     // Constraints are factual limitations
  pattern: 'pattern',     // Patterns stay as patterns
  dependency: 'fact',     // Dependencies are factual
  decision: 'preference', // Decisions become preferences
  insight: 'lesson',      // Insights are lessons
};

// Map discovery types to importance
const importanceMapping: Record<string, CreateMemoryInput['importance']> = {
  blocker: 'critical',
  constraint: 'high',
  pattern: 'medium',
  dependency: 'medium',
  decision: 'high',
  insight: 'medium',
};

async function migrate() {
  const db = getDb();

  console.log('Starting discovery → memory migration...\n');

  // Get all homr_context entries with discoveries
  const contexts = db.prepare(`
    SELECT id, outcome_id, discoveries
    FROM homr_context
    WHERE discoveries != '[]'
  `).all() as HomrContext[];

  console.log(`Found ${contexts.length} outcomes with discoveries\n`);

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const ctx of contexts) {
    let discoveries: HomrDiscovery[];
    try {
      discoveries = JSON.parse(ctx.discoveries);
    } catch (e) {
      console.log(`  Skipping ${ctx.outcome_id}: invalid JSON`);
      continue;
    }

    console.log(`Processing ${ctx.outcome_id}: ${discoveries.length} discoveries`);

    for (const discovery of discoveries) {
      // Check if this discovery already exists as a memory (by content hash)
      const existing = db.prepare(`
        SELECT id FROM memories WHERE content = ? AND source_outcome_id = ?
      `).get(discovery.content, ctx.outcome_id);

      if (existing) {
        totalSkipped++;
        continue;
      }

      // Create memory from discovery
      try {
        createMemory({
          content: discovery.content,
          type: typeMapping[discovery.type] || 'lesson',
          importance: importanceMapping[discovery.type] || 'medium',
          source: 'homr',  // Valid MemorySource type
          source_outcome_id: ctx.outcome_id,
          source_task_id: discovery.source.startsWith('task_') ? discovery.source : undefined,
          tags: [discovery.type, 'migrated', 'discovery'],
          confidence: 0.8,
        });
        totalMigrated++;
      } catch (e) {
        console.log(`  Error migrating discovery: ${e}`);
      }
    }
  }

  console.log(`\nMigration complete!`);
  console.log(`  Migrated: ${totalMigrated} discoveries`);
  console.log(`  Skipped (duplicates): ${totalSkipped}`);

  // Show final count
  const memoryCount = db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
  console.log(`  Total memories in database: ${memoryCount.count}`);
}

migrate().catch(console.error);
