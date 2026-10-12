import { hash, verify } from '@node-rs/argon2'
import { PASSWORD_MIN_LENGTH } from '@wb/shared'

// `Algorithm` is a const enum, which isolated modules cannot import; 2 = Argon2id.
const ARGON2ID = 2
// OWASP recommendation for argon2id: m = 19 MiB, t = 2, p = 1 (PLAN.md 5.12).
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 }

export const PASSWORD_MAX_LENGTH = 200

// Frequently used passwords that pass the length check (lowercase; compared case-insensitively).
const COMMON = new Set([
  '0000000000',
  '0123456789',
  '0987654321',
  '1111111111',
  '1122334455',
  '1234512345',
  '1234567890',
  '12345678910',
  '123456789a',
  '1234567890a',
  '123456789abc',
  '123456789q',
  '1234qwerasdf',
  '1q2w3e4r5t',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  '2222222222',
  '5555555555',
  '9876543210',
  'a123456789',
  'aa12345678',
  'abc1234567',
  'abcd123456',
  'abcdefghij',
  'admin12345',
  'administrator',
  'asdfghjkl1',
  'asdfghjkla',
  'baseball123',
  'changeme123',
  'dragon1234',
  'football123',
  'hallo12345',
  'hallo123456',
  'hallohallo',
  'iloveyou12',
  'letmein123',
  'login12345',
  'master1234',
  'monkey1234',
  'passwort1',
  'passwort12',
  'passwort123',
  'passwort1234',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'passw0rd123',
  'qwerty1234',
  'qwerty12345',
  'qwerty123456',
  'qwertyuiop',
  'qwertz1234',
  'qwertz12345',
  'qwertzuiop',
  'schalke04',
  'sommer2026',
  'starwars12',
  'sunshine12',
  'superman12',
  'welcome123',
  'whiteboard',
  'whiteboard1',
  'whiteboard123',
  'willkommen',
  'willkommen1',
  'willkommen123',
  'winter2026',
  'zxcvbnm123',
])

export type PasswordProblem = 'too_short' | 'too_long' | 'common'

/** Password policy: at least 10 characters, not a common password, not the e-mail/name. */
export function checkPassword(password: string, context: string[] = []): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short'
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long'
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) return 'common'
  if (/^(.)\1+$/.test(password)) return 'common'
  if (context.some((value) => value && lower === value.toLowerCase())) return 'common'
  const localPart = context
    .find((value) => value.includes('@'))
    ?.split('@')[0]
    ?.toLowerCase()
  if (localPart && localPart.length >= 4 && lower === localPart) return 'common'
  return null
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | undefined

/** Burns the same time as a real check, so unknown e-mail addresses are not revealed by timing. */
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing')
  await verifyPassword(await dummyHash, password)
}
