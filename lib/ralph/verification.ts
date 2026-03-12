import { execSync } from 'child_process';

export interface VerificationResult {
  passed: boolean;
  output: string;
  durationMs: number;
}

export function runVerification(taskId: string, command: string, workspacePath: string): VerificationResult {
  const startTime = Date.now();

  try {
    const output = execSync(command, {
      cwd: workspacePath,
      timeout: 60000, // 60s default
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      passed: true,
      output: (output || '').slice(-2000),
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    const output = [execError.stdout || '', execError.stderr || ''].filter(Boolean).join('\n');

    return {
      passed: false,
      output: output.slice(-2000),
      durationMs: Date.now() - startTime,
    };
  }
}
