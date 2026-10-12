// Players shown in the detail view (PLAN.md 4.7, 8.4). Instagram added on 12.10.2026 (decision).
import type { Embed } from './items.ts'

/** Instagram's official embed for public posts, reels and IGTV (`/p/`, `/reel/`, `/reels/`, `/tv/`). */
export function instagramEmbed(value: string): (Embed & { isVideo: boolean }) | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!/^(www\.)?instagram\.com$/.test(url.hostname)) return null
  const match = /^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]{5,40})\/?/.exec(url.pathname)
  if (!match) return null
  const kind = match[1] === 'reels' ? 'reel' : (match[1] as string)
  return {
    provider: 'instagram',
    embedUrl: `https://www.instagram.com/${kind}/${match[2]}/embed`,
    isVideo: kind !== 'p',
  }
}
