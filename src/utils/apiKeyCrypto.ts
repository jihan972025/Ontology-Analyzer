/**
 * API Key Encryption Utility
 *
 * Uses SHA-256 for key derivation + AES-256-GCM for authenticated encryption.
 * - Salt is randomly generated per machine and stored in localStorage.
 * - Encrypted format: "enc:<base64(iv)>:<base64(ciphertext)>"
 * - Plaintext values (legacy) are auto-migrated on next save.
 */

const APP_SECRET = 'ontology-analyzer-v1-sha256-secret'
const SALT_STORAGE_KEY = 'ontology-analyzer-crypto-salt'

// ── helpers ──────────────────────────────────────────────────────────

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

// ── salt ─────────────────────────────────────────────────────────────

function getSalt(): Uint8Array {
  let saltB64 = localStorage.getItem(SALT_STORAGE_KEY)
  if (!saltB64) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    saltB64 = toBase64(salt)
    localStorage.setItem(SALT_STORAGE_KEY, saltB64)
  }
  return fromBase64(saltB64)
}

// ── key derivation (SHA-256) ─────────────────────────────────────────

async function deriveKey(): Promise<CryptoKey> {
  const salt = getSalt()
  const encoder = new TextEncoder()
  const material = encoder.encode(APP_SECRET + toBase64(salt))
  const hash = await crypto.subtle.digest('SHA-256', material)
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

// ── public API ───────────────────────────────────────────────────────

/**
 * Encrypt a plaintext API key.
 * Returns `enc:<iv>:<ciphertext>` or empty string for empty input.
 */
export async function encryptApiKey(plaintext: string): Promise<string> {
  if (!plaintext) return ''
  const key = await deriveKey()
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV for GCM
  const encoder = new TextEncoder()
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  )
  return `enc:${toBase64(iv)}:${toBase64(cipherBuf)}`
}

/**
 * Decrypt a stored API key.
 * - If it starts with `enc:`, decrypt with AES-GCM.
 * - Otherwise return as-is (legacy plaintext migration).
 */
export async function decryptApiKey(stored: string): Promise<string> {
  if (!stored) return ''
  if (!stored.startsWith('enc:')) return stored // plaintext (legacy)

  try {
    const parts = stored.split(':')
    if (parts.length !== 3) return stored
    const iv = fromBase64(parts[1])
    const ciphertext = fromBase64(parts[2])
    const key = await deriveKey()
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
      key,
      ciphertext as unknown as ArrayBuffer,
    )
    return new TextDecoder().decode(plainBuf)
  } catch (e) {
    console.error('[Crypto] Failed to decrypt API key:', e)
    return '' // corrupted → treat as empty
  }
}

/**
 * Check whether a stored value is already encrypted.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith('enc:')
}
