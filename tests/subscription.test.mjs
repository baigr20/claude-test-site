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

test('maps checkgpt account-check fields for renew, channel, cycle and usage', () => {
  const token = jwtWith({
    email: 'demo@example.com',
    exp: 2000000000,
    'https://api.openai.com/auth': { chatgpt_user_id: 'user-9', account_id: 'acc-9' }
  })
  const session = parseSessionInput(JSON.stringify({
    accessToken: token,
    refreshToken: 'refresh-1',
    sessionToken: 'session-1'
  }))
  assert.equal(session.userId, 'user-9')
  assert.equal(session.accountId, 'acc-9')
  assert.equal(session.refreshToken, 'refresh-1')
  assert.equal(session.subscription, null)
  const withDevice = parseSessionInput(JSON.stringify({
    accessToken: token,
    statsigContext: { deviceId: 'device-1' }
  }))
  assert.equal(withDevice.deviceId, 'device-1')

  const web = buildResult(session, {
    accountCheck: {
      accounts: {
        'acc-9': {
          account: { plan_type: 'plus' },
          entitlement: {
            has_active_subscription: true,
            subscription_plan: 'chatgptplusplan',
            expires_at: '2026-12-01T00:00:00.000Z',
            billing_period: 'yearly',
            is_delinquent: false
          },
          last_active_subscription: {
            purchase_origin_platform: 'chatgpt_web',
            will_renew: true,
            billing_currency: 'usd'
          }
        }
      }
    },
    usage: {
      rate_limit: {
        primary_window: { used_percent: 12, resets_at: '2026-11-16T00:00:00.000Z' },
        secondary_window: { used_percent: 40, resets_at: '2026-11-20T00:00:00.000Z' }
      }
    },
    credits: { available_count: 2, credits: [{ title: '重置', status: 'available' }] },
    settings: { mfa: true, totp_authenticators: [{ id: 'totp-1' }] }
  }, 'proxy')
  assert.equal(web.subscription.state, 'active')
  assert.equal(web.subscription.payChannelType, 1)
  assert.equal(web.subscription.autoRenewKnown, true)
  assert.equal(web.subscription.autoRenew, true)
  assert.equal(web.subscription.paymentCycle, 'yearly')
  assert.equal(web.subscription.isOverdue, false)
  assert.equal(web.subscription.currency, 'USD')
  assert.equal(web.accountDiagnostics.codexUsage.secondaryUsedPercent, 40)
  assert.equal(web.accountDiagnostics.codexUsage.resetCreditsAvailable, 2)
  assert.equal(web.accountDiagnostics.security.mfaEnabled, true)
  assert.equal(web.accountDiagnostics.security.totpCount, 1)

  const paused = buildResult(session, {
    accountCheck: {
      accounts: {
        default: {
          entitlement: { has_active_subscription: true, subscription_plan: 'chatgptplusplan', is_delinquent: true },
          last_active_subscription: { purchase_origin_platform: 'ios', will_renew: false }
        }
      }
    }
  }, 'proxy')
  assert.equal(paused.subscription.state, 'paused')
  assert.equal(paused.subscription.payChannelType, 3)
  assert.equal(paused.subscription.autoRenew, false)
  assert.equal(paused.mobileBilling.status, 'complete')
  assert.equal(paused.mobileBilling.records[0].payChannelType, 3)
})

test('subscription pages follow the checkgpt query and action contract', () => {
  const index = readFileSync(path.join(root, 'subscription/index.html'), 'utf8')
  const result = readFileSync(path.join(root, 'subscription/result.html'), 'utf8')
  const app = readFileSync(path.join(root, 'subscription/src/app.js'), 'utf8')
  const query = readFileSync(path.join(root, 'subscription/src/query.js'), 'utf8')
  const resultJs = readFileSync(path.join(root, 'subscription/src/result.js'), 'utf8')
  const worker = readFileSync(path.join(root, 'backend/subscription-worker.mjs'), 'utf8')

  assert.match(index, /一镜照见/)
  assert.match(index, /id="session-json"/)
  assert.match(index, /照见我的订阅/)
  assert.match(index, /href="\/subscription\/"/)
  assert.match(index, /chatgpt.com\/api\/auth\/session/)
  assert.match(index, /id="privacy-copy"/)
  assert.match(result, /你的订阅全貌/)
  assert.match(app, /parseSessionInput/)
  assert.match(app, /\/api\/health/)
  assert.match(app, /\/api\/subscription\/query/)
  assert.doesNotMatch(app, /querySubscriptionLocally/)
  assert.match(app, /actionToken\.length < 24/)
  assert.match(query, /purchase_origin_platform/)
  assert.match(query, /will_renew/)
  assert.match(worker, /accounts\/check\/v4-2023-04-27/)
  assert.match(worker, /\/backend-api\/subscriptions\/cancel/)
  assert.match(worker, /\/backend-api\/subscriptions\/resume/)
  assert.doesNotMatch(worker, /__Host-next-auth/)
  assert.match(worker, /oai-device-id/)
  assert.match(resultJs, /\/api\/subscription\/cancel/)
  assert.match(resultJs, /\/api\/subscription\/renew/)
  assert.match(resultJs, /\/api\/subscription\/link/)
  assert.match(resultJs, /\/api\/action\/release/)
  assert.doesNotMatch(resultJs, /本站不代发/)
  assert.match(resultJs, /绑定手机号/)
})

test('subscription UI is a 1:1 checkgpt.plus replica without toolbox chrome', () => {
  const index = readFileSync(path.join(root, 'subscription/index.html'), 'utf8')
  const result = readFileSync(path.join(root, 'subscription/result.html'), 'utf8')
  const css = readFileSync(path.join(root, 'subscription/src/styles.css'), 'utf8')
  const app = readFileSync(path.join(root, 'subscription/src/app.js'), 'utf8')

  assert.doesNotMatch(index, /class="site-header"/)
  assert.doesNotMatch(result, /class="site-header"/)
  assert.doesNotMatch(index, /assets\/site\.css/)
  assert.doesNotMatch(result, /assets\/site\.css/)
  assert.doesNotMatch(index, /id="themeToggle"/)
  assert.doesNotMatch(result, /id="themeToggle"/)
  assert.match(index, /<b>在线会员查询<\/b>/)
  assert.match(index, /套餐、额度、到期和续费，一次查询便清清楚楚。/)
  assert.match(index, /镜花水月 · 看清每一次订阅/)
  assert.match(index, /当前方案与到期时间/)
  assert.match(index, /查询完成后，本页输入会自动清空。/)
  assert.match(css, /\.brand \{ display: inline-flex/)
  assert.match(css, /镜花水月 · 首页品牌视觉/)
  assert.doesNotMatch(app, /label\.textContent = '查询服务/)
})
