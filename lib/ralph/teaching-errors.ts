import { getAttempts } from '../db/attempts';
import { getLatestCheckpoint } from '../db/checkpoints';

export function buildTeachingContext(taskId: string): string {
  const attempts = getAttempts(taskId);
  const checkpoint = getLatestCheckpoint(taskId);

  if (attempts.length === 0 && !checkpoint) {
    return '';
  }

  const sections: string[] = [];

  if (attempts.length > 0) {
    sections.push('## Previous Attempts (Learn from these failures)\n');
    sections.push('**IMPORTANT**: Previous attempts at this task have failed. Study the failures below and use a DIFFERENT approach.\n');

    for (const attempt of attempts) {
      sections.push(`### Attempt ${attempt.attempt_number}`);
      if (attempt.approach_summary) {
        sections.push(`**Approach tried**: ${attempt.approach_summary}`);
      }
      if (attempt.failure_reason) {
        sections.push(`**Why it failed**: ${attempt.failure_reason}`);
      }
      if (attempt.error_output) {
        sections.push(`**Error output**:\n\`\`\`\n${attempt.error_output}\n\`\`\``);
      }
      if (attempt.files_modified) {
        try {
          const files = JSON.parse(attempt.files_modified);
          sections.push(`**Files modified**: ${files.join(', ')}`);
        } catch {
          // ignore parse error
        }
      }
      sections.push('');
    }

    sections.push('**Do NOT repeat the same approaches listed above. Try something fundamentally different.**\n');
  }

  if (checkpoint) {
    sections.push('## Previous Progress (Resume from here)\n');
    if (checkpoint.progress_summary) {
      sections.push(`**What was completed**: ${checkpoint.progress_summary}`);
    }
    if (checkpoint.remaining_work) {
      sections.push(`**What still needs to be done**: ${checkpoint.remaining_work}`);
    }
    if (checkpoint.files_modified) {
      try {
        const files = JSON.parse(checkpoint.files_modified);
        sections.push(`**Files already modified**: ${files.join(', ')}`);
      } catch {
        // ignore parse error
      }
    }
    if (checkpoint.git_sha) {
      sections.push(`**Checkpoint commit**: ${checkpoint.git_sha}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
