import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { normalizePlan, parseSessionInput, readJwtClaims } from '../subscription/src/query.js'

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

test('subscription pages keep the mirror layout and do not post session to a site API', () => {
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
  assert.match(result, /你的订阅全貌/)
  assert.match(app, /querySubscriptionLocally/)
  assert.doesNotMatch(app, /\/api\/subscription\/query/)
  assert.doesNotMatch(query, /\/api\/subscription/)
  assert.doesNotMatch(resultJs, /\/api\/subscription\/cancel/)
  assert.match(resultJs, /chatgpt.com\/settings\/billing/)
})
