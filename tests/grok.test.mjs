import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseGrokPayload } from '../grok/src/parse.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOW = Date.parse('2026-11-16T10:19:28.337Z')

function sample() {
  return {
    subscriptions: [
      {
        google: {
          purchaseToken: 'secret-google-token',
          productId: 'grok.pro',
          expiryTime: '2026-11-16T10:02:00.723Z',
          autoRenewEnabled: true
        },
        xaiUserId: 'user-secret',
        tier: 'SUBSCRIPTION_TIER_GROK_PRO',
        status: 'SUBSCRIPTION_STATUS_ACTIVE',
        createTime: '2026-08-16T10:02:04.637415Z',
        billingInterval: 'BILLING_INTERVAL_MONTHLY',
        billingPeriodEnd: '2026-11-16T10:02:00.723Z'
      },
      {
        stripe: {
          subscriptionId: 'sub_secret',
          invoiceId: 'in_secret',
          productId: 'prod_secret',
          currentPeriodEnd: '2027-04-07T22:18:19Z',
          priceId: 'price_secret'
        },
        tier: 'SUBSCRIPTION_TIER_SUPER_GROK_PRO',
        status: 'SUBSCRIPTION_STATUS_INACTIVE',
        billingInterval: 'BILLING_INTERVAL_YEARLY',
        billingPeriodEnd: '2027-04-07T22:18:19Z'
      },
      {
        x: {},
        tier: 'SUBSCRIPTION_TIER_X_PREMIUM_PLUS',
        status: 'SUBSCRIPTION_STATUS_ACTIVE',
        createTime: '2026-04-05T07:59:07.776371Z'
      }
    ],
    dominantPlan: {
      plan: 'supergrok.heavy',
      surfaceNames: { SURFACE_DISPLAY: 'SuperGrok Heavy' }
    }
  }
}

test('counts only the active dated subscription and keeps the X row undated', () => {
  const result = parseGrokPayload(JSON.stringify(sample()), NOW)
  assert.equal(result.summary.headline, '已到期，剩余 0 天')
  assert.equal(result.summary.daysLeft, 0)
  assert.equal(result.summary.overdue, true)
  assert.equal(result.primaryIndex, 0)
  assert.equal(result.items[0].tierLabel, 'SuperGrok')
  assert.equal(result.items[0].channel, 'google')
  assert.equal(result.items[0].expiryText, '2026-11-16 18:02')
  assert.match(result.items[0].overdueText, /已过 \d+ 分钟/)
  assert.equal(result.items[1].active, false)
  assert.equal(result.items[2].tierLabel, 'X Premium+')
  assert.equal(result.items[2].channel, 'x')
  assert.equal(result.items[2].daysLeft, null)
  assert.equal(result.items[2].expiry, '')
  assert.match(result.summary.detail, /X Premium\+ 在生效/)
  assert.match(result.summary.detail, /未生效记录里的到期日不计入剩余天数/)
  assert.equal(result.dominant.display, 'SuperGrok Heavy')
  const dumped = JSON.stringify(result)
  assert.equal(dumped.includes('secret-google-token'), false)
  assert.equal(dumped.includes('sub_secret'), false)
  assert.equal(dumped.includes('user-secret'), false)
})

test('rounds a future expiry up to whole days', () => {
  const payload = {
    subscriptions: [{
      google: { productId: 'grok.pro', expiryTime: '2026-11-26T10:19:28.337Z', autoRenewEnabled: false },
      tier: 'SUBSCRIPTION_TIER_GROK_PRO',
      status: 'SUBSCRIPTION_STATUS_ACTIVE'
    }]
  }
  const result = parseGrokPayload(JSON.stringify(payload), NOW)
  assert.equal(result.summary.daysLeft, 10)
  assert.equal(result.summary.headline, '剩余 10 天')
  assert.equal(result.items[0].autoRenewLabel, '自动续费关着')
})

test('rejects text that is not subscription JSON', () => {
  assert.throws(() => parseGrokPayload('hello', NOW), /JSON 无法解析/)
  assert.throws(() => parseGrokPayload('{"ok":true}', NOW), /没有找到 subscriptions/)
})

test('grok page stays local and explains the X limit', () => {
  const html = readFileSync(path.join(root, 'grok/index.html'), 'utf8')
  const app = readFileSync(path.join(root, 'grok/src/app.js'), 'utf8')
  assert.match(html, /grok\.com\/rest\/subscriptions/)
  assert.match(html, /X 对象如果是空的/)
  assert.match(html, /不代查 x\.com/)
  assert.doesNotMatch(app, /fetch\(/)
  assert.match(app, /parseGrokPayload/)
})
