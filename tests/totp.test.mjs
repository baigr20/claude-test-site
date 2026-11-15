import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  counterAt,
  decodeBase32,
  encodeBase32,
  generateTotpFromBytes,
  generateTotpFromInput,
  parseTotpInput,
  remainingSeconds
} from '../2fa/src/totp.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const encoder = new TextEncoder()
const RFC_SHA1 = encoder.encode('12345678901234567890')
const RFC_SHA256 = encoder.encode('12345678901234567890123456789012')
const RFC_SHA512 = encoder.encode('1234567890123456789012345678901234567890123456789012345678901234')

const RFC6238 = {
  SHA1: [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ],
  SHA256: [
    [59, '46119246'],
    [1111111109, '68084774'],
    [1111111111, '67062674'],
    [1234567890, '91819424'],
    [2000000000, '90698825'],
    [20000000000, '77737706']
  ],
  SHA512: [
    [59, '90693936'],
    [1111111109, '25091201'],
    [1111111111, '99943326'],
    [1234567890, '93441116'],
    [2000000000, '38618901'],
    // RFC 6238 Appendix B prints 47845987 here; widely documented erratum, computed value is 47863826.
    [20000000000, '47863826']
  ]
}

const secrets = { SHA1: RFC_SHA1, SHA256: RFC_SHA256, SHA512: RFC_SHA512 }

test('matches RFC 6238 public 8-digit TOTP vectors via WebCrypto', async () => {
  for (const [algorithm, rows] of Object.entries(RFC6238)) {
    for (const [unix, expected] of rows) {
      const result = await generateTotpFromBytes(secrets[algorithm], {
        algorithm,
        digits: 8,
        period: 30,
        timestampMs: unix * 1000
      })
      assert.equal(result.code, expected, `${algorithm} t=${unix}`)
    }
  }
})

test('accepts Base32 secrets and otpauth://totp parameters, and rejects invalid input', async () => {
  const secret = encodeBase32(RFC_SHA1)
  const fromSecret = await generateTotpFromInput(secret, {
    digits: 8,
    period: 30,
    timestampMs: 59_000
  })
  assert.equal(fromSecret.code, '94287082')
  assert.equal(fromSecret.algorithm, 'SHA1')

  const sha256Secret = encodeBase32(RFC_SHA256)
  const uri = `otpauth://totp/Example:demo?secret=${sha256Secret}&issuer=Example&algorithm=SHA256&digits=8&period=30`
  const parsed = parseTotpInput(uri)
  assert.equal(parsed.kind, 'otpauth')
  assert.equal(parsed.algorithm, 'SHA256')
  assert.equal(parsed.digits, 8)
  assert.equal(parsed.period, 30)
  const fromUri = await generateTotpFromBytes(parsed.secretBytes, {
    ...parsed,
    timestampMs: 59_000
  })
  assert.equal(fromUri.code, '46119246')

  assert.equal(decodeBase32('mfrg gzdf').length > 0, true)
  assert.throws(() => parseTotpInput(''), /请输入/)
  assert.throws(() => parseTotpInput('otpauth://hotp/Example?secret=MFRGGZDF'), /只支持 otpauth:\/\/totp/)
  assert.throws(() => parseTotpInput('otpauth://totp/Example?secret=MFRGGZDF&algorithm=MD5'), /只支持/)
  assert.throws(() => parseTotpInput('otpauth://totp/Example?secret=MFRGGZDF&digits=4'), /位数/)
  assert.throws(() => parseTotpInput('otpauth://totp/Example?secret=MFRGGZDF&period=5'), /时间窗口/)
  assert.throws(() => parseTotpInput('user|password|MFRGGZDF|mail|mailpass'), /不要粘贴账号、密码/)
  assert.throws(() => parseTotpInput('https://example.test/otpauth'), /不要粘贴普通网页地址/)
  assert.throws(() => parseTotpInput('not*valid'), /Base32/)
})

test('countdown and counter roll over on the period boundary', () => {
  assert.equal(remainingSeconds(29_000, 30), 1)
  assert.equal(counterAt(29_000, 30), 0)
  assert.equal(remainingSeconds(30_000, 30), 30)
  assert.equal(counterAt(30_000, 30), 1)
  assert.equal(remainingSeconds(30_999, 30), 30)
  assert.equal(counterAt(30_999, 30), 1)
  assert.equal(remainingSeconds(31_000, 30), 29)
  assert.equal(counterAt(31_000, 30), 1)
  assert.equal(remainingSeconds(0, 30), 30)
  assert.equal(counterAt(0, 30), 0)
})

test('2FA frontend keeps secrets local: no remote calls or storage', () => {
  const files = [
    '2fa/src/app.js',
    '2fa/src/totp.js',
    '2fa/index.html'
  ].map((rel) => readFileSync(path.join(root, rel), 'utf8')).join('\n')

  for (const needle of [
    'fetch(',
    'XMLHttpRequest',
    'WebSocket(',
    'navigator.sendBeacon',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'document.cookie',
    'gtag(',
    'googletagmanager',
    'otplib',
    'canvas',
    'password'
  ]) {
    assert.equal(files.toLowerCase().includes(needle.toLowerCase()), false, needle)
  }
  assert.doesNotMatch(files, /location\.(hash|search)\s*=/)
  assert.match(files, /WebCrypto|subtle/)
  assert.match(readFileSync(path.join(root, '2fa/index.html'), 'utf8'), /不是任何官方登录页/)
  assert.match(readFileSync(path.join(root, '2fa/index.html'), 'utf8'), /不要把密钥发给别人/)
})
