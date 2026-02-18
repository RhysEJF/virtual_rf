/**
 * Vector Search Validation Tests
 *
 * Validates vector search functionality including:
 * - VSS extension loading and graceful fallback
 * - Memory VSS schema creation
 * - Cosine similarity calculations
 * - Hybrid search with fallback to BM25
 *
 * To run these tests:
 * ```bash
 * npx ts-node lib/embedding/__tests__/vector-search.test.ts
 * ```
 */

import {
  loadVSSExtension,
  checkVSSAvailability,
  getVSSInstallInstructions,
  clearVSSStatusCache
} from '../../db/vss-loader';
import {
  createMemoryVSSSchema,
  isMemoryVSSReady,
  getMemoryVSSStats,
  initializeMemoryVSS,
  getVSSDimensions
} from '../../db/memory-vss';
import {
  cosineSimilarity,
  findSimilar,
  getEmbeddingDimension,
  checkOllamaHealth
} from '../ollama';
import {
  isHybridSearchAvailable,
  searchMemoriesBM25Only,
} from '../hybrid-search';
import { getDb } from '../../db/index';
import Database from 'better-sqlite3';

// ============================================================================
// Test Results Tracking
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const testResults: TestResult[] = [];

function runTest(name: string, testFn: () => void | Promise<void>): Promise<TestResult> {
  return new Promise(async (resolve) => {
    const startTime = Date.now();
    let passed = false;
    let message = '';

    try {
      await testFn();
      passed = true;
      message = 'PASSED';
    } catch (error) {
      passed = false;
      message = error instanceof Error ? error.message : String(error);
    }

    const result: TestResult = {
      name,
      passed,
      message,
      duration: Date.now() - startTime,
    };

    testResults.push(result);
    resolve(result);
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, name: string): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${actual}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, name: string): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${name}: expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

// ============================================================================
// Test Cases
// ============================================================================

async function testCosineSimilarityIdentical(): Promise<void> {
  // Identical vectors should have similarity of 1
  const v1 = [1, 2, 3, 4, 5];
  const result = cosineSimilarity(v1, v1);
  assertApprox(result, 1.0, 0.0001, 'Identical vector similarity');
}

async function testCosineSimilarityOpposite(): Promise<void> {
  // Opposite vectors should have similarity of -1
  const v1 = [1, 2, 3];
  const v2 = [-1, -2, -3];
  const result = cosineSimilarity(v1, v2);
  assertApprox(result, -1.0, 0.0001, 'Opposite vector similarity');
}

async function testCosineSimilarityOrthogonal(): Promise<void> {
  // Orthogonal vectors should have similarity of 0
  const v1 = [1, 0, 0];
  const v2 = [0, 1, 0];
  const result = cosineSimilarity(v1, v2);
  assertApprox(result, 0.0, 0.0001, 'Orthogonal vector similarity');
}

async function testCosineSimilarityPartial(): Promise<void> {
  // Partially similar vectors
  const v1 = [1, 1, 0];
  const v2 = [1, 0, 0];
  const result = cosineSimilarity(v1, v2);
  // Expected: 1 / (sqrt(2) * 1) = 0.707...
  assertApprox(result, 0.7071, 0.001, 'Partial similarity');
}

async function testCosineSimilarityDimensionMismatch(): Promise<void> {
  // Should throw on dimension mismatch
  const v1 = [1, 2, 3];
  const v2 = [1, 2];
  let threw = false;
  try {
    cosineSimilarity(v1, v2);
  } catch (e) {
    threw = true;
    assert(
      (e as Error).message.includes('dimensions'),
      'Error should mention dimensions'
    );
  }
  assert(threw, 'Should throw on dimension mismatch');
}

async function testFindSimilar(): Promise<void> {
  // Test findSimilar utility
  const query = [1, 0, 0];
  const embeddings = [
    [1, 0, 0],     // identical - should be first
    [0, 1, 0],     // orthogonal - similarity 0
    [0.7, 0.7, 0], // partial - similarity ~0.71
    [-1, 0, 0],    // opposite - similarity -1
  ];

  const results = findSimilar(query, embeddings, 4);

  assertEqual(results.length, 4, 'Result count');
  assertEqual(results[0].index, 0, 'Most similar should be index 0');
  assertEqual(results[3].index, 3, 'Least similar should be index 3 (opposite)');
  assertApprox(results[0].similarity, 1.0, 0.0001, 'Top result similarity');
}

async function testGetEmbeddingDimension(): Promise<void> {
  // Test dimension lookup for known models
  assertEqual(getEmbeddingDimension('nomic-embed-text'), 768, 'nomic-embed-text dimensions');
  assertEqual(getEmbeddingDimension('mxbai-embed-large'), 1024, 'mxbai-embed-large dimensions');
  assertEqual(getEmbeddingDimension('all-minilm'), 384, 'all-minilm dimensions');
  assertEqual(getEmbeddingDimension('unknown-model'), 768, 'Unknown model defaults to 768');
}

async function testVSSAvailabilityCheck(): Promise<void> {
  // Check that availability check runs without error
  const availability = checkVSSAvailability();

  assert(typeof availability.available === 'boolean', 'Should return availability status');
  assert(typeof availability.platform === 'string', 'Should return platform');

  console.log(`  VSS availability: ${availability.available}`);
  if (availability.path) {
    console.log(`  VSS path: ${availability.path}`);
  }
}

async function testVSSLoadExtension(): Promise<void> {
  // Test loading VSS extension (may not be available)
  clearVSSStatusCache();

  // Create a temporary in-memory database for testing
  const testDb = new Database(':memory:');

  try {
    const result = loadVSSExtension(testDb);

    assert(typeof result.available === 'boolean', 'Should return availability');
    assert(typeof result.platform === 'string', 'Should return platform');

    if (result.available) {
      console.log(`  VSS loaded from: ${result.loadedFrom}`);
    } else {
      console.log(`  VSS not available: ${result.error}`);
      // This is expected if sqlite-vss is not installed
    }
  } finally {
    testDb.close();
  }
}

async function testVSSInstallInstructions(): Promise<void> {
  // Test that install instructions are generated
  const instructions = getVSSInstallInstructions();

  assert(instructions.length > 0, 'Should return install instructions');
  assert(instructions.includes('sqlite-vss'), 'Should mention sqlite-vss');
}

async function testMemoryVSSSchema(): Promise<void> {
  // Test schema creation (should handle missing extension gracefully)
  clearVSSStatusCache();

  const testDb = new Database(':memory:');

  try {
    // First create the memories table that memory_vss depends on
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        embedding TEXT,
        superseded_by TEXT,
        expires_at INTEGER
      )
    `);

    // Now try to create VSS schema
    const result = createMemoryVSSSchema(testDb);

    assert(typeof result.created === 'boolean', 'Should return created status');
    assert(typeof result.extensionAvailable === 'boolean', 'Should return extension status');
    assert(typeof result.dimensions === 'number', 'Should return dimensions');

    console.log(`  VSS schema created: ${result.created}`);
    console.log(`  Extension available: ${result.extensionAvailable}`);
    console.log(`  Dimensions: ${result.dimensions}`);

    if (!result.created && result.notes) {
      console.log(`  Notes: ${result.notes}`);
    }
  } finally {
    testDb.close();
  }
}

async function testInitializeMemoryVSS(): Promise<void> {
  // Test full VSS initialization
  clearVSSStatusCache();

  const testDb = new Database(':memory:');

  try {
    // Create dependencies
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        embedding TEXT,
        superseded_by TEXT,
        expires_at INTEGER
      )
    `);

    const result = initializeMemoryVSS(testDb, { populate: true });

    assert(typeof result.extensionLoaded === 'boolean', 'Should report extension loaded');
    assert(typeof result.schemaCreated === 'boolean', 'Should report schema created');
    assert(typeof result.indexPopulated === 'boolean', 'Should report index populated');

    console.log(`  Extension loaded: ${result.extensionLoaded}`);
    console.log(`  Schema created: ${result.schemaCreated}`);
    console.log(`  Index populated: ${result.indexPopulated}`);
  } finally {
    testDb.close();
  }
}

