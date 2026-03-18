# Evolve Recipe: Code Size

## Artifact
- file: output.ts
- description: TypeScript source file to minimize

## Scoring
- mode: command
- command: wc -c < output.ts
- direction: lower
- budget: 5
- samples: 1

## Criteria
- Size (1.0): Total byte count of the file — smaller is better while maintaining correctness

## Examples
### "Verbose implementation" → 5000
Original unoptimized code with redundant abstractions and excessive comments.

### "Compact implementation" → 1200
Minimal code that achieves the same functionality with no wasted bytes.

## Context
Optimize for code size while maintaining all existing functionality and passing all tests.

## Prerequisites
- output.ts: The source file to optimize
