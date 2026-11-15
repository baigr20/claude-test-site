import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildResult, normalizePlan, parseSessionInput, readJwtClaims, walkInvoices } from '../subscription/src/query.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function jwtWith(payload) {
  const header = Buffer.from('{"alg":"none"}').toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

test('parses a compact ChatGPT session JSON without sending it anywhere', () => {
  const token = jwtWith({
    email: 'demo@example.com',
    exp: 2000000000,
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc-1',
      chatgpt_plan_type: 'plus'
    },
    'https://api.openai.com/profile': { name: 'Demo', email: 'demo@example.com' }
  })
  const session = parseSessionInput(JSON.stringify({ accessToken: token, account: { planType: 'plus' } }))
  assert.equal(session.email, 'demo@example.com')
  assert.equal(session.accountId, 'acc-1')
  assert.equal(normalizePlan(session.planType), 'plus')
  assert.equal(readJwtClaims(token).email, 'demo@example.com')
})

test('parses account createdTime and does not treat JWT exp as billing expireTime', () => {
  const token = jwtWith({
    email: 'demo@example.com',
    exp: 2000000000,
    'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1', chatgpt_plan_type: 'free' }
  })
  const session = parseSessionInput(JSON.stringify({
    accessToken: token,
    account: { planType: 'free', createdTime: '2024-05-01T08:00:00.000Z' }
  }))
  assert.equal(session.createdAt, '2024-05-01T08:00:00.000Z')
  const result = buildResult(session, {})
  assert.equal(result.subscription.expireTime, '')
  assert.equal(result.subscription.createdAt, '2024-05-01T08:00:00.000Z')
  assert.equal(result.queryMode, 'browser-session')
  assert.notEqual(result.subscription.expireTime, session.expires)
})

test('walks invoices into historical orders', () => {
  const orders = walkInvoices({
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
  assert.equal(orders.length, 1)
  assert.equal(orders[0].payChannelType, 1)
  assert.equal(orders[0].billingAmount, 20)
})

test('buildResult fills phone and billing expire from live payloads', () => {
  const token = jwtWith({ email: 'demo@example.com', exp: 2000000000 })
  const session = parseSessionInput(JSON.stringify({ accessToken: token, account: { planType: 'plus' } }))
  const result = buildResult(session, {
    me: { name: 'Demo', email: 'demo@example.com', phone_number: '+15550001' },
    accounts: {
      accounts: {
        default: {
          entitlement: { expires_at: '2026-12-01T00:00:00.000Z', starts_at: '2026-11-01T00:00:00.000Z' }
        }
      }
    },
    invoices: { items: [{ id: 'in_9', period_start: '2026-11-01T00:00:00.000Z', amount_paid: 20, currency: 'usd' }] }
  }, 'proxy')
  assert.equal(result.accountDiagnostics.profile.phone, '+15550001')
  assert.equal(result.subscription.expireTime, '2026-12-01T00:00:00.000Z')
  assert.equal(result.accountDiagnostics.webInvoices.length, 1)
  assert.equal(result.queryMode, 'proxy')
})

test('subscription pages keep the mirror layout and optional same-origin proxy', () => {
  const index = readFileSync(path.join(root, 'subscription/index.html'), 'utf8')
  const result = readFileSync(path.join(root, 'subscription/result.html'), 'utf8')
  const app = readFileSync(path.join(root, 'subscription/src/app.js'), 'utf8')
  const query = readFileSync(path.join(root, 'subscription/src/query.js'), 'utf8')
  const resultJs = readFileSync(path.join(root, 'subscription/src/result.js'), 'utf8')

  assert.match(index, /一镜照见/)
  assert.match(index, /id="session-json"/)
  assert.match(index, /照见我的订阅/)
  assert.match(index, /href="\/"/)
  assert.match(index, /chatgpt.com\/api\/auth\/session/)
  assert.match(index, /id="privacy-copy"/)
  assert.match(result, /你的订阅全貌/)
  assert.match(app, /querySubscriptionLocally/)
  assert.match(app, /\/api\/health/)
  assert.doesNotMatch(app, /\/api\/subscription\/query/)
  assert.match(query, /\/api\/subscription\/query/)
  assert.match(query, /backend-api\/payments\/invoices/)
  assert.doesNotMatch(resultJs, /\/api\/subscription\/cancel/)
  assert.match(resultJs, /chatgpt.com\/settings\/billing/)
  assert.match(resultJs, /绑定手机号/)
  assert.match(resultJs, /历史订单/)
  assert.match(resultJs, /会话有效期/)
  assert.match(resultJs, /数据来源/)
  assert.match(resultJs, /接口没有返回，不是页面隐藏/)
})
