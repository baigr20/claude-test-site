const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const SUPPORTED_ALGORITHMS = Object.freeze(['SHA1', 'SHA256', 'SHA512'])
const WEB_CRYPTO_ALGORITHMS = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512'
}
const DEFAULTS = Object.freeze({
  algorithm: 'SHA1',
  digits: 6,
  period: 30
})
const MIN_PERIOD = 15
const MAX_PERIOD = 120
const MIN_DIGITS = 6
const MAX_DIGITS = 8

export { SUPPORTED_ALGORITHMS, DEFAULTS, MIN_PERIOD, MAX_PERIOD, MIN_DIGITS, MAX_DIGITS }

export function normalizeBase32(input) {
  return String(input ?? '')
    .trim()
    .replace(/[\s-]/g, '')
    .replace(/=+$/g, '')
    .toUpperCase()
}

export function decodeBase32(input) {
  const raw = normalizeBase32(input)
  if (!raw) throw new Error('请输入 Base32 密钥，或完整的 otpauth:// 链接')
  if (!/^[A-Z2-7]+$/.test(raw)) {
    throw new Error('密钥不是有效的 Base32（仅支持 A–Z 和 2–7，可含空格或连字符）')
  }
  let bits = ''
  for (const char of raw) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  if (!bytes.length) throw new Error('密钥太短')
  return Uint8Array.from(bytes)
}

export function encodeBase32(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  let bits = ''
  for (const byte of data) bits += byte.toString(2).padStart(8, '0')
  const leftover = bits.length % 5
  if (leftover) bits += '0'.repeat(5 - leftover)
  let out = ''
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32_ALPHABET[Number.parseInt(bits.slice(i, i + 5), 2)]
  }
  return out
}

export function normalizeAlgorithm(value, fallback = DEFAULTS.algorithm) {
  if (value == null || value === '') return fallback
  const normalized = String(value).trim().toUpperCase().replace(/-/g, '')
  if (!SUPPORTED_ALGORITHMS.includes(normalized)) {
    throw new Error(`只支持 ${SUPPORTED_ALGORITHMS.join('、')}，不支持 ${value}`)
  }
  return normalized
}

export function normalizeDigits(value, fallback = DEFAULTS.digits) {
  if (value == null || value === '') return fallback
  const digits = Number(value)
  if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
    throw new Error(`位数只支持 ${MIN_DIGITS} 或 ${MAX_DIGITS}`)
  }
  return digits
}

export function normalizePeriod(value, fallback = DEFAULTS.period) {
  if (value == null || value === '') return fallback
  const period = Number(value)
  if (!Number.isInteger(period) || period < MIN_PERIOD || period > MAX_PERIOD) {
    throw new Error(`时间窗口只支持 ${MIN_PERIOD}–${MAX_PERIOD} 秒`)
  }
  return period
}

export function parseOtpauth(uri) {
  const text = String(uri ?? '').trim()
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error('otpauth 链接格式无效')
  }
  if (url.protocol !== 'otpauth:') throw new Error('只支持 otpauth:// 链接')
  const type = url.hostname.toLowerCase() || url.pathname.replace(/^\/+/, '').split('/')[0]?.toLowerCase()
  if (type !== 'totp') throw new Error('只支持 otpauth://totp/，不支持 HOTP 或其他类型')
  const secret = url.searchParams.get('secret')
  if (!secret) throw new Error('otpauth 链接缺少 secret')
  const labelPath = url.pathname.replace(/^\/+/, '')
  const label = decodeURIComponent(labelPath.replace(/^totp\//i, ''))
  return {
    kind: 'otpauth',
    label: label || '',
    issuer: url.searchParams.get('issuer') || '',
    secretBytes: decodeBase32(secret),
    secret: normalizeBase32(secret),
    algorithm: normalizeAlgorithm(url.searchParams.get('algorithm')),
    digits: normalizeDigits(url.searchParams.get('digits')),
    period: normalizePeriod(url.searchParams.get('period'))
  }
}

export function parseTotpInput(input) {
  const text = String(input ?? '').trim()
  if (!text) throw new Error('请输入 Base32 密钥，或完整的 otpauth:// 链接')
  if (/^otpauth:/i.test(text)) return parseOtpauth(text)
  if (text.includes('|')) {
    throw new Error('本工具只接受 Base32 密钥或 otpauth:// 链接，请不要粘贴账号、密码或其他字段')
  }
  if (/^https?:/i.test(text)) {
    throw new Error('请粘贴 otpauth:// 链接或 Base32 密钥，不要粘贴普通网页地址')
  }
  const secret = normalizeBase32(text)
  return {
    kind: 'secret',
    label: '',
    issuer: '',
    secretBytes: decodeBase32(secret),
    secret,
    algorithm: DEFAULTS.algorithm,
    digits: DEFAULTS.digits,
    period: DEFAULTS.period
  }
}

export function counterAt(timestampMs, period = DEFAULTS.period) {
  return Math.floor(Math.floor(timestampMs / 1000) / period)
}

export function remainingSeconds(timestampMs, period = DEFAULTS.period) {
  const elapsed = Math.floor(timestampMs / 1000) % period
  return elapsed === 0 ? period : period - elapsed
}

function counterBytes(counter) {
  const bytes = new Uint8Array(8)
  let value = Number(counter)
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = value & 0xff
    value = Math.floor(value / 256)
  }
  return bytes
}

function dynamicTruncate(hmac) {
  const offset = hmac[hmac.length - 1] & 0x0f
  return (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  )
}

export async function generateTotpFromBytes(secretBytes, options = {}) {
  const algorithm = normalizeAlgorithm(options.algorithm)
  const digits = normalizeDigits(options.digits)
  const period = normalizePeriod(options.period)
  const timestampMs = options.timestampMs ?? Date.now()
  const counter = options.counter ?? counterAt(timestampMs, period)
  const cryptoObj = options.crypto ?? globalThis.crypto
  if (!cryptoObj?.subtle) throw new Error('当前环境不支持 WebCrypto')
  const key = await cryptoObj.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: WEB_CRYPTO_ALGORITHMS[algorithm] },
    false,
    ['sign']
  )
  const hmacBuffer = await cryptoObj.subtle.sign('HMAC', key, counterBytes(counter))
  const code = dynamicTruncate(new Uint8Array(hmacBuffer)) % (10 ** digits)
  return {
    code: String(code).padStart(digits, '0'),
    algorithm,
    digits,
    period,
    counter,
    remaining: remainingSeconds(timestampMs, period),
    timestampMs
  }
}

export async function generateTotpFromInput(input, options = {}) {
  const parsed = parseTotpInput(input)
  const result = await generateTotpFromBytes(parsed.secretBytes, {
    ...parsed,
    ...options,
    algorithm: options.algorithm ?? parsed.algorithm,
    digits: options.digits ?? parsed.digits,
    period: options.period ?? parsed.period
  })
  return { ...parsed, ...result }
}
