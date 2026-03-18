# Evolve Recipe: Test Pass Rate

## Artifact
- file: src/index.ts
- description: Source code under test

## Scoring
- mode: command
- command: npm test 2>&1 | grep -oP '\d+(?= passing)' || echo 0
- direction: higher
- budget: 7
- samples: 1

## Criteria
- Pass Count (1.0): Number of tests passing — higher means more correct behavior

## Examples
### "Broken implementation" → 3
Only basic tests pass, most edge cases fail.

### "Solid implementation" → 25
All unit tests and integration tests pass.

## Context
Fix failing tests by improving the source code. Do not modify test files.

## Prerequisites
- src/index.ts: The source code to fix
- package.json: Must have a test script configured
