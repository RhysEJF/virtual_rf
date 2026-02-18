/**
 * Unit Tests for Task Decomposer - Bulk Item Count Detection
 *
 * Tests verifying the detectBulkItemCount utility function for parsing
 * quantity indicators from task descriptions.
 *
 * Run with: npx tsx lib/agents/__tests__/task-decomposer.test.ts
 */

import { detectBulkItemCount, BulkItemCountResult } from '../task-decomposer';

// ============================================================================
// Test Utilities
// ============================================================================

let passCount = 0;
let failCount = 0;

function describe(name: string, fn: () => void): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('='.repeat(60));
  fn();
}

function it(name: string, fn: () => void): void {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error instanceof Error ? error.message : error}`);
  }
}

function expect<T>(actual: T): {
  toBe: (expected: T) => void;
  toBeNull: () => void;
  toNotBeNull: () => void;
  toEqual: (expected: T) => void;
} {
  return {
    toBe(expected: T): void {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeNull(): void {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toNotBeNull(): void {
      if (actual === null) {
        throw new Error('Expected non-null value, got null');
      }
    },
    toEqual(expected: T): void {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

// ============================================================================
// Basic Detection Tests
// ============================================================================

describe('detectBulkItemCount - Basic Patterns', () => {
  it('should detect "50 files"', () => {
    const result = detectBulkItemCount('Process 50 files in the directory');
    expect(result.count).toBe(50);
    expect(result.pattern).toNotBeNull();
  });

  it('should detect "200 records"', () => {
    const result = detectBulkItemCount('Import 200 records from CSV');
    expect(result.count).toBe(200);
    expect(result.pattern).toNotBeNull();
  });

  it('should detect "1000 entries"', () => {
    const result = detectBulkItemCount('Process 1000 entries in the database');
    expect(result.count).toBe(1000);
  });

  it('should detect "100 items"', () => {
    const result = detectBulkItemCount('Handle 100 items in the queue');
    expect(result.count).toBe(100);
  });

  it('should detect "25 documents"', () => {
    const result = detectBulkItemCount('Parse 25 documents');
    expect(result.count).toBe(25);
  });

  it('should detect "75 users"', () => {
    const result = detectBulkItemCount('Create accounts for 75 users');
    expect(result.count).toBe(75);
  });
});

describe('detectBulkItemCount - Action Verb Patterns', () => {
  it('should detect "process 50 files"', () => {
    const result = detectBulkItemCount('We need to process 50 files today');
    expect(result.count).toBe(50);
  });

  it('should detect "import 300 records"', () => {
    const result = detectBulkItemCount('Import 300 records from the API');
    expect(result.count).toBe(300);
  });

  it('should detect "migrate 150 entries"', () => {
    const result = detectBulkItemCount('Migrate 150 entries to new schema');
    expect(result.count).toBe(150);
  });

  it('should detect "validate 80 items"', () => {
    const result = detectBulkItemCount('Validate 80 items in the cart');
    expect(result.count).toBe(80);
  });

  it('should detect "convert 60 images"', () => {
    const result = detectBulkItemCount('Convert 60 images to WebP format');
    expect(result.count).toBe(60);
  });

  it('should detect "create 20 components"', () => {
    const result = detectBulkItemCount('Create 20 components for the UI');
    expect(result.count).toBe(20);
  });

  it('should detect "delete 45 rows"', () => {
    const result = detectBulkItemCount('Delete 45 rows from the table');
    expect(result.count).toBe(45);
  });
});

describe('detectBulkItemCount - Approximate Quantity Patterns', () => {
  it('should detect "over 100 files"', () => {
    const result = detectBulkItemCount('Process over 100 files');
    expect(result.count).toBe(100);
  });

  it('should detect "more than 50 records"', () => {
    const result = detectBulkItemCount('Handle more than 50 records');
    expect(result.count).toBe(50);
  });

  it('should detect "at least 30 items"', () => {
    const result = detectBulkItemCount('Create at least 30 items');
    expect(result.count).toBe(30);
  });

  it('should detect "approximately 200 entries"', () => {
    const result = detectBulkItemCount('Process approximately 200 entries');
    expect(result.count).toBe(200);
  });

  it('should detect "around 75 documents"', () => {
    const result = detectBulkItemCount('Review around 75 documents');
    expect(result.count).toBe(75);
  });

  it('should detect "about 150 users"', () => {
    const result = detectBulkItemCount('Notify about 150 users');
    expect(result.count).toBe(150);
  });
});

describe('detectBulkItemCount - Plus Notation Patterns', () => {
  it('should detect "50+ files"', () => {
    const result = detectBulkItemCount('Handle 50+ files');
    expect(result.count).toBe(50);
  });

  it('should detect "100 or more records"', () => {
    const result = detectBulkItemCount('Process 100 or more records');
    expect(result.count).toBe(100);
  });
});

// ============================================================================
// Edge Cases and Non-Matching Tests
// ============================================================================

describe('detectBulkItemCount - No Match Cases', () => {
  it('should return null for empty string', () => {
    const result = detectBulkItemCount('');
    expect(result.count).toBeNull();
    expect(result.pattern).toBeNull();
  });

  it('should return null for whitespace only', () => {
    const result = detectBulkItemCount('   ');
    expect(result.count).toBeNull();
    expect(result.pattern).toBeNull();
  });

  it('should return null for text without numbers', () => {
    const result = detectBulkItemCount('Process all the files in the directory');
    expect(result.count).toBeNull();
    expect(result.pattern).toBeNull();
  });

  it('should return null for numbers without item nouns', () => {
    const result = detectBulkItemCount('The version is 3.14.159');
    expect(result.count).toBeNull();
    expect(result.pattern).toBeNull();
  });

  it('should return null for single item (count = 1)', () => {
    const result = detectBulkItemCount('Process 1 file');
    expect(result.count).toBeNull();
    expect(result.pattern).toBeNull();
  });

  it('should return null for unrelated contexts', () => {
    const result = detectBulkItemCount('Use React 18 and Node 20');
    expect(result.count).toBeNull();
    expect(result.pattern).toBeNull();
  });
});

describe('detectBulkItemCount - Singular vs Plural', () => {
  it('should detect singular "file" with count > 1', () => {
    const result = detectBulkItemCount('Delete 5 file entries');
    // Pattern matches "5 file" (singular is allowed via files?)
    expect(result.count).toBe(5);
  });

  it('should detect plural "files"', () => {
    const result = detectBulkItemCount('Process 10 files');
    expect(result.count).toBe(10);
  });

  it('should detect "2 items" (minimum bulk threshold)', () => {
    const result = detectBulkItemCount('Handle 2 items');
    expect(result.count).toBe(2);
  });
});

describe('detectBulkItemCount - Mixed Content', () => {
  it('should detect first valid pattern in mixed text', () => {
    const result = detectBulkItemCount('First create 30 files, then process 50 records');
    // Should find the first match
    expect(result.count).toBe(30);
  });

  it('should handle descriptions with multiple sentences', () => {
    const result = detectBulkItemCount(
      'This task involves data migration. We need to process 100 records from the old database. Each record must be validated.'
    );
    expect(result.count).toBe(100);
  });

  it('should handle markdown formatting', () => {
    const result = detectBulkItemCount('**Important**: Process 75 entries before deadline');
    expect(result.count).toBe(75);
  });
});

describe('detectBulkItemCount - Case Insensitivity', () => {
  it('should detect uppercase "FILES"', () => {
    const result = detectBulkItemCount('PROCESS 50 FILES');
    expect(result.count).toBe(50);
  });

  it('should detect mixed case "Files"', () => {
    const result = detectBulkItemCount('Import 25 Files from server');
    expect(result.count).toBe(25);
  });
});

describe('detectBulkItemCount - Various Item Types', () => {
  it('should detect "endpoints"', () => {
    const result = detectBulkItemCount('Test 15 endpoints');
    expect(result.count).toBe(15);
  });

  it('should detect "apis"', () => {
    const result = detectBulkItemCount('Document 8 apis');
    expect(result.count).toBe(8);
  });

  it('should detect "tests"', () => {
    const result = detectBulkItemCount('Write 40 tests');
    expect(result.count).toBe(40);
  });

  it('should detect "pages"', () => {
    const result = detectBulkItemCount('Create 12 pages');
    expect(result.count).toBe(12);
  });

  it('should detect "rows"', () => {
    const result = detectBulkItemCount('Delete 500 rows');
    expect(result.count).toBe(500);
  });

  it('should detect "objects"', () => {
    const result = detectBulkItemCount('Serialize 60 objects');
    expect(result.count).toBe(60);
  });

  it('should detect "tasks"', () => {
    const result = detectBulkItemCount('Complete 25 tasks');
    expect(result.count).toBe(25);
  });
});

// ============================================================================
// Run Tests
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('  BULK ITEM COUNT DETECTION TESTS');
console.log('='.repeat(60));

// All tests are already defined in describe blocks above
// The describe function executes them immediately

// Print summary
console.log('\n' + '='.repeat(60));
console.log(`  SUMMARY: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(60) + '\n');

if (failCount > 0) {
  process.exit(1);
}
