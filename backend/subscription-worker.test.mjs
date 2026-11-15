import assert from 'node:assert/strict'
import test from 'node:test'
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
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('json helper is same-origin CORS for the toolbox', () => {
  const response = json({ ok: true }, 200, 'https://claude.nx.kg')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://claude.nx.kg')
})
