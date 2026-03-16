// Use Web Crypto API (available in Workers) for password hashing
// We use PBKDF2 since bcrypt is not natively available in Workers

const ITERATIONS = 100_000
const KEY_LENGTH = 32

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH * 8
  )
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await deriveKey(password, salt)
  return `${toHex(salt)}:${toHex(derived)}`
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(':')
  const salt = fromHex(saltHex)
  const derived = new Uint8Array(await deriveKey(password, salt))
  const expected = fromHex(keyHex)
  if (derived.length !== expected.length) return false
  // Constant-time comparison to prevent timing attacks
  let diff = 0
  for (let i = 0; i < derived.length; i++) {
    diff |= derived[i]! ^ expected[i]!
  }
  return diff === 0
}
