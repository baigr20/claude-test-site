import assert from 'node:assert/strict'
import test from 'node:test'
import { createActionStore } from './action-token.mjs'
import worker, { allowedOrigin, handleQuery, json } from './subscription-worker.mjs'

function jwtWith(payload) {
  const header = Buffer.from('{"alg":"none"}').toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

const demoToken = jwtWith({
  email: 'demo@example.com',
  exp: 2000000000,
  'https://api.openai.com/auth': {
    chatgpt_account_id: 'acc-1',
    chatgpt_plan_type: 'plus'
  }
})

test('allows the toolbox origin and local preview', () => {
  assert.equal(allowedOrigin('https://claude.nx.kg'), 'https://claude.nx.kg')
  assert.equal(allowedOrigin('http://127.0.0.1:8765'), 'http://127.0.0.1:8765')
  assert.equal(allowedOrigin('https://evil.example'), '')
})

test('health and query routes respond without logging tokens', async () => {
  const health = await worker.fetch(new Request('https://claude.nx.kg/api/health', {
    headers: { origin: 'https://claude.nx.kg' }
  }))
  assert.equal(health.status, 200)
  const healthBody = await health.json()
  assert.equal(healthBody.ok, true)
  assert.equal(healthBody.proxy, true)

  const missing = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/query', {
    method: 'POST',
    headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
    body: JSON.stringify({})
  }))
  assert.equal(missing.status, 400)
  const missingBody = await missing.json()
  assert.equal(missingBody.ok, false)
  assert.match(missingBody.message, /accessToken/)
})