async function testGetVSSDimensions(): Promise<void> {
  // Test dimension configuration
  const dimensions = getVSSDimensions();

  assert(typeof dimensions === 'number', 'Should return number');
  assert(dimensions > 0, 'Dimensions should be positive');
  assertEqual(dimensions, 768, 'Default dimensions should be 768');
}

async function testOllamaHealthCheck(): Promise<void> {
  // Test Ollama health check (expected to fail if Ollama not running)
  const health = await checkOllamaHealth();

  assert(typeof health.available === 'boolean', 'Should return availability');
  assert(typeof health.modelReady === 'boolean', 'Should return model readiness');

  console.log(`  Ollama available: ${health.available}`);
  console.log(`  Model ready: ${health.modelReady}`);
  if (health.error) {
    console.log(`  Error: ${health.error}`);
  }
}

async function testHybridSearchAvailability(): Promise<void> {
  // Test hybrid search availability check
  const availability = await isHybridSearchAvailable();

  assert(typeof availability.vectorAvailable === 'boolean', 'Should return vector availability');
  assert(typeof availability.bm25Available === 'boolean', 'Should return BM25 availability');
  assert(typeof availability.fullyAvailable === 'boolean', 'Should return full availability');
  assert(Array.isArray(availability.warnings), 'Should return warnings array');

  console.log(`  Vector search available: ${availability.vectorAvailable}`);
  console.log(`  BM25 search available: ${availability.bm25Available}`);
  console.log(`  Fully available: ${availability.fullyAvailable}`);
  if (availability.warnings.length > 0) {
    console.log(`  Warnings: ${availability.warnings.join(', ')}`);
  }
}

