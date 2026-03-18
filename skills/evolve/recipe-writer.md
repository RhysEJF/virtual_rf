# Recipe Writer Skill

You are writing an eval recipe for Flow's evolve mode. Eval recipes are structured markdown documents that define:

1. **What** to optimize (the artifact)
2. **How** to judge it (criteria, examples, scoring mode)
3. **How much** to invest (budget, samples)

## Recipe Format

```markdown
# Evolve Recipe: <Name>

## Artifact
- file: <path to the file being optimized>
- description: <what this file is and its purpose>

## Scoring
- mode: judge | command
- command: <shell command, only for mode: command>
- direction: higher | lower
- budget: <max iterations, typically 3-7>
- samples: <how many times to run eval per iteration, typically 1-3>

## Criteria
- <Name> (<weight>): <Description of what to look for>

## Examples
### "<Label>" → <score>
<Reasoning for why this example gets this score>

## Context
<Free text with additional context the judge needs>

## Prerequisites
- <file>: <description>
```

## Choosing Scoring Mode

- **`judge`**: Use when output quality is subjective or multi-dimensional (writing, design, UX copy, marketing). Claude evaluates the artifact against your criteria.
- **`command`**: Use when quality is measurable (test pass rate, benchmark time, file size, lint errors). Runs a shell command that outputs a number.

## Writing Good Criteria

1. **3-5 criteria** is the sweet spot. Too few = blunt evaluation. Too many = noise.
2. **Weights should sum to ~1.0** for interpretability.
3. **Be specific**: "Clear variable names and consistent style" beats "Code quality".
4. **Make criteria independent**: Each should measure something different.
5. **Include a negative criterion** when relevant (e.g., "Verbosity (0.15): Penalize unnecessary length").

## Writing Calibration Examples

Good examples anchor the judge's scoring:

1. **Include at least 2**: one low-scoring, one high-scoring.
2. **Use realistic labels** that describe what the example represents.
3. **Reasoning should reference your criteria** so the judge understands the mapping.
4. **Spread scores across the range**: Don't cluster all examples at 80-90.

## Budget Guidelines

| Task Complexity | Recommended Budget |
|----------------|-------------------|
| Simple tweak    | 3                 |
| Content polish  | 5                 |
| Algorithm opt   | 7                 |
| Multi-file work | 5-10              |

## Samples

- **1 sample**: Fine for deterministic command evals
- **3 samples**: Recommended for judge mode (reduces LLM scoring variance)
- **5+ samples**: Only for high-stakes evals where precision matters

## Common Patterns

### Content/Writing Optimization
```markdown
## Scoring
- mode: judge
- direction: higher
- budget: 5
- samples: 3

## Criteria
- Clarity (0.3): Easy to understand on first read
- Persuasiveness (0.25): Compels the reader to take action
- Conciseness (0.25): Says what it needs to without wasted words
- Tone (0.2): Matches the target audience and brand voice
```

### Code Performance Optimization
```markdown
## Scoring
- mode: command
- command: node benchmark.js | tail -1
- direction: lower
- budget: 7
- samples: 3
```

### Test Coverage Optimization
```markdown
## Scoring
- mode: command
- command: npm test -- --coverage 2>&1 | grep 'All files' | awk '{print $10}' | tr -d '%'
- direction: higher
- budget: 5
- samples: 1
```
