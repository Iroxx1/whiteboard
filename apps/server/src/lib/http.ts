import type { ApiErrorCode } from '@wb/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import type { Config } from '../config.ts'

export function sendError(reply: FastifyReply, status: number, error: ApiErrorCode, extra: object = {}) {
  return reply.code(status).send({ error, ...extra })
}

/** Validates input with zod; on failure sends 400 and returns undefined. */
export function parseBody<S extends z.ZodType>(schema: S, value: unknown, reply: FastifyReply): z.infer<S> | undefined {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  sendError(reply, 400, 'invalid', { fields: result.error.issues.map((issue) => issue.path.join('.')) })
  return undefined
}

export function isAddressIn(address: string | undefined, list: string[]): boolean {
  if (!address) return false
  const plain = address.replace(/^::ffff:/, '')
  return list.includes(plain) || list.includes(address)
}

/**
 * Client IP (PLAN.md 5.12): `CF-Connecting-IP` is only trusted when the request comes straight from
 * a configured proxy (the Cloudflare connector); otherwise Fastify's `request.ip`.
 */
export function clientIp(request: FastifyRequest, config: Config): string {
  const cf = request.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf.length <= 64 && isAddressIn(request.socket.remoteAddress, config.TRUSTED_PROXIES)) {
    return cf
  }
  return request.ip
}

export const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store')
