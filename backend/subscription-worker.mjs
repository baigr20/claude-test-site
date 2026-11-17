import { defaultActionStore } from './action-token.mjs'
import { handleGmailCheck } from './gmail-check.mjs'
import { parseSessionInput, buildResult, readJwtClaims } from '../subscription/src/query.js'

const SITE_ORIGIN = 'https://claude.nx.kg'
const CHATGPT = 'https://chatgpt.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAX_BODY_BYTES = 512_000
const OFFICIAL_MANAGE = 'https://chatgpt.com/account/manage'
const APPLE_MANAGE = 'https://apps.apple.com/account/subscriptions'
const GOOGLE_MANAGE = 'https://play.google.com/store/account/subscriptions'
const PORTAL_HOSTS = new Set([
  'chatgpt.com',
  'billing.stripe.com',
  'checkout.stripe.com',
  'pay.openai.com',
  'apps.apple.com',
  'play.google.com'
])
const PATHS = {
  me: '/backend-api/me',
  accounts: '/backend-api/accounts',
  accountCheck: '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480',
  models: '/backend-api/models',
  usage: '/backend-api/wham/usage',
  credits: '/backend-api/wham/rate-limit-reset-credits',
  settings: '/backend-api/settings/user',
  init: '/backend-api/conversation/init',
  subscriptions: '/backend-api/subscriptions',
  invoices: '/backend-api/payments/invoices'
}

export function allowedOrigin(origin) {
  if (!origin) return SITE_ORIGIN
  if (origin === SITE_ORIGIN) return origin
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin
  return ''
}

function corsHeaders(origin) {
  const allow = allowedOrigin(origin)
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin'
  }
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}

export function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) })
}

function secretFrom(env) {
  return typeof env?.ACTION_TOKEN_SECRET === 'string' ? env.ACTION_TOKEN_SECRET : ''
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || !PORTAL_HOSTS.has(url.hostname)) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function chatgptHeaders(session, options = {}) {
  const includeCookie = options.includeCookie === true
  const includeAuth = options.includeAuth !== false
  const jsonBody = options.jsonBody === true
  const headers = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    Origin: CHATGPT,
    Referer: `${CHATGPT}/`,
    'oai-language': 'zh-CN'
  }
  if (includeAuth && session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`
  if (session.accountId) headers['ChatGPT-Account-Id'] = session.accountId
  if (session.deviceId) headers['oai-device-id'] = session.deviceId
  if (includeCookie && session.sessionToken) {
    headers.Cookie = `__Secure-next-auth.session-token=${session.sessionToken}`
  }
  if (jsonBody) headers['Content-Type'] = 'application/json'
  return headers
}

function isChallenge(status, text, contentType) {
  if (status !== 403) return false
  const body = String(text || '')
  const type = String(contentType || '')
  if (/cf-mitigated|just a moment|challenge-platform|attention required|cf-error-details/i.test(body)) return true
  if (/text\/html/i.test(type) && /<html/i.test(body)) return true
  return false
}

function failedPayload(result) {
  const label = result.challenge ? `HTTP ${result.status} challenge` : `HTTP ${result.status || 0}`
  return { _error: label, status: result.status }
}

function applyAccessToken(session, accessToken) {
  const next = String(accessToken || '').trim()
  if (!next) return session
  session.accessToken = next
  const claims = readJwtClaims(next)
  session.claims = claims
  const auth = claims['https://api.openai.com/auth']
  const accountId = auth && typeof auth === 'object'
    ? String(auth.chatgpt_account_id || auth.account_id || '').trim()
    : ''
  if (accountId) session.accountId = accountId
  return session
}

async function chatgptSend(method, path, session, body, options = {}) {
  const headers = chatgptHeaders(session, {
    includeCookie: options.includeCookie === true,
    includeAuth: options.includeAuth !== false,
    jsonBody: body !== undefined
  })
  try {
    const response = await fetch(`${CHATGPT}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    })
    const text = await response.text()
    let data = {}
    if (text) {
      try {
        const parsed = JSON.parse(text)
        data = parsed && typeof parsed === 'object' ? parsed : { items: parsed }
      } catch {
        data = { _error: 'non-json' }
      }
    }
    const challenge = isChallenge(response.status, text, response.headers.get('content-type'))
    if (!response.ok) return { ok: false, status: response.status, data, challenge }
    return { ok: true, status: response.status, data, challenge: false }
  } catch (error) {
    return { ok: false, status: 0, data: { _error: String(error?.message || error) }, challenge: false }
  }
}

