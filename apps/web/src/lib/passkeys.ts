import type { Me } from '@wb/shared'
import { api } from './api.ts'

/** The browser library is loaded on demand: most visits never touch passkeys. */
const library = () => import('@simplewebauthn/browser')

export async function passkeysSupported(): Promise<boolean> {
  try {
    return (await library()).browserSupportsWebAuthn()
  } catch {
    return false
  }
}

/** The user closed the system dialog (or it timed out): not an error worth showing. */
export const isCancelled = (error: unknown) =>
  error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')

/** Sign in with a passkey; resolves with the user, rejects when cancelled or refused. */
export async function signInWithPasskey(): Promise<Me> {
  const { startAuthentication } = await library()
  const { challengeId, options } = await api.passkeyLoginOptions()
  const response = await startAuthentication({ optionsJSON: options })
  return api.passkeyLogin({ challengeId, response })
}

/** Registers a passkey for the signed-in user. */
export async function addPasskey(name: string) {
  const { startRegistration } = await library()
  const optionsJSON = await api.passkeyRegisterOptions()
  const response = await startRegistration({ optionsJSON })
  return api.passkeyRegister({ name, response })
}
