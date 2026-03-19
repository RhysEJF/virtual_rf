/**
 * Eval Script Generator
 *
 * Generates eval.sh scripts from parsed EvolveRecipe objects.
 * Supports two modes:
 * - command: Thin wrapper around a user-specified command
 * - judge: LLM-as-judge scoring via Claude CLI
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, chmodSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { EvolveRecipe } from './recipe-parser';

/**
 * Generate the contents of an eval.sh script from a recipe.
 */
export function generateEvalScript(recipe: EvolveRecipe): string {
  if (recipe.scoring.mode === 'command') {
    return generateCommandEval(recipe);
  }
  return generateJudgeEval(recipe);
}

/**
 * Write eval.sh to a workspace's hidden scoring directory.
 * The .evolve/_scoring/ path keeps eval internals out of the agent's view.
 * Returns the file path.
 */
export function writeEvalToWorkspace(recipe: EvolveRecipe, workspacePath: string): string {
  const script = generateEvalScript(recipe);
  const scoringDir = join(workspacePath, '.evolve', '_scoring');
  mkdirSync(scoringDir, { recursive: true });
  const evalPath = join(scoringDir, 'eval.sh');

  writeFileSync(evalPath, script, 'utf-8');
  chmodSync(evalPath, 0o755);

  // Ensure .gitignore hides .evolve/
  const gitignorePath = join(workspacePath, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  if (!existing.includes('.evolve/')) {
    writeFileSync(gitignorePath, (existing.trimEnd() + '\n.evolve/\n').trimStart());
  }

  // Clean up legacy eval.sh at workspace root
  const legacyPath = join(workspacePath, 'eval.sh');
  if (existsSync(legacyPath)) {
    unlinkSync(legacyPath);
  }

  return evalPath;
}

// ============================================================================
// Command Mode
// ============================================================================

function generateCommandEval(recipe: EvolveRecipe): string {
  const samples = recipe.scoring.samples || 1;
  const command = recipe.scoring.command || 'echo 0';

  if (samples <= 1) {
    return `#!/bin/bash
# Eval script generated from recipe: ${recipe.name}
# Mode: command
# Direction: ${recipe.scoring.direction} is better
set -euo pipefail

RESULT=$(${command})
echo "$RESULT"
`;
  }

  return `#!/bin/bash
# Eval script generated from recipe: ${recipe.name}
# Mode: command (${samples} samples, median)
# Direction: ${recipe.scoring.direction} is better
set -euo pipefail

RESULTS=()
for i in $(seq 1 ${samples}); do
  VAL=$(${command})
  RESULTS+=("$VAL")
done

# Sort and take median
printf '%s\\n' "\${RESULTS[@]}" | sort -n | awk '{a[NR]=$1} END{if(NR%2==1)print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}'
`;
}

// ============================================================================
// Judge Mode
// ============================================================================

function generateJudgeEval(recipe: EvolveRecipe): string {
  const samples = recipe.scoring.samples || 1;
  const artifactFile = recipe.artifact.file;

  // Build the judge prompt
  const criteriaText = recipe.criteria.length > 0
    ? recipe.criteria.map(c => `- ${c.name} (weight ${c.weight}): ${c.description}`).join('\n')
    : '- Overall quality (weight 1): How good is this artifact overall?';

  const examplesText = recipe.examples.length > 0
    ? recipe.examples.map(e => `Example "${e.label}" → score ${e.score}:\n${e.reasoning}`).join('\n\n')
    : '';

  const contextText = recipe.context || '';

  // Escape for shell embedding - use a heredoc approach
  const promptParts = [
    'You are an eval judge. Score the following artifact on a 0-100 scale.',
    '',
    `Artifact description: ${recipe.artifact.description}`,
    '',
    '## Scoring Criteria',
    criteriaText,
  ];

  if (examplesText) {
    promptParts.push('', '## Calibration Examples', examplesText);
  }

  if (contextText) {
    promptParts.push('', '## Context', contextText);
  }

  promptParts.push(
    '',
    '## Artifact Content',
    '```',
    '${ARTIFACT_CONTENT}',
    '```',
    '',
    'Evaluate the artifact against each criterion. Weight your scores according to the weights above.',
    'Output your reasoning briefly, then on the FINAL line output ONLY the numeric score (0-100).',
    'Example final line: 73',
  );

  const prompt = promptParts.join('\n');

  if (samples <= 1) {
    return `#!/bin/bash
# Eval script generated from recipe: ${recipe.name}
# Mode: judge (LLM-as-judge via Claude CLI)
# Direction: ${recipe.scoring.direction} is better
set -euo pipefail

ARTIFACT_FILE="${artifactFile}"

if [ ! -f "$ARTIFACT_FILE" ]; then
  echo "Error: Artifact file not found: $ARTIFACT_FILE" >&2
  exit 1
fi

ARTIFACT_CONTENT=$(cat "$ARTIFACT_FILE")
export ARTIFACT_CONTENT

PROMPT=$(cat <<'PROMPT_END'
${prompt}
PROMPT_END
)

# Substitute artifact content into prompt
PROMPT=$(echo "$PROMPT" | ARTIFACT_CONTENT="$ARTIFACT_CONTENT" envsubst '$ARTIFACT_CONTENT')

# Call Claude CLI (unset CLAUDECODE to avoid nested session error)
RESPONSE=$(CLAUDECODE= claude -p "$PROMPT" --max-turns 1 --output-format text 2>/dev/null)

# Extract the last number from the response
SCORE=$(echo "$RESPONSE" | grep -o '[0-9]\\+' | tail -1)

if [ -z "$SCORE" ]; then
  echo "Error: Could not extract score from judge response" >&2
  echo "Response was: $RESPONSE" >&2
  exit 1
fi

echo "$SCORE"
`;
  }

  return `#!/bin/bash
# Eval script generated from recipe: ${recipe.name}
# Mode: judge (LLM-as-judge via Claude CLI, ${samples} samples, median)
# Direction: ${recipe.scoring.direction} is better
set -euo pipefail

ARTIFACT_FILE="${artifactFile}"

if [ ! -f "$ARTIFACT_FILE" ]; then
  echo "Error: Artifact file not found: $ARTIFACT_FILE" >&2
  exit 1
fi

ARTIFACT_CONTENT=$(cat "$ARTIFACT_FILE")
export ARTIFACT_CONTENT

PROMPT=$(cat <<'PROMPT_END'
${prompt}
PROMPT_END
)

# Substitute artifact content into prompt
PROMPT=$(echo "$PROMPT" | ARTIFACT_CONTENT="$ARTIFACT_CONTENT" envsubst '$ARTIFACT_CONTENT')

RESULTS=()
for i in $(seq 1 ${samples}); do
  RESPONSE=$(CLAUDECODE= claude -p "$PROMPT" --max-turns 1 --output-format text 2>/dev/null)
  SCORE=$(echo "$RESPONSE" | grep -o '[0-9]\\+' | tail -1)
  if [ -n "$SCORE" ]; then
    RESULTS+=("$SCORE")
  fi
done

if [ \${#RESULTS[@]} -eq 0 ]; then
  echo "Error: Could not extract any scores from judge responses" >&2
  exit 1
fi

# Sort and take median
printf '%s\\n' "\${RESULTS[@]}" | sort -n | awk '{a[NR]=$1} END{if(NR%2==1)print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}'
`;
}
