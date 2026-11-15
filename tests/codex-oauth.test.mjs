import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  CODEX_AUTH_ENDPOINT,
  CODEX_CLIENT_ID,
  CODEX_REDIRECT_URI,
  CODEX_TOKEN_ENDPOINT,
  buildCodexAuthRequest,
  buildCodeChallenge,
  clearAllCodexPkce,
  exchangeCodexCode,
  readCodexCallbackError,
  readCodexCodeCallback,
  resolveCodexCodeCallbackInput,
  tokenResponseToConversionInput
} from '../sub-cpa/src/codex-oauth.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function memoryStorage() {
  const data = new Map()
  return {
    get length() { return data.size },
    key(index) { return [...data.keys()][index] ?? null },
    getItem(key) { return data.has(key) ? data.get(key) : null },
    setItem(key, value) { data.set(String(key), String(value)) },
    removeItem(key) { data.delete(key) }
  }
}

test('builds official authorize URLs with unique PKCE state and S256 challenge', async () => {
  const storage = memoryStorage()
  const seen = new Set()
  const requests = []
  for (let index = 0; index < 8; index += 1) {
    const request = await buildCodexAuthRequest({ storage })
    requests.push(request)
    const url = new URL(request.url)
    assert.equal(`${url.origin}${url.pathname}`, CODEX_AUTH_ENDPOINT)
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('client_id'), CODEX_CLIENT_ID)
    assert.equal(url.searchParams.get('redirect_uri'), CODEX_REDIRECT_URI)
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('scope'), 'openid profile email offline_access')
    assert.equal(url.searchParams.get('state'), request.oauthState)
    assert.equal(url.searchParams.get('code_challenge'), await buildCodeChallenge(request.codeVerifier))
    assert.ok(!request.url.includes('client_secret'))
    const fingerprint = `${request.oauthState}:${request.codeVerifier}:${request.codeChallenge}`
    assert.equal(seen.has(fingerprint), false)
    seen.add(fingerprint)
  }
  assert.equal(requests.length, 8)
})

test('parses localhost callback code/state and official error messages', () => {
  const callback = readCodexCodeCallback('Open this: http://localhost:1455/auth/callback?code=demo-code-not-real&state=demo-state-abc#ignored')
  assert.deepEqual(callback, { code: 'demo-code-not-real', state: 'demo-state-abc' })
  assert.equal(readCodexCodeCallback('https://example.test/?foo=1'), null)
  const message = readCodexCallbackError('http://localhost:1455/auth/callback?error=access_denied&error_description=user%20cancelled&state=demo-state-abc')
  assert.match(message, /官方授权未完成/)
  assert.match(message, /user cancelled/)
})

test('rejects missing verifier and mismatched state without calling the token endpoint', async () => {
  const storage = memoryStorage()
  const request = await buildCodexAuthRequest({ storage, oauthState: 'state-current', codeVerifier: 'verifier-current' })
  let fetches = 0
  const fetchImpl = async () => { fetches += 1; return { ok: true, json: async () => ({}) } }

  await assert.rejects(
    () => exchangeCodexCode({ code: 'demo-code-not-real', state: 'state-other' }, {
      storage,
      currentState: request.oauthState,
      currentVerifier: request.codeVerifier,
      fetch: fetchImpl
    }),
    /state 与当前登录会话不一致/
  )

  await assert.rejects(
    () => exchangeCodexCode({ code: 'demo-code-not-real', state: 'state-current' }, {
      storage: memoryStorage(),
      currentState: '',
      currentVerifier: '',
      fetch: fetchImpl
    }),
    /找不到对应的 code_verifier/
  )
  assert.equal(fetches, 0)
})

