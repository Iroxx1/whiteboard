import { createHash, createPrivateKey, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cookieOf, PUBLIC_URL, post, setupAdmin, startApp, type TestApp } from './helpers.ts'

const RP_ID = new URL(PUBLIC_URL).hostname
const b64 = (data: Uint8Array | Buffer) => Buffer.from(data).toString('base64url')
const sha256 = (data: Uint8Array | Buffer | string) => createHash('sha256').update(data).digest()

/** A tiny software authenticator (ES256, "none" attestation) standing in for a phone. */
function virtualAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const credentialId = randomBytes(32)
  let counter = 0
  const coseKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]),
  )
  const clientData = (type: string, challenge: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: PUBLIC_URL, crossOrigin: false }))
  const counterBytes = () => {
    const bytes = Buffer.alloc(4)
    bytes.writeUInt32BE(counter)
    return bytes
  }

  return {
    id: b64(credentialId),
    create(challenge: string) {
      const idLength = Buffer.alloc(2)
      idLength.writeUInt16BE(credentialId.length)
      // flags: user present, user verified, attested credential data
      const authData = Buffer.concat([
        sha256(RP_ID),
        Buffer.from([0x45]),
        counterBytes(),
        Buffer.alloc(16),
        idLength,
        credentialId,
        coseKey,
      ])
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, never>>([
          ['fmt', 'none'],
          ['attStmt', new Map<string, never>()],
          ['authData', authData],
        ]),
      )
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64(clientData('webauthn.create', challenge)),
          attestationObject: b64(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
      }
    },
    get(challenge: string, key = privateKey) {
      counter += 1
      const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), counterBytes()])
      const data = clientData('webauthn.get', challenge)
      const signature = createSign('sha256')
        .update(Buffer.concat([authData, sha256(data)]))
        .sign(key)
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: 'public-key',
        response: { clientDataJSON: b64(data), authenticatorData: b64(authData), signature: b64(signature) },
        clientExtensionResults: {},
      }
    },
    otherKey: () =>
      createPrivateKey(
        generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }),
      ),
  }
}

describe('passkeys', () => {
  let test: TestApp
  let cookie: string
  const phone = virtualAuthenticator()

  beforeAll(async () => {
    test = await startApp()
    cookie = await setupAdmin(test)
  })

  afterAll(async () => {
    await test.app.close()
  })

  const loginOptions = async () =>
    (await post(test.app, '/api/auth/passkey/options', {})).json<{
      challengeId: string
      options: { challenge: string }
    }>()

  it('registers a passkey for the signed-in user', async () => {
    const options = await post(test.app, '/api/me/passkeys/options', {}, cookie)
    expect(options.statusCode).toBe(200)
    expect(options.json().rp).toMatchObject({ id: RP_ID })
    expect(options.json().authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    })

    const created = await post(
      test.app,
      '/api/me/passkeys',
      { name: 'Pixel', response: phone.create(options.json().challenge) },
      cookie,
    )
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ name: 'Pixel', lastUsedAt: null })

    const list = await test.app.inject({ url: '/api/me/passkeys', headers: { cookie } })
    expect(list.json()).toHaveLength(1)
  })

  it('does not accept a registration without a fresh challenge or with a wrong one', async () => {
    const options = await post(test.app, '/api/me/passkeys/options', {}, cookie)
    const wrong = await post(
      test.app,
      '/api/me/passkeys',
      { name: 'Fremd', response: virtualAuthenticator().create(randomBytes(32).toString('base64url')) },
      cookie,
    )
    expect(wrong.statusCode).toBe(400)
    // The challenge is gone after one attempt.
    const again = await post(
      test.app,
      '/api/me/passkeys',
      { name: 'Fremd', response: virtualAuthenticator().create(options.json().challenge) },
      cookie,
    )
    expect(again.statusCode).toBe(400)
  })

  it('signs in with the passkey and counts uses', async () => {
    const { challengeId, options } = await loginOptions()
    const res = await post(test.app, '/api/auth/passkey/login', { challengeId, response: phone.get(options.challenge) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ email: 'admin@example.test', role: 'admin' })
    const me = await test.app.inject({ url: '/api/auth/me', headers: { cookie: cookieOf(res) } })
    expect(me.statusCode).toBe(200)

    const second = await loginOptions()
    const again = await post(test.app, '/api/auth/passkey/login', {
      challengeId: second.challengeId,
      response: phone.get(second.options.challenge),
    })
    expect(again.statusCode).toBe(200)
    const list = await test.app.inject({ url: '/api/me/passkeys', headers: { cookie } })
    expect(list.json()[0].lastUsedAt).toBeGreaterThan(0)
  })

  it('refuses replays, forged signatures and unknown challenges', async () => {
    const { challengeId, options } = await loginOptions()
    const forged = await post(test.app, '/api/auth/passkey/login', {
      challengeId,
      response: phone.get(options.challenge, phone.otherKey()),
    })
    expect(forged.statusCode).toBe(401)
    // The challenge was used up by the failed attempt.
    const replay = await post(test.app, '/api/auth/passkey/login', {
      challengeId,
      response: phone.get(options.challenge),
    })
    expect(replay.statusCode).toBe(401)
    const unknown = await post(test.app, '/api/auth/passkey/login', {
      challengeId: 'does-not-exist-at-all',
      response: phone.get(options.challenge),
    })
    expect(unknown.statusCode).toBe(401)
  })

  it('needs a session to manage passkeys and stops working after removal', async () => {
    expect((await test.app.inject({ url: '/api/me/passkeys' })).statusCode).toBe(401)
    expect((await post(test.app, '/api/me/passkeys/options', {})).statusCode).toBe(401)

    const [key] = (await test.app.inject({ url: '/api/me/passkeys', headers: { cookie } })).json<{ id: string }[]>()
    const removed = await test.app.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${key?.id}`,
      headers: { cookie, 'sec-fetch-site': 'same-origin' },
    })
    expect(removed.statusCode).toBe(204)
    const { challengeId, options } = await loginOptions()
    const res = await post(test.app, '/api/auth/passkey/login', { challengeId, response: phone.get(options.challenge) })
    expect(res.statusCode).toBe(401)
  })
})
