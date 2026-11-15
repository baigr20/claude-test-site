import { parseSessionInput, buildResult } from '../subscription/src/query.js'

const SITE_ORIGIN = 'https://claude.nx.kg'
const CHATGPT = 'https://chatgpt.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAX_BODY_BYTES = 512_000
const PATHS = {
  me: '/backend-api/me',
  accounts: '/backend-api/accounts',
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

async function chatgptGet(path, session) {
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    Origin: CHATGPT,
    Referer: `${CHATGPT}/`,
    'oai-language': 'zh-CN'
  }
  if (session.accountId) headers['ChatGPT-Account-Id'] = session.accountId
  if (session.sessionToken) {
    headers.Cookie = `__Secure-next-auth.session-token=${session.sessionToken}; __Host-next-auth.session-token=${session.sessionToken}`
  }
  try {
    const response = await fetch(`${CHATGPT}${path}`, {
      method: 'GET',
      headers,
      redirect: 'manual'
    })
    if (!response.ok) return { _error: `HTTP ${response.status}`, status: response.status }
    const data = await response.json()
    return data && typeof data === 'object' ? data : { items: data }
  } catch (error) {
    return { _error: String(error?.message || error), status: 0 }
  }
}

export async function fetchChatGPT(session) {
  const fetched = {}
  await Promise.all(Object.entries(PATHS).map(async ([key, path]) => {
    fetched[key] = await chatgptGet(path, session)
  }))
  return fetched
}

export async function handleQuery(payload) {
  const raw = payload?.session && typeof payload.session === 'object' ? payload.session : payload
  const session = parseSessionInput(JSON.stringify(raw || {}))
  const fetched = await fetchChatGPT(session)
  const result = buildResult(session, fetched, 'proxy')
  result.queryMode = 'proxy'
  return result
}

export default {
  async fetch(request) {
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
    if (path !== '/api/subscription/query') {
      return json({ ok: false, message: 'Not found' }, 404, origin)
    }
    if (request.method !== 'POST') {
      return json({ ok: false, message: 'Method not allowed' }, 405, origin)
    }
    const length = Number(request.headers.get('content-length') || 0)
    if (length > MAX_BODY_BYTES) {
      return json({ ok: false, message: '请求过大' }, 413, origin)
    }
    let payload
    try {
      payload = await request.json()
    } catch {
      return json({ ok: false, message: '请求必须是 JSON 对象' }, 400, origin)
    }
    try {
      const result = await handleQuery(payload)
      return json(result, 200, origin)
    } catch (error) {
      const message = String(error?.message || error)
      const status = /缺少 accessToken|格式错误|必须是/.test(message) ? 400 : 502
      return json({ ok: false, message }, status, origin)
    }
  }
}