test('exchanges a fictional code via a mocked official token endpoint and feeds conversion JSON', async () => {
  const storage = memoryStorage()
  const request = await buildCodexAuthRequest({ storage, oauthState: 'state-ok', codeVerifier: 'verifier-ok-not-real' })
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      json: async () => ({
        token_type: 'Bearer',
        expires_in: 3600,
        access_token: 'at-demo-not-a-real-token',
        refresh_token: 'rt-demo-not-a-real-token',
        id_token: 'id-demo-not-a-real-token',
        scope: 'openid profile email offline_access'
      })
    }
  }

  const input = await resolveCodexCodeCallbackInput(
    `http://localhost:1455/auth/callback?code=demo-code-not-real&state=${request.oauthState}`,
    {
      storage,
      currentState: request.oauthState,
      currentVerifier: request.codeVerifier,
      fetch: fetchImpl,
      now: () => Date.parse('2026-11-15T08:00:00.000Z')
    }
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, CODEX_TOKEN_ENDPOINT)
  assert.equal(calls[0].init.method, 'POST')
  const body = String(calls[0].init.body)
  assert.match(body, /grant_type=authorization_code/)
  assert.match(body, /code=demo-code-not-real/)
  assert.match(body, /code_verifier=verifier-ok-not-real/)
  assert.doesNotMatch(body, /client_secret/)

  const parsed = JSON.parse(input)
  assert.equal(parsed.type, 'codex')
  assert.equal(parsed.refresh_token, 'rt-demo-not-a-real-token')
  assert.equal(parsed.session_source, 'codex_oauth_code')
  assert.equal(parsed.client_id, CODEX_CLIENT_ID)
  assert.equal(parsed.expires_at, '2026-11-15T09:00:00.000Z')
  assert.equal(storage.length, 0)
})

test('surfaces official token error payloads and missing refresh tokens', async () => {
  const storage = memoryStorage()
  const request = await buildCodexAuthRequest({ storage, oauthState: 'state-err', codeVerifier: 'verifier-err' })
  await assert.rejects(
    () => exchangeCodexCode({ code: 'demo-code-not-real', state: request.oauthState }, {
      storage,
      currentState: request.oauthState,
      currentVerifier: request.codeVerifier,
      fetch: async () => ({
        ok: false,
        statusText: 'Unauthorized',
        json: async () => ({ error: { message: 'Could not validate your token. Please try signing in again.' } })
      })
    }),
    /换票失败：Could not validate your token/
  )

  await assert.rejects(
    () => exchangeCodexCode({ code: 'demo-code-not-real', state: request.oauthState }, {
      storage,
      currentState: request.oauthState,
      currentVerifier: request.codeVerifier,
      fetch: async () => ({
        ok: true,
        json: async () => ({ access_token: 'at-demo-not-a-real-token' })
      })
    }),
    /没有返回 refresh_token/
  )
})

test('frontend only talks to official OAuth hosts for login, and still omits third-party account APIs', () => {
  const files = [
    'sub-cpa/src/app.js',
    'sub-cpa/src/codex-oauth.js',
    'sub-cpa/index.html',
    'index.html',
    'assets/home.js',
    'assets/theme.js'
  ].map((rel) => readFileSync(path.join(root, rel), 'utf8')).join('\n')

  for (const needle of [
    'workbench-storage',
    'protocol-login',
    'aasfa.xgrok',
    '/api/order-cards',
    '/api/local-health',
    '/api/account-chat'
  ]) {
    assert.equal(files.includes(needle), false, needle)
  }
  assert.match(files, /https:\/\/auth\.openai\.com\/oauth\/authorize/)
  assert.match(files, /https:\/\/auth\.openai\.com\/oauth\/token/)
  assert.doesNotMatch(readFileSync(path.join(root, 'sub-cpa/src/app.js'), 'utf8'), /looksLikeCodeOnlyCallback/)
  assert.match(readFileSync(path.join(root, 'sub-cpa/index.html'), 'utf8'), /打开授权/)
  assert.match(readFileSync(path.join(root, 'sub-cpa/index.html'), 'utf8'), /本页只在浏览器本地生成授权链接，不上传 token/)
})