test('sends the session cookie first, refreshes via /api/auth/session, and keeps a live token distinct from expiry', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const sessionCookie = '__Secure-next-auth.session-token=session-secret-value'
  globalThis.fetch = async (url, init) => {
    const headers = init?.headers || {}
    calls.push({
      url: String(url),
      cookie: headers.Cookie || '',
      device: headers['oai-device-id'] || '',
      auth: headers.Authorization || ''
    })
    if (!headers.Cookie) return Response.json({ detail: 'Unauthorized' }, { status: 401 })
    if (String(url).includes('/api/auth/session')) {
      return Response.json({ accessToken: demoToken, user: { email: 'demo@example.com' } })
    }
    if (String(url).includes('/backend-api/me')) return Response.json({ email: 'demo@example.com', name: 'Demo' })
    return Response.json({})
  }
  try {
    const live = await handleQuery({
      session: {
        accessToken: demoToken,
        sessionToken: 'session-secret-value',
        statsigContext: { deviceId: 'device-1' }
      }
    })
    assert.equal(live.ok, true)
    assert.equal(live.accountDiagnostics.sources.me, 'ok')
    assert.equal(calls[0]?.url.includes('/api/auth/session'), true)
    assert.equal(calls[0]?.cookie, sessionCookie)
    assert.equal(calls[0]?.auth, '')
    const backend = calls.filter((call) => call.url.includes('/backend-api/'))
    assert.equal(backend[0]?.url.includes('/backend-api/me'), true)
    assert.equal(backend[0]?.cookie, sessionCookie)
    assert.equal(backend[0]?.device, 'device-1')
    assert.match(backend[0]?.auth, /^Bearer /)
    assert.equal(backend.every((call) => call.cookie === sessionCookie), true)
    assert.equal(calls.some((call) => call.cookie.includes('__Host-next-auth')), false)
    assert.equal(JSON.stringify(live).includes(demoToken), false)
    assert.equal(JSON.stringify(live).includes('session-secret-value'), false)

    calls.length = 0
    globalThis.fetch = async (url) => {
      calls.push(String(url))
      return Response.json({ detail: 'Unauthorized' }, { status: 401 })
    }
    const refused = await handleQuery({ session: { accessToken: demoToken } })
    assert.equal(refused.ok, false)
    assert.equal(refused.message.includes('已过期'), false)
    assert.match(refused.message, /仍在有效期内/)
    assert.match(refused.message, /sessionToken/)
    const backendAfterAuthFail = calls.filter((url) => url.includes('/backend-api/'))
    assert.equal(backendAfterAuthFail.length > 0, true)
    assert.equal(backendAfterAuthFail.every((url) => url.includes('/backend-api/me')), true)

    const expiredToken = jwtWith({ exp: 1000000000 })
    const expired = await handleQuery({ session: { accessToken: expiredToken } })
    assert.equal(expired.ok, false)
    assert.match(expired.message, /已过期/)

    globalThis.fetch = async () => new Response('<html><body class="logo">blocked</body></html>', {
      status: 403,
      headers: { 'content-type': 'text/html; charset=UTF-8' }
    })
    const blocked = await handleQuery({
      session: { accessToken: demoToken, sessionToken: 'session-secret-value' }
    })
    assert.equal(blocked.ok, false)
    assert.match(blocked.message, /拦截了 Cloudflare 查询节点/)
    assert.equal(blocked.message.includes('已过期'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('proxy maps ChatGPT payloads including phone, invoices and billing time', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const path = String(url)
    if (path.endsWith('/backend-api/me')) {
      return Response.json({ name: 'Demo', email: 'demo@example.com', phone_number: '+15551212', country: 'US' })
    }
    if (path.endsWith('/backend-api/accounts')) {
      return Response.json({
        accounts: {
          default: {
            account: { plan_type: 'plus', created_time: '2024-01-02T00:00:00.000Z' },
            entitlement: { expires_at: '2026-12-01T00:00:00.000Z', starts_at: '2026-11-01T00:00:00.000Z' }
          }
        }
      })
    }
    if (path.endsWith('/backend-api/payments/invoices')) {
      return Response.json({
        items: [{
          id: 'in_1',
          plan_type: 'plus',
          period_start: '2026-11-01T00:00:00.000Z',
          period_end: '2026-12-01T00:00:00.000Z',
          amount_paid: 20,
          currency: 'usd',
          status: 'paid'
        }]
      })
    }
    if (path.endsWith('/backend-api/subscriptions')) {
      return Response.json({ current_period_end: '2026-12-01T00:00:00.000Z' })
    }
    if (path.endsWith('/backend-api/models')) {
      return Response.json({ models: [{ slug: 'gpt-5', title: 'GPT-5' }] })
    }
    if (path.endsWith('/backend-api/wham/usage')) {
      return Response.json({ rate_limit: { primary_window: { used_percent: 12, resets_at: '2026-11-16T00:00:00.000Z' } } })
    }
    return Response.json({})
  }
  try {
    const result = await handleQuery({
      session: { accessToken: demoToken, account: { planType: 'plus', createdTime: '2024-01-01T00:00:00.000Z' } }
    })
    assert.equal(result.ok, true)
    assert.equal(result.queryMode, 'proxy')
    assert.equal(result.accountDiagnostics.profile.phone, '+15551212')
    assert.equal(result.subscription.expireTime, '2026-12-01T00:00:00.000Z')
    assert.equal(result.accountDiagnostics.webInvoices.length, 1)
    assert.equal(result.accountDiagnostics.sources.me, 'ok')
    assert.notEqual(result.subscription.expireTime, new Date(2000000000 * 1000).toISOString())
    assert.equal(typeof result.actionToken, 'string')
    assert.ok(result.actionToken.length >= 24)
    const leaked = JSON.stringify(result)
    assert.equal(leaked.includes(demoToken), false)

    const secret = 'worker-test-secret'
    const env = { ACTION_TOKEN_SECRET: secret }
    let cancelled = false
    let renewed = false
    const calls = []
    globalThis.fetch = async (url, init) => {
      const path = String(url)
      calls.push({ path, method: init?.method || 'GET', body: init?.body || '' })
      if (path.includes('/subscriptions/cancel')) {
        cancelled = true
        return new Response(null, { status: 204 })
      }
      if (path.includes('/subscriptions/resume')) {
        renewed = true
        return new Response(null, { status: 204 })
      }
      if (path.includes('/payments/customer_portal')) {
        return Response.json({ url: 'https://billing.stripe.com/p/session/test' })
      }
      if (path.includes('/accounts/check/')) {
        return Response.json({
          accounts: {
            default: {
              account: { plan_type: 'plus', account_id: 'acc-1' },
              entitlement: {
                has_active_subscription: true,
                subscription_plan: 'chatgptplusplan',
                expires_at: '2026-12-01T00:00:00.000Z',
                billing_period: 'monthly',
                is_delinquent: false
              },
              last_active_subscription: {
                purchase_origin_platform: 'chatgpt_web',
                will_renew: renewed ? true : !cancelled
              }
            }
          }
        })
      }
      return Response.json({})
    }

    const queried = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/query', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({
        session: {
          accessToken: demoToken,
          sessionToken: 'session-secret-value',
          account: { planType: 'plus' }
        }
      })
    }), env)
    const queriedBody = await queried.json()
    assert.equal(queried.status, 200)
    assert.equal(queriedBody.subscription.autoRenew, true)
    assert.equal(queriedBody.subscription.payChannelType, 1)
    assert.equal(JSON.stringify(queriedBody).includes(demoToken), false)
    assert.equal(JSON.stringify(queriedBody).includes('session-secret-value'), false)

    const cancelResponse = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/cancel', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ actionToken: queriedBody.actionToken })
    }), env)
    const cancelBody = await cancelResponse.json()
    assert.equal(cancelResponse.status, 200)
    assert.equal(cancelBody.verified, true)
    assert.equal(cancelBody.subscription.autoRenew, false)
    const cancelCall = calls.find((call) => call.path.includes('/subscriptions/cancel'))
    assert.equal(JSON.parse(cancelCall.body).account_id, 'acc-1')

    const portalResponse = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/link', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ actionToken: queriedBody.actionToken })
    }), env)
    const portalBody = await portalResponse.json()
    assert.equal(portalBody.ok, true)
    assert.equal(portalBody.url, 'https://billing.stripe.com/p/session/test')
    assert.equal(portalBody.externalPlatform, false)

    const renewResponse = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/renew', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ actionToken: queriedBody.actionToken })
    }), env)
    const renewBody = await renewResponse.json()
    assert.equal(renewResponse.status, 200)
    assert.equal(renewBody.verified, true)
    assert.equal(renewBody.subscription.autoRenew, true)

    const releaseResponse = await worker.fetch(new Request('https://claude.nx.kg/api/action/release', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ actionToken: queriedBody.actionToken })
    }), env)
    assert.equal((await releaseResponse.json()).ok, true)
    const expired = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/cancel', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ actionToken: queriedBody.actionToken })
    }), env)
    assert.equal(expired.status, 401)

    const portalEnv = { ACTION_TOKEN_SECRET: 'portal-fallback-secret' }
    globalThis.fetch = async (url) => {
      const path = String(url)
      if (path.includes('/subscriptions/cancel')) return Response.json({ error: 'needs-portal' }, { status: 400 })
      if (path.includes('/payments/customer_portal')) return Response.json({ url: 'https://evil.example/phish' })
      if (path.includes('/accounts/check/')) {
        return Response.json({
          accounts: {
            default: {
              entitlement: { has_active_subscription: true, subscription_plan: 'chatgptplusplan', expires_at: '2026-12-01T00:00:00.000Z' },
              last_active_subscription: { purchase_origin_platform: 'chatgpt_web', will_renew: true }
            }
          }
        })
      }
      return Response.json({})
    }
    const portalQuery = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/query', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ session: { accessToken: demoToken } })
    }), portalEnv)
    const portalQueryBody = await portalQuery.json()
    const portalCancel = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/cancel', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ actionToken: portalQueryBody.actionToken })
    }), portalEnv)
    const fallbackBody = await portalCancel.json()
    assert.equal(fallbackBody.ok, true)
    assert.equal(fallbackBody.requiresPortal, true)
    assert.equal(fallbackBody.url, 'https://chatgpt.com/account/manage')
    assert.equal(JSON.stringify(fallbackBody).includes(demoToken), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sealed action tokens expire and release without keeping a second copy', async () => {
  const store = createActionStore()
  const secret = 'unit-secret'
  const expired = await store.issue({ accessToken: 'a'.repeat(20), accountId: 'acc' }, { secret, now: 1000, ttlMs: 50 })
  assert.equal((await store.read(expired, { secret, now: 1020 })).accessToken, 'a'.repeat(20))
  assert.equal(await store.read(expired, { secret, now: 1060 }), null)
  const live = await store.issue({ accessToken: 'b'.repeat(20), accountId: 'acc' }, { secret, now: 1000, ttlMs: 500 })
  await store.release(live, { secret, now: 1100 })
  assert.equal(await store.read(live, { secret, now: 1200 }), null)
  const memoryToken = await store.issue({ accessToken: 'mem-token-value', accountId: 'acc' }, { now: 1000, ttlMs: 100 })
  assert.equal(memoryToken.includes('mem-token-value'), false)
  assert.equal((await store.read(memoryToken, { now: 1010 })).accountId, 'acc')
  await store.release(memoryToken, { now: 1010 })
  assert.equal(await store.read(memoryToken, { now: 1020 }), null)
})

test('unknown action routes stay closed', async () => {
  const missing = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/nope', {
    method: 'POST',
    headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
    body: '{}'
  }))
  assert.equal(missing.status, 404)
  const wrongMethod = await worker.fetch(new Request('https://claude.nx.kg/api/subscription/cancel', {
    method: 'GET',
    headers: { origin: 'https://claude.nx.kg' }
  }))
  assert.equal(wrongMethod.status, 405)
})

test('json helper is same-origin CORS for the toolbox', () => {
  const response = json({ ok: true }, 200, 'https://claude.nx.kg')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://claude.nx.kg')
})
