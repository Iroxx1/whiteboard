// Phase 0 (Spike A): summary of what the Android share sheet delivered.

export type SharedFileInfo = {
  name: string
  type: string
  size: number
}

export type ShareReport = {
  id: string
  receivedAt: string
  via: 'service-worker' | 'server-fallback'
  title: string | null
  text: string | null
  url: string | null
  files: SharedFileInfo[]
  userAgent: string | null
}
