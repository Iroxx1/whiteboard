export {}

// Used by the Docker HEALTHCHECK; exits non-zero when /healthz does not answer with 200.
const port = process.env.PORT ?? '3000'

try {
  const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4000) })
  process.exit(res.ok ? 0 : 1)
} catch {
  process.exit(1)
}
