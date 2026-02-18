# SQLite Vector Search Extension Research

Research document for integrating vector search with better-sqlite3 in the Digital Twin system.

## Executive Summary

**Recommendation: Use `sqlite-vec` over `sqlite-vss`**

- `sqlite-vss` is deprecated and not in active development
- `sqlite-vec` is the official successor, written in pure C with zero dependencies
- `sqlite-vec` works on all platforms (macOS, Linux, Windows, WASM, Raspberry Pi)
- Both have npm packages that work with better-sqlite3

## Package Options

### 1. sqlite-vss (Deprecated)

**Status**: ⚠️ Not in active development - use sqlite-vec instead

**npm package**: `sqlite-vss`

```bash
npm install sqlite-vss
```

**Usage with better-sqlite3**:
```typescript
import Database from 'better-sqlite3';
import * as sqlite_vss from 'sqlite-vss';

const db = new Database(':memory:');
sqlite_vss.load(db);

// Or use the direct path approach:
// db.loadExtension(sqlite_vss.getLoadablePath());
```

**Platform-specific files**:
| Platform | Extension Files |
|----------|-----------------|
| macOS (x86_64, Big Sur 11+) | `vector0.dylib`, `vss0.dylib` |
| Linux (x86_64) | `vector0.so`, `vss0.so` |
| Windows | Not officially supported |

**Dependencies**: Requires both `vector0` and `vss0` extensions loaded in order.

**Underlying technology**: Based on Faiss (Facebook AI Similarity Search)

---

### 2. sqlite-vec (Recommended)

**Status**: ✅ Actively maintained successor to sqlite-vss

**npm package**: `sqlite-vec`

```bash
npm install sqlite-vec
```

**Usage with better-sqlite3**:
```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const db = new Database(':memory:');
sqliteVec.load(db);

// Verify installation
const version = db.prepare('SELECT vec_version()').pluck().get();
console.log('sqlite-vec version:', version);
```

**Platform support**:
| Platform | Status |
|----------|--------|
| macOS (x86_64, arm64) | ✅ Supported |
| Linux (x86_64, arm64) | ✅ Supported |
| Windows (x86_64) | ✅ Supported |
| Browser (WASM) | ✅ Supported |
| Raspberry Pi | ✅ Supported |

**Dependencies**: Zero external dependencies (pure C implementation)

---

## better-sqlite3 Compatibility

### Current Project Version

From `package.json`:
```json
"better-sqlite3": "^11.0.0"
```

### SQLite Version Bundled

- **better-sqlite3 v11.0.0** bundles **SQLite 3.46.0**
- This is a recent SQLite version with full support for loadable extensions

### loadExtension API

better-sqlite3 has supported SQLite extensions since v3.3.0 via `Database#loadExtension()`:

```typescript
// Method 1: Using the npm package helper
import * as sqliteVec from 'sqlite-vec';
sqliteVec.load(db);

// Method 2: Direct loadExtension with path
db.loadExtension('/path/to/extension'); // No file extension needed

// Method 3: Using getLoadablePath() helper
db.loadExtension(sqliteVec.getLoadablePath());
```

### Platform-Specific Library Paths

When loading extensions manually, the file extensions are:

| Platform | Extension | Example Path |
|----------|-----------|--------------|
| macOS | `.dylib` | `vec0.dylib` |
| Linux | `.so` | `vec0.so` |
| Windows | `.dll` | `vec0.dll` |

**Note**: SQLite can infer the correct extension, so you can omit the file extension when calling `loadExtension()`.

---

## Integration Architecture

### Recommended Approach for Digital Twin

```typescript
// lib/db/vector.ts

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

/**
 * Load the sqlite-vec extension into a database instance
 */
export function loadVectorExtension(db: Database.Database): void {
  try {
    sqliteVec.load(db);
    console.log('[Vector DB] sqlite-vec extension loaded successfully');
  } catch (err) {
    console.error('[Vector DB] Failed to load sqlite-vec extension:', err);
    throw err;
  }
}

/**
 * Check if vector extension is available
 */
export function isVectorExtensionLoaded(db: Database.Database): boolean {
  try {
    db.prepare('SELECT vec_version()').get();
    return true;
  } catch {
    return false;
  }
}
```

### Schema for Vector Storage

sqlite-vec uses virtual tables for vector storage:

```sql
-- Create a virtual table for vector storage
CREATE VIRTUAL TABLE memory_vectors USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding FLOAT[1536]  -- For OpenAI ada-002 embeddings
);

-- Or for smaller embeddings (e.g., local models)
CREATE VIRTUAL TABLE memory_vectors USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding FLOAT[384]  -- For MiniLM or similar
);
```

### Vector Search Query

```sql
-- Find k nearest neighbors
SELECT
  memory_id,
  distance
FROM memory_vectors
WHERE embedding MATCH ?  -- Pass embedding vector as parameter
ORDER BY distance
LIMIT 10;
```

---

## Comparison: sqlite-vss vs sqlite-vec

| Feature | sqlite-vss | sqlite-vec |
|---------|------------|------------|
| Status | Deprecated | Active |
| Dependencies | Faiss (C++) | None (pure C) |
| macOS support | x86_64 only | x86_64 + arm64 |
| Linux support | x86_64 only | x86_64 + arm64 |
| Windows support | ❌ | ✅ |
| WASM support | ❌ | ✅ |
| Installation | Complex | Simple |
| Performance | Fast (Faiss) | "Fast enough" |
| Index types | IVF, PQ, etc. | Brute force |

---

## Recommendations

### For This Project

1. **Use `sqlite-vec`** - It's the actively maintained successor
2. **Install via npm** - `npm install sqlite-vec` for automatic platform detection
3. **Use the `load()` helper** - Handles platform-specific paths automatically
4. **Add to db initialization** - Load extension in `lib/db/index.ts` during startup

### Next Steps

1. Add `sqlite-vec` to package.json dependencies
2. Create vector storage schema in `lib/db/schema.ts`
3. Update `lib/db/index.ts` to load the extension
4. Create embedding generation service (integrate with existing Claude client or use local model)
5. Update `lib/db/memory.ts` to support vector similarity search

---

## References

- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [sqlite-vss GitHub](https://github.com/asg017/sqlite-vss) (deprecated)
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3)
- [sqlite-vec npm](https://www.npmjs.com/package/sqlite-vec)
- [sqlite-vss npm](https://www.npmjs.com/package/sqlite-vss)
- [sqlite-vec Node.js documentation](https://alexgarcia.xyz/sqlite-vec/js.html)
