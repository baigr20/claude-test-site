const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const DEFAULT_TTL_MS = 15 * 60 * 1000

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function randomHex(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sessionSlice(session) {
  return {
    accessToken: String(session?.accessToken || ''),
    sessionToken: String(session?.sessionToken || ''),
    accountId: String(session?.accountId || ''),
    deviceId: String(session?.deviceId || ''),
    refreshToken: String(session?.refreshToken || '')
  }
}

async function keyFromSecret(secret) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function createActionStore() {
  const memory = new Map()
  const revoked = new Map()

  function prune(now) {
    for (const [token, value] of memory) {
      if (value.exp <= now) memory.delete(token)
    }
    for (const [jti, exp] of revoked) {
      if (exp <= now) revoked.delete(jti)
    }
  }

  async function readSealed(token, secret, now) {
    try {
      const packed = base64UrlToBytes(token)
      if (packed.length < 29) return null
      const iv = packed.slice(0, 12)
      const cipher = packed.slice(12)
      const key = await keyFromSecret(secret)
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
      const data = JSON.parse(textDecoder.decode(plain))
      if (!data?.accessToken || !Number.isFinite(data.exp) || data.exp <= now) return null
      if (data.jti && revoked.has(data.jti)) return null
      return {
        accessToken: String(data.accessToken),
        sessionToken: String(data.sessionToken || ''),
        accountId: String(data.accountId || ''),
        deviceId: String(data.deviceId || ''),
        refreshToken: String(data.refreshToken || ''),
        jti: String(data.jti || ''),
        exp: data.exp
      }
    } catch {
      return null
    }
  }

  return {
    async issue(session, options = {}) {
      const now = options.now ?? Date.now()
      const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
      const secret = options.secret || ''
      const sliced = sessionSlice(session)
      if (!sliced.accessToken) throw new Error('缺少 accessToken')
      if (secret) {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const key = await keyFromSecret(secret)
        const plain = textEncoder.encode(JSON.stringify({
          exp: now + ttlMs,
          jti: randomHex(16),
          ...sliced
        }))
        const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
        const packed = new Uint8Array(iv.length + cipher.length)
        packed.set(iv, 0)
        packed.set(cipher, iv.length)
        return bytesToBase64Url(packed)
      }
      const token = randomHex(24)
      memory.set(token, { exp: now + ttlMs, session: sliced })
      prune(now)
      return token
    },

    async read(token, options = {}) {
      if (typeof token !== 'string' || token.length < 24) return null
      const now = options.now ?? Date.now()
      const secret = options.secret || ''
      if (secret) return readSealed(token, secret, now)
      const stored = memory.get(token)
      if (!stored || stored.exp <= now) {
        memory.delete(token)
        return null
      }
      return { ...stored.session, jti: '', exp: stored.exp }
    },

    async release(token, options = {}) {
      const now = options.now ?? Date.now()
      const secret = options.secret || ''
      if (!secret) {
        memory.delete(token)
        return
      }
      try {
        const packed = base64UrlToBytes(token)
        const iv = packed.slice(0, 12)
        const cipher = packed.slice(12)
        const key = await keyFromSecret(secret)
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
        const data = JSON.parse(textDecoder.decode(plain))
        if (data?.jti) revoked.set(data.jti, Number(data.exp) || now + DEFAULT_TTL_MS)
      } catch {
        // An unknown token has nothing to revoke.
      }
      prune(now)
    }
  }
}

export const defaultActionStore = createActionStore()
