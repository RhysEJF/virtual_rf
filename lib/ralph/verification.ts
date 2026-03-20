import { execFile } from 'child_process';

export interface VerificationResult {
  passed: boolean;
  output: string;
  durationMs: number;
}

function tokenizeCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped || inSingle || inDouble) return null;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function runVerification(taskId: string, command: string, workspacePath: string): Promise<VerificationResult> {
  const startTime = Date.now();
  const trimmed = command.trim();

  // Verify commands should be deterministic and shell-free.
  // Block shell control operators so we can execute with execFile safely.
  if (/[;&|`$><\n\r]/.test(trimmed)) {
    return Promise.resolve({
      passed: false,
      output: `Invalid verify_command for task ${taskId}: shell operators are not allowed`,
      durationMs: Date.now() - startTime,
    });
  }

  const tokens = tokenizeCommand(trimmed);
  if (!tokens || tokens.length === 0) {
    return Promise.resolve({
      passed: false,
      output: `Invalid verify_command for task ${taskId}: could not parse command`,
      durationMs: Date.now() - startTime,
    });
  }

  const [file, ...args] = tokens;

  return new Promise((resolve) => {
    execFile(file, args, {
      cwd: workspacePath,
      timeout: 60000, // 60s default
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB
      shell: false,
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;

      if (error) {
        const output = [stdout || '', stderr || ''].filter(Boolean).join('\n');
        resolve({
          passed: false,
          output: output.slice(-2000),
          durationMs,
        });
      } else {
        resolve({
          passed: true,
          output: (stdout || '').slice(-2000),
          durationMs,
        });
      }
    });
  });
}