async function chatgptSendPreferred(method, path, session, body) {
  if (session.sessionToken) {
    const withCookie = await chatgptSend(method, path, session, body, { includeCookie: true })
    if (withCookie.ok || withCookie.challenge) return withCookie
    if (withCookie.status !== 401 && withCookie.status !== 403) return withCookie
    const tokenOnly = await chatgptSend(method, path, session, body, { includeCookie: false })
    if (tokenOnly.ok || tokenOnly.challenge) return tokenOnly
    return withCookie
  }
  return chatgptSend(method, path, session, body, { includeCookie: false })
}

async function chatgptGet(path, session, includeCookie) {
  const result = await chatgptSend('GET', path, session, undefined, { includeCookie })
  if (!result.ok) return failedPayload(result)
  return result.data
}

async function refreshFromCookie(session) {
  if (!session?.sessionToken) return session
  const result = await chatgptSend('GET', '/api/auth/session', session, undefined, {
    includeCookie: true,
    includeAuth: false
  })
  if (!result.ok) return session
  applyAccessToken(session, result.data?.accessToken)
  return session
}

export async function fetchChatGPT(session) {
  await refreshFromCookie(session)
  const includeCookie = Boolean(session.sessionToken)
  let probe = await chatgptSend('GET', PATHS.me, session, undefined, { includeCookie })
  let mode = includeCookie
  if (!probe.ok && includeCookie && !probe.challenge && (probe.status === 401 || probe.status === 403)) {
    const tokenOnly = await chatgptSend('GET', PATHS.me, session, undefined, { includeCookie: false })
    if (tokenOnly.ok || tokenOnly.challenge) {
      probe = tokenOnly
      mode = false
    }
  }
  if (!probe.ok) {
    const error = failedPayload(probe)
    const fetched = {}
    for (const key of Object.keys(PATHS)) fetched[key] = error
    return fetched
  }
  const fetched = { me: probe.data }
  await Promise.all(Object.entries(PATHS).map(async ([key, path]) => {
    if (key === 'me') return
    fetched[key] = await chatgptGet(path, session, mode)
  }))
  return fetched
}

async function loadSubscription(session) {
  const fetched = await fetchChatGPT(session)
  const result = buildResult(session, fetched, 'proxy')
  result.queryMode = 'proxy'
  return result
}

function publicSubscription(result) {
  return {
    ok: true,
    verified: true,
    subscription: result.subscription
  }
}

async function requestPortal(session) {
  const attempts = [
    ['/backend-api/payments/customer_portal', { return_url: `${CHATGPT}/` }],
    ['/backend-api/payments/billing_portal', { return_url: `${CHATGPT}/` }]
  ]
  for (const [path, body] of attempts) {
    const result = await chatgptSendPreferred('POST', path, session, body)
    const url = safeHttpsUrl(result.data?.url || result.data?.portal_url || result.data?.session?.url)
    if (result.ok && url) return url
  }
  return OFFICIAL_MANAGE
}

function portalForChannel(channel) {
  if (channel === 3) return { url: APPLE_MANAGE, externalPlatform: true }
  if (channel === 2) return { url: GOOGLE_MANAGE, externalPlatform: true }
  return null
}

async function requireSession(payload, env) {
  const token = payload?.actionToken
  const session = await defaultActionStore.read(token, { secret: secretFrom(env) })
  if (!session?.accessToken) return { error: { status: 401, body: { ok: false, message: '查询凭证已失效，请重新查询' } } }
  return { session }
}

function sessionExpired(session) {
  const exp = session?.claims?.exp
  return typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 <= Date.now()
}

function queryFailureMessage(statuses, session) {
  if (statuses.some((status) => status === 'challenge')) {
    return 'ChatGPT 拦截了 Cloudflare 查询节点，会话没有过期；需要把查询放到普通服务器上'
  }
  if (statuses.some((status) => status === 'auth')) {
    if (sessionExpired(session)) return 'Session 无效或已过期，请重新获取'
    if (!session.sessionToken) {
      return 'ChatGPT 拒绝了这份仍在有效期内的 accessToken；请粘贴带 sessionToken 的完整会话后再试'
    }
    return 'ChatGPT 拒绝了这份仍在有效期内的会话，请重新打开会话数据页面后再试'
  }
  return '查询失败，请检查 Session 是否有效'
}

export async function handleQuery(payload, env = {}) {
  const raw = payload?.session && typeof payload.session === 'object' ? payload.session : payload
  const session = parseSessionInput(JSON.stringify(raw || {}))
  const result = await loadSubscription(session)
  const statuses = Object.values(result.accountDiagnostics?.sources || {})
  const anyOk = statuses.some((status) => status === 'ok')
  if (!anyOk) {
    return { ok: false, message: queryFailureMessage(statuses, session) }
  }
  result.actionToken = await defaultActionStore.issue(session, { secret: secretFrom(env) })
  return result
}

