import { execFile } from 'node:child_process';

export interface ExecResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  /** stdout exceeded `maxBuffer` and was cut. */
  overflow: boolean;
  /** The binary could not be started at all. */
  spawnFailed: boolean;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

/** Runs a binary without a shell and never rejects; failures are reported in the result. */
export function exec(command: string, args: readonly string[], options: ExecOptions): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        encoding: 'buffer',
        windowsHide: true,
        env: { ...process.env, ...options.env },
      },
      (error, stdout, stderr) => {
        const errorCode = (error as (NodeJS.ErrnoException & { code?: string | number }) | null)?.code;
        const overflow = errorCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        const exitCode = error === null ? 0 : typeof errorCode === 'number' ? errorCode : null;
        resolve({
          code: exitCode,
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
          stderr: (Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '')).trim(),
          overflow,
          spawnFailed: errorCode === 'ENOENT' || errorCode === 'EACCES',
        });
      },
    );
  });
}
