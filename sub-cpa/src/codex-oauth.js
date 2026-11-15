// Official OpenAI Codex OAuth + PKCE helpers. Public client config
// matches the published api.aideal.vip/sub-cpa/ page. No client secret.

export const CODEX_AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize'
export const CODEX_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback'
export const CODEX_SCOPE = 'openid profile email offline_access'
export const CODEX_AUDIENCE = 'https://api.openai.com/v1'
export const CODEX_PKCE_STORAGE_PREFIX = 'nx-toolbox:codex-pkce:'

function firstString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

export function pruneEmpty(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  )
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value)
}

function base64UrlFromBytes(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  let base64 = ''
  if (typeof btoa === 'function') {
    base64 = btoa(binary)
  } else {
    const buf = Buffer.from(bytes)
    base64 = buf.toString('base64')
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits))
}

function sha256Bytes(inputBytes) {
  const initialHash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ])
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ])
  const bitLength = inputBytes.length * 8
  const paddedLength = Math.ceil((inputBytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(inputBytes)
  padded[inputBytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength, false)
  const hash = new Uint32Array(initialHash)
  const words = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3)
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10)
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }
  const output = new Uint8Array(32)
  const outputView = new DataView(output.buffer)
  hash.forEach((part, index) => outputView.setUint32(index * 4, part, false))
  return output
}

