import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BlockedError, isPublicAddress, type Lookup, safeFetch, TooLargeError } from '../src/lib/safeFetch.ts'

// A local server stands in for "the internet": tests map public-looking names to it and allow
// exactly its address and port. Everything else must be blocked like in production (PLAN.md 8.2).
describe('safeFetch', () => {
  let server: http.Server
  let port: number
  let lookups = 0

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect-private') {
        res.writeHead(302, { location: 'http://10.0.0.1/' }).end()
      } else if (req.url === '/redirect-ok') {
        res.writeHead(301, { location: '/page' }).end()
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' }).end()
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('x'.repeat(5000))
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>Hallo</title>')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  // "public.test" resolves to the local test server, which is the only allowed private address.
  const lookup: Lookup = async (hostname) => {
    lookups += 1
    if (hostname === 'public.test') return [{ address: '127.0.0.1', family: 4 }]
    if (hostname === 'mixed.test')
      return [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.190', family: 4 },
      ]
    if (hostname === 'v6.test') return [{ address: '::1', family: 6 }]
    if (hostname === 'mapped.test') return [{ address: '::ffff:127.0.0.1', family: 6 }]
    throw new Error('ENOTFOUND')
  }
  const testOptions = {
    maxBytes: 1000,
    lookup,
    allowAddress: (address: string) => address === '127.0.0.1',
    allowPorts: [] as number[],
  }
  const options = () => ({ ...testOptions, allowPorts: [port] })

  it('fetches from an allowed host', async () => {
    const res = await safeFetch(`http://public.test:${port}/`, options())
    expect(res.status).toBe(200)
    expect(res.body.toString()).toContain('Hallo')
  })

  it('follows redirects and re-checks every hop', async () => {
    const ok = await safeFetch(`http://public.test:${port}/redirect-ok`, options())
    expect(ok.url).toBe(`http://public.test:${port}/page`)
    await expect(safeFetch(`http://public.test:${port}/redirect-private`, options())).rejects.toThrow(BlockedError)
    await expect(safeFetch(`http://public.test:${port}/loop`, options())).rejects.toThrow(/too many redirects/)
  })

  it('blocks private, loopback and link-local targets', async () => {
    const plain = { maxBytes: 1000, lookup }
    for (const url of [
      'http://127.0.0.1/',
      'http://10.1.2.3/',
      'http://192.168.1.190:80/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[::ffff:192.168.1.1]/',
      'http://[fd00::1]/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
    ]) {
      await expect(safeFetch(url, plain), url).rejects.toThrow(BlockedError)
    }
  })

  it('blocks names that resolve to non-public addresses (also only partly)', async () => {
    const plain = { maxBytes: 1000, lookup, allowPorts: [port] }
    await expect(safeFetch(`http://public.test:${port}/`, plain)).rejects.toThrow(BlockedError)
    await expect(safeFetch('http://mixed.test/', plain)).rejects.toThrow(BlockedError)
    await expect(safeFetch('http://v6.test/', plain)).rejects.toThrow(BlockedError)
    await expect(safeFetch('http://mapped.test/', plain)).rejects.toThrow(BlockedError)
  })

  it('resolves once, at connect time, and connects to exactly the checked address', async () => {
    // A rebinding DNS server would answer differently on a second query; there is none.
    let calls = 0
    const counting: Lookup = async (hostname) => {
      calls += 1
      return lookup(hostname === 'pin.test' ? 'public.test' : hostname)
    }
    const res = await safeFetch(`http://pin.test:${port}/`, { ...options(), lookup: counting })
    expect(res.body.toString()).toContain('Hallo')
    expect(calls).toBe(1)
  })

  it('allows only http/https on ports 80 and 443', async () => {
    await expect(safeFetch('ftp://public.test/', options())).rejects.toThrow(BlockedError)
    await expect(safeFetch('file:///etc/passwd', options())).rejects.toThrow(BlockedError)
    await expect(safeFetch('http://public.test:8080/', { ...testOptions })).rejects.toThrow(/port/)
    await expect(safeFetch('http://user:pw@public.test/', options())).rejects.toThrow(BlockedError)
  })

  it('enforces the size limit', async () => {
    await expect(safeFetch(`http://public.test:${port}/big`, options())).rejects.toThrow(TooLargeError)
  })

  it('classifies addresses', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    expect(isPublicAddress('172.16.5.4')).toBe(false)
    expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false)
    expect(isPublicAddress('fe80::1')).toBe(false)
    expect(isPublicAddress('not-an-ip')).toBe(false)
    expect(lookups).toBeGreaterThan(0)
  })
})
