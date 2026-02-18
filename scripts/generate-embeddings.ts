#!/usr/bin/env npx ts-node
/**
 * Generate Embeddings for Memories
 *
 * This script generates vector embeddings for memories that don't have them.
 * Requires Ollama to be running with nomic-embed-text model.
 */

import { memoryService } from '../lib/memory';

async function main() {
  console.log('Checking Ollama health...');
  const health = await memoryService.checkHealth();

  if (!health.features.embeddings) {
    console.error('Ollama is not available. Please run: ollama serve');
    console.error('Details:', health.details.ollamaHealth);
    process.exit(1);
  }

  console.log('Ollama is ready. Generating missing embeddings...\n');

  const result = await memoryService.generateMissingEmbeddings(10);

  console.log(`\nResults:`);
  console.log(`  Processed: ${result.processed}`);
  console.log(`  Failed: ${result.failed}`);

  // Check final stats
  const stats = memoryService.getStats();
  console.log(`\nMemory Stats:`);
  console.log(`  Total memories: ${stats.totalMemories}`);
  console.log(`  Active: ${stats.activeMemories}`);
  console.log(`  Superseded: ${stats.supersededMemories}`);
}

main().catch(console.error);
