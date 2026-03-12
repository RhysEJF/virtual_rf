import { exec } from 'child_process';

export interface VerificationResult {
  passed: boolean;
  output: string;
  durationMs: number;
}

export function runVerification(taskId: string, command: string, workspacePath: string): Promise<VerificationResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: workspacePath,
      timeout: 60000, // 60s default
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB
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

    // Safety: kill if still running after timeout + buffer
    setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }, 65000);
  });
}
