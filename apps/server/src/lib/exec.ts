import { execFile } from 'node:child_process'

export type ToolOptions = { timeoutMs: number; maxBuffer?: number }

/**
 * Runs an external tool (ffmpeg, poppler …) as a child process with a timeout; on Linux with
 * `nice -n 10` so the web app stays responsive (PLAN.md 5.5).
 */
export function runTool(command: string, args: string[], options: ToolOptions): Promise<Buffer> {
  const [file, fileArgs] = process.platform === 'linux' ? ['nice', ['-n', '10', command, ...args]] : [command, args]
  return new Promise((resolve, reject) => {
    execFile(
      file,
      fileArgs,
      {
        encoding: 'buffer',
        timeout: options.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.toString('utf8').trim().split('\n').slice(-3).join(' ')
          reject(new Error(`${command} failed: ${error.message}${detail ? ` (${detail.slice(0, 300)})` : ''}`))
          return
        }
        resolve(stdout)
      },
    )
  })
}
