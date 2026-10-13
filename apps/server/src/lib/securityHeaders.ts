import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Pages that may be shown in iframes (PLAN.md 8.4): the item detail embeds (YouTube, Vimeo,
 * Spotify, Instagram – STATUS.md 12.10.2026) and Excalidraw's own embeddable sites.
 */
export const FRAME_SOURCES = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://player.vimeo.com',
  'https://open.spotify.com',
  'https://www.instagram.com',
  'https://www.figma.com',
  'https://link.excalidraw.com',
  'https://codesandbox.io',
  'https://stackblitz.com',
  'https://www.val.town',
  'https://giphy.com',
  'https://embed.reddit.com',
]

/** Content Security Policy for the app (PLAN.md 8.4). */
export const APP_CSP = [
  "default-src 'self'",
  // Excalidraw subsets fonts with WebAssembly when exporting.
  "script-src 'self' 'wasm-unsafe-eval'",
  // Excalidraw sets inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  `frame-src ${FRAME_SOURCES.join(' ')}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'report-uri /api/csp-report',
].join('; ')

export const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'interest-cohort=()',
  // Fullscreen for the video embeds in the item details.
  'fullscreen=(self "https://www.youtube-nocookie.com" "https://www.youtube.com" "https://player.vimeo.com")',
].join(', ')

/**
 * Security headers on every response (PLAN.md 8.4). Uploaded files bring their own sandbox CSP
 * (files/routes.ts) and keep it. HSTS is set by Cloudflare.
 */
export async function securityHeaders(_request: FastifyRequest, reply: FastifyReply) {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', PERMISSIONS_POLICY)
  reply.header('X-Frame-Options', 'DENY')
  reply.header('Cross-Origin-Opener-Policy', 'same-origin')
  if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', APP_CSP)
}