export function randomBase64Url(byteLength, randomBytes = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)) {
  const bytes = new Uint8Array(byteLength)
  if (typeof randomBytes === 'function') {
    randomBytes(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return base64UrlFromBytes(bytes)
}

export async function buildCodeChallenge(codeVerifier) {
  const bytes = utf8Bytes(codeVerifier)
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return base64UrlFromBytes(new Uint8Array(digest))
  }
  return base64UrlFromBytes(sha256Bytes(bytes))
}

export function pkceStorageKey(oauthState) {
  return `${CODEX_PKCE_STORAGE_PREFIX}${oauthState}`
}

export function saveCodexPkce(oauthState, codeVerifier, storage = globalThis.localStorage, now = Date.now) {
  if (!oauthState || !codeVerifier || !storage) return
  try {
    storage.setItem(pkceStorageKey(oauthState), JSON.stringify({
      codeVerifier,
      createdAt: now()
    }))
  } catch {
    // Memory still holds the verifier for this page session.
  }
}

export function readCodexCodeVerifier(oauthState, { currentState = '', currentVerifier = '', storage = globalThis.localStorage } = {}) {
  if (oauthState && oauthState === currentState && currentVerifier) {
    return currentVerifier
  }
  if (!oauthState || !storage) return ''
  try {
    const raw = storage.getItem(pkceStorageKey(oauthState))
    if (!raw) return ''
    const payload = JSON.parse(raw)
    return firstString(payload?.codeVerifier)
  } catch {
    return ''
  }
}

export function clearCodexPkce(oauthState, storage = globalThis.localStorage) {
  if (!oauthState || !storage) return
  try {
    storage.removeItem(pkceStorageKey(oauthState))
  } catch {
    // Clearing is best-effort.
  }
}

export function clearAllCodexPkce(storage = globalThis.localStorage) {
  if (!storage) return
  try {
    const keys = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && key.startsWith(CODEX_PKCE_STORAGE_PREFIX)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch {
    // Clearing is best-effort.
  }
}

export async function buildCodexAuthRequest(options = {}) {
  const codeVerifier = options.codeVerifier || randomBase64Url(48, options.randomBytes)
  const oauthState = options.oauthState || randomBase64Url(24, options.randomBytes)
  const codeChallenge = options.codeChallenge || await buildCodeChallenge(codeVerifier)
  const url = new URL(options.authEndpoint || CODEX_AUTH_ENDPOINT)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', options.clientId || CODEX_CLIENT_ID)
  url.searchParams.set('redirect_uri', options.redirectUri || CODEX_REDIRECT_URI)
  url.searchParams.set('scope', options.scope || CODEX_SCOPE)
  url.searchParams.set('audience', options.audience || CODEX_AUDIENCE)
  url.searchParams.set('state', oauthState)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', options.originator || 'nx_toolbox_sub_cpa')
  saveCodexPkce(oauthState, codeVerifier, options.storage, options.now)
  return {
    url: url.toString(),
    codeVerifier,
    oauthState,
    codeChallenge
  }
}

export function readCodexCallbackError(input) {
  const parsed = readCallbackParams(input)
  for (const params of parsed) {
    const error = firstString(params.get('error'))
    if (!error) continue
    const description = firstString(params.get('error_description'), params.get('errorDescription'), error)
    return `OpenAI 官方授权未完成：${description}。请重新点击“登录 Codex”，在官方页面完成授权后再把新的回调链接粘贴回来。`
  }
  return ''
}

export function readCodexCodeCallback(input) {
  for (const params of readCallbackParams(input)) {
    const error = firstString(params.get('error'))
    const code = firstString(params.get('code'))
    const oauthState = firstString(params.get('state'))
    if (error || !code || !oauthState) continue
    return { code, state: oauthState }
  }
  return null
}

function readCallbackParams(input) {
  const text = String(input ?? '').replace(/&amp;/g, '&').trim()
  if (!text) return []
  const candidates = text.match(/https?:\/\/[^\s"'<>]+/g) || [text]
  const list = []
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, 'http://localhost')
      const merged = new URLSearchParams(url.search)
      if (url.hash) {
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
        hashParams.forEach((value, key) => {
          if (!merged.has(key)) merged.set(key, value)
        })
      }
      list.push(merged)
    } catch {
      if (candidate.includes('=')) {
        list.push(new URLSearchParams(candidate.replace(/^[?#]/, '')))
      }
    }
  }
  return list
}

export async function exchangeCodexCode(callback, options = {}) {
  if (!callback?.code || !callback?.state) {
    throw new Error('回调里缺少 code 或 state。请复制官方授权后地址栏中的完整链接。')
  }

  const currentState = firstString(options.currentState)
  if (currentState && callback.state !== currentState && !options.allowStoredState) {
    // Still accept a stored verifier for this exact state (same browser, page refreshed).
  }
  if (currentState && callback.state !== currentState) {
    const stored = readCodexCodeVerifier(callback.state, options)
    if (!stored) {
      throw new Error('回调中的 state 与当前登录会话不一致，已拒绝换票。请重新点击“登录 Codex”，授权后把同一次的回调链接粘贴回来。')
    }
  }

  const codeVerifier = readCodexCodeVerifier(callback.state, options)
  if (!codeVerifier) {
    throw new Error('检测到授权 code，但找不到对应的 code_verifier。请在本页重新点击“登录 Codex”，完成官方授权后不要清空本站数据，再把新的回调链接粘贴回来。')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: options.clientId || CODEX_CLIENT_ID,
    code: callback.code,
    redirect_uri: options.redirectUri || CODEX_REDIRECT_URI,
    code_verifier: codeVerifier
  })

  const fetchImpl = options.fetch || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前环境没有 fetch，无法向官方 token 接口换票。')
  }

  let response
  try {
    response = await fetchImpl(options.tokenEndpoint || CODEX_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })
  } catch {
    throw new Error('浏览器无法连接 OpenAI 官方 token 接口，可能被跨域或网络策略拦截。请重新点击“登录 Codex”后再试。')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = firstString(
      payload?.error_description,
      payload?.error?.message,
      payload?.message,
      typeof payload?.error === 'string' ? payload.error : '',
      response.statusText,
      '换取刷新令牌失败'
    )
    throw new Error(`Codex 授权 code 换票失败：${message}`)
  }

  if (!payload?.refresh_token) {
    throw new Error('官方 token 接口没有返回 refresh_token，无法生成账号。请重新登录 Codex 再试。')
  }

  clearCodexPkce(callback.state, options.storage)
  return payload
}

export function tokenResponseToConversionInput(token, options = {}) {
  const expiresAt = Number.isFinite(Number(token.expires_in))
    ? new Date((options.now || Date.now)() + Number(token.expires_in) * 1000).toISOString()
    : ''
  return JSON.stringify(pruneEmpty({
    type: 'codex',
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    id_token: token.id_token,
    expired: expiresAt,
    expires_at: expiresAt,
    token_type: token.token_type,
    scope: token.scope,
    client_id: options.clientId || CODEX_CLIENT_ID,
    session_source: 'codex_oauth_code'
  }), null, 2)
}

export async function resolveCodexCodeCallbackInput(input, options = {}) {
  const authError = readCodexCallbackError(input)
  if (authError) throw new Error(authError)

  const callback = readCodexCodeCallback(input)
  if (!callback) return input

  const cache = options.cache || { key: '', input: '' }
  const cacheKey = `${callback.state}:${callback.code}`
  if (cache.key === cacheKey && cache.input) return cache.input

  const token = await exchangeCodexCode(callback, options)
  const conversionInput = tokenResponseToConversionInput(token, options)
  if (options.cache) {
    options.cache.key = cacheKey
    options.cache.input = conversionInput
  }
  return conversionInput
}