export async function handleCancel(payload, env = {}) {
  const found = await requireSession(payload, env)
  if (found.error) return found.error
  const current = await loadSubscription(found.session)
  const external = portalForChannel(current.subscription?.payChannelType)
  if (external) {
    return {
      status: 200,
      body: { ok: true, requiresPortal: true, url: external.url, externalPlatform: true, subscription: current.subscription }
    }
  }
  if (!found.session.accountId) {
    return {
      status: 200,
      body: { ok: true, requiresPortal: true, url: await requestPortal(found.session), subscription: current.subscription }
    }
  }
  const response = await chatgptSendPreferred('POST', '/backend-api/subscriptions/cancel', found.session, {
    account_id: found.session.accountId
  })
  if (!response.ok) {
    return {
      status: 200,
      body: { ok: true, requiresPortal: true, url: await requestPortal(found.session), subscription: current.subscription }
    }
  }
  const verified = await loadSubscription(found.session)
  const subscription = verified.subscription
  if (subscription?.payChannelType === 1 && subscription.autoRenewKnown === true && subscription.autoRenew === false) {
    return { status: 200, body: publicSubscription(verified) }
  }
  return {
    status: 200,
    body: { ok: true, requiresPortal: true, url: await requestPortal(found.session), subscription }
  }
}

export async function handleRenew(payload, env = {}) {
  const found = await requireSession(payload, env)
  if (found.error) return found.error
  const current = await loadSubscription(found.session)
  if (current.subscription?.payChannelType === 2 || current.subscription?.payChannelType === 3) {
    return { status: 400, body: { ok: false, message: '该订阅由应用商店管理，请到原支付平台恢复自动续费' } }
  }
  if (!found.session.accountId) {
    return { status: 400, body: { ok: false, message: '无法解析 account_id，请确认 Session 完整有效' } }
  }
  const response = await chatgptSendPreferred('POST', '/backend-api/subscriptions/resume', found.session, {
    account_id: found.session.accountId
  })
  if (!response.ok) {
    return { status: 502, body: { ok: false, message: '恢复自动续费失败' } }
  }
  const verified = await loadSubscription(found.session)
  const subscription = verified.subscription
  if (subscription?.state === 'active' && subscription.autoRenewKnown === true && subscription.autoRenew === true) {
    return { status: 200, body: publicSubscription(verified) }
  }
  return { status: 502, body: { ok: false, message: '尚未确认自动续费已恢复，请稍后重新查询核对' } }
}

export async function handleLink(payload, env = {}) {
  const found = await requireSession(payload, env)
  if (found.error) return found.error
  const current = await loadSubscription(found.session)
  const external = portalForChannel(current.subscription?.payChannelType)
  if (external) return { status: 200, body: { ok: true, url: external.url, externalPlatform: true } }
  return { status: 200, body: { ok: true, url: await requestPortal(found.session), externalPlatform: false } }
}

export async function handleRelease(payload, env = {}) {
  const token = payload?.actionToken
  if (typeof token === 'string' && token) {
    await defaultActionStore.release(token, { secret: secretFrom(env) })
  }
  return { status: 200, body: { ok: true } }
}

const POST_ROUTES = {
  '/api/subscription/query': async (payload, env) => {
    const result = await handleQuery(payload, env)
    return { status: result.ok ? 200 : 401, body: result }
  },
  '/api/subscription/cancel': handleCancel,
  '/api/subscription/renew': handleRenew,
  '/api/subscription/link': handleLink,
  '/api/action/release': handleRelease,
  '/api/gmail/check': async (payload) => handleGmailCheck(payload)
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin')
    const url = new URL(request.url)
    const path = url.pathname

    if (origin && !allowedOrigin(origin)) {
      return json({ ok: false, message: '来源不允许' }, 403, null)
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowedOrigin(origin) ? 204 : 403, headers: corsHeaders(origin) })
    }
    if (path === '/api/health' && request.method === 'GET') {
      return json({ ok: true, service: 'subscription-query', proxy: true }, 200, origin)
    }
    const route = POST_ROUTES[path]
    if (!route) return json({ ok: false, message: 'Not found' }, 404, origin)
    if (request.method !== 'POST') return json({ ok: false, message: 'Method not allowed' }, 405, origin)
    const length = Number(request.headers.get('content-length') || 0)
    if (length > MAX_BODY_BYTES) return json({ ok: false, message: '请求过大' }, 413, origin)
    let payload
    try {
      payload = await request.json()
    } catch {
      return json({ ok: false, message: '请求必须是 JSON 对象' }, 400, origin)
    }
    try {
      const result = await route(payload, env)
      return json(result.body, result.status, origin)
    } catch (error) {
      const message = String(error?.message || error)
      const status = /缺少 accessToken|格式错误|必须是/.test(message) ? 400 : 502
      return json({ ok: false, message }, status, origin)
    }
  }
}
