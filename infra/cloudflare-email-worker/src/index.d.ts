// Types for the tests in apps/server; the worker itself is plain JavaScript.
type WorkerEnv = { INGEST_URL: string; INGEST_TOKEN: string; FALLBACK_FORWARD?: string }
type WorkerMessage = {
  from: string
  to: string
  raw: ReadableStream
  setReject: (reason: string) => void
  forward: (to: string, headers?: Headers) => Promise<void>
}
declare const worker: { email: (message: WorkerMessage, env: WorkerEnv) => Promise<void> }
export default worker
