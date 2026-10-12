import dns from 'node:dns'
import net from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent, type Dispatcher, request } from 'undici'

// Server-side fetching of foreign URLs (PLAN.md 8.2): http/https on ports 80/443 only, every
// resolved address must be public unicast, the checked address is the one connected to (no DNS
// rebinding), redirects are followed manually and re-checked, strict timeouts and size limits.

export class BlockedError extends Error {
  override name = 'BlockedError'
}

export class TooLargeError extends Error {
  override name = 'TooLargeError'
}

type LookupAddress = { address: string; family: number }
export type Lookup = (hostname: string) => Promise<LookupAddress[]>

export type SafeFetchOptions = {
  maxBytes: number
  accept?: string
  /** Tests only: replace DNS resolution. */
  lookup?: Lookup
  /** Tests only: additionally allowed addresses (e.g. a local test server). */
  allowAddress?: (address: string) => boolean
  /** Tests only: additionally allowed ports. */
  allowPorts?: number[]
  timeoutMs?: number
}

export type SafeResponse = { url: string; status: number; contentType: string; body: Buffer }

const MAX_REDIRECTS = 5
const CONNECT_TIMEOUT_MS = 5_000
const TOTAL_TIMEOUT_MS = 15_000

export const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
}

const systemLookup: Lookup = async (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true })

/** True only for public unicast addresses; IPv4-mapped IPv6 is checked as IPv4. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  let parsed = ipaddr.parse(address)
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address()
  }
  return parsed.range() === 'unicast'
}

function checkAddresses(addresses: LookupAddress[], options: SafeFetchOptions) {
  if (addresses.length === 0) throw new BlockedError('no address')
  for (const { address } of addresses) {
    if (!isPublicAddress(address) && !options.allowAddress?.(address)) {
      throw new BlockedError(`address not allowed: ${address}`)
    }
  }
}

function checkUrl(url: URL, options: SafeFetchOptions) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedError('protocol not allowed')
  if (url.username || url.password) throw new BlockedError('credentials in URL')
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (port !== 80 && port !== 443 && !options.allowPorts?.includes(port)) throw new BlockedError('port not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // IP literals never go through DNS lookup, so they are checked here.
  if (net.isIP(host)) checkAddresses([{ address: host, family: net.isIP(host) }], options)
}

/** An undici agent whose DNS lookup refuses non-public addresses; the checked IP is used to connect. */
function createAgent(options: SafeFetchOptions): Agent {
  const lookup = options.lookup ?? systemLookup
  return new Agent({
    connect: {
      timeout: CONNECT_TIMEOUT_MS,
      lookup: (hostname, lookupOptions, callback) => {
        lookup(hostname).then(
          (addresses) => {
            try {
              checkAddresses(addresses, options)
            } catch (error) {
              callback(error as Error, '', 0)
              return
            }
            const wanted = (lookupOptions as { all?: boolean }).all
            if (wanted) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses)
            else callback(null, addresses[0]?.address ?? '', addresses[0]?.family ?? 4)
          },
          (error: Error) => callback(error, '', 0),
        )
      },
    },
  })
}

async function readLimited(body: Dispatcher.ResponseData['body'], maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of body) {
    size += (chunk as Buffer).length
    if (size > maxBytes) {
      body.destroy()
      throw new TooLargeError(`more than ${maxBytes} bytes`)
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const agent = createAgent(options)
  const signal = AbortSignal.timeout(options.timeoutMs ?? TOTAL_TIMEOUT_MS)
  try {
    let url = new URL(rawUrl)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      checkUrl(url, options)
      const response = await request(url, {
        method: 'GET',
        dispatcher: agent,
        signal,
        headers: { ...BROWSER_HEADERS, accept: options.accept ?? '*/*' },
      })
      const location = response.headers.location
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        await response.body.dump()
        url = new URL(Array.isArray(location) ? (location[0] ?? '') : location, url)
        continue
      }
      const length = Number(response.headers['content-length'] ?? 0)
      if (length > options.maxBytes) {
        response.body.destroy()
        throw new TooLargeError(`content-length ${length}`)
      }
      const contentType = String(response.headers['content-type'] ?? '')
      return {
        url: url.href,
        status: response.statusCode,
        contentType,
        body: await readLimited(response.body, options.maxBytes),
      }
    }
    throw new BlockedError('too many redirects')
  } finally {
    await agent.close()
  }
}
