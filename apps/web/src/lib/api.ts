import type { ShareReport } from '@wb/shared'

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status)
  return (await response.json()) as T
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

export const api = {
  access: () => fetch('/api/debug/access').then((res) => json<{ ok: boolean }>(res)),
  reports: () => fetch('/api/debug/share').then((res) => json<{ reports: ShareReport[] }>(res)),
  report: (id: string) => fetch(`/api/debug/share/${encodeURIComponent(id)}`).then((res) => json<ShareReport>(res)),
  sendShare: (form: FormData) =>
    fetch('/api/debug/share', { method: 'POST', body: form }).then((res) => json<ShareReport>(res)),
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`
  return `${(size / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
}