async function testBM25FallbackSearch(): Promise<void> {
  // Test BM25-only search works as fallback
  // This requires the actual database
  try {
    const result = searchMemoriesBM25Only('test query', 5);

    assert(Array.isArray(result.results), 'Should return results array');
    assert(result.query === 'test query', 'Should preserve query');
    assert(result.bm25SearchUsed === true, 'Should use BM25 search');
    assert(result.vectorSearchUsed === false, 'Should not use vector search');

    console.log(`  BM25 search completed: ${result.results.length} results`);
    console.log(`  Timing: ${result.timing.totalMs}ms`);
  } catch (error) {
    // This may fail if database is not initialized
    console.log(`  Note: BM25 search requires database initialization`);
    throw error;
  }
}

// ============================================================================
// Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('\n========================================');
  console.log('Vector Search Validation Tests');
  console.log('========================================\n');

  // Core algorithm tests (no external dependencies)
  console.log('--- Cosine Similarity Tests ---');
  await runTest('Cosine similarity - identical vectors', testCosineSimilarityIdentical);
  await runTest('Cosine similarity - opposite vectors', testCosineSimilarityOpposite);
  await runTest('Cosine similarity - orthogonal vectors', testCosineSimilarityOrthogonal);
  await runTest('Cosine similarity - partial similarity', testCosineSimilarityPartial);
  await runTest('Cosine similarity - dimension mismatch', testCosineSimilarityDimensionMismatch);
  await runTest('Find similar embeddings', testFindSimilar);
  await runTest('Get embedding dimensions', testGetEmbeddingDimension);

  console.log('\n--- VSS Extension Tests ---');
  await runTest('VSS availability check', testVSSAvailabilityCheck);
  await runTest('VSS extension loading', testVSSLoadExtension);
  await runTest('VSS install instructions', testVSSInstallInstructions);
  await runTest('Get VSS dimensions', testGetVSSDimensions);

  console.log('\n--- Memory VSS Schema Tests ---');
  await runTest('Memory VSS schema creation', testMemoryVSSSchema);
  await runTest('Initialize Memory VSS', testInitializeMemoryVSS);

  console.log('\n--- External Service Tests ---');
  await runTest('Ollama health check', testOllamaHealthCheck);
  await runTest('Hybrid search availability', testHybridSearchAvailability);

  // BM25 fallback test - may fail without DB
  console.log('\n--- Fallback Search Tests ---');
  try {
    await runTest('BM25 fallback search', testBM25FallbackSearch);
  } catch {
    console.log('  BM25 test skipped (database not available)');
  }

  // Print summary
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================\n');

  const passed = testResults.filter(r => r.passed);
  const failed = testResults.filter(r => !r.passed);

  console.log(`Total: ${testResults.length}`);
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}\n`);

  if (failed.length > 0) {
    console.log('Failed tests:');
    for (const result of failed) {
      console.log(`  ❌ ${result.name}: ${result.message}`);
    }
    console.log('');
  }

  // Print timing
  const totalTime = testResults.reduce((sum, r) => sum + r.duration, 0);
  console.log(`Total time: ${totalTime}ms\n`);

  // Exit with appropriate code
  if (failed.length > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(console.error);
