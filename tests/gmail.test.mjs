import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import worker from '../backend/subscription-worker.mjs'
import { handleGmailCheck, UPSTREAM_CHECK } from '../backend/gmail-check.mjs'
import {
  BATCH_SIZE,
  chunkEmails,
  countByStatus,
  MAX_CHECK_COUNT,
  normalizeEmail,
  parseEmailList,
  resultsToCsv,
  resultsToText
} from '../gmail/src/parse.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('normalizes usernames and strips trailing gmail.com junk', () => {
  assert.equal(normalizeEmail('alice'), 'alice@gmail.com')
  assert.equal(normalizeEmail('bob@gmail.com----extra'), 'bob@gmail.com')
  assert.equal(normalizeEmail('name@company.com'), 'name@company.com')
})

test('rejects passwords, duplicates, empty lists and oversized batches', () => {
  assert.equal(parseEmailList('').ok, false)
  assert.equal(parseEmailList('a@gmail.com----secret').code, 'password')
  assert.equal(parseEmailList('a@gmail.com\na@gmail.com').code, 'duplicate')
  assert.equal(parseEmailList('..').code, 'invalid')
  assert.equal(parseEmailList('@gmail.com').code, 'invalid')
  const many = Array.from({ length: MAX_CHECK_COUNT + 1 }, (_, i) => `user${i}@gmail.com`).join('\n')
  assert.equal(parseEmailList(many).code, 'too_many')
  const ok = parseEmailList('alice\nbob@gmail.com\nname@company.com')
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.emails, ['alice@gmail.com', 'bob@gmail.com', 'name@company.com'])
  assert.equal(chunkEmails(ok.emails, 2).length, 2)
  assert.equal(BATCH_SIZE, 50)
})

test('formats copy text and csv from filtered results', () => {
  const rows = [
    { email: 'ok@gmail.com', status: 'normal' },
    { email: 'bad@gmail.com', status: 'abnormal' },
    { email: 'gone@gmail.com', status: 'not_exist' }
  ]
  assert.equal(countByStatus(rows).normal, 1)
  assert.equal(resultsToText(rows, 'normal'), 'ok@gmail.com\t正常')
  assert.match(resultsToCsv(rows, 'all'), /email,status/)
  assert.match(resultsToCsv(rows, 'not_exist'), /gone@gmail.com,未注册/)
})

test('worker forwards a valid batch and maps unknown statuses to error', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return Response.json({
      results: [
        { email: 'alice@gmail.com', status: 'normal', detail: '账号正常活跃' },
        { email: 'bob@gmail.com', status: 'weird' }
      ]
    })
  }
  const result = await handleGmailCheck({ emails: ['alice', 'bob@gmail.com'] }, fetchImpl)
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.results[0].status, 'normal')
  assert.equal(result.body.results[1].status, 'error')
  assert.equal(calls[0].url, UPSTREAM_CHECK)
  assert.deepEqual(calls[0].body.emails, ['alice@gmail.com', 'bob@gmail.com'])
})

test('worker rejects password rows without calling upstream', async () => {
  let called = false
  const result = await handleGmailCheck({ emails: ['a@gmail.com|password'] }, async () => {
    called = true
    return Response.json({})
  })
  assert.equal(called, false)
  assert.equal(result.status, 400)
  assert.match(result.body.message, /密码/)
})

test('subscription worker exposes the gmail check route', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({
    results: [{ email: 'alice@gmail.com', status: 'normal', detail: '账号正常活跃' }]
  })
  try {
    const response = await worker.fetch(new Request('https://claude.nx.kg/api/gmail/check', {
      method: 'POST',
      headers: { origin: 'https://claude.nx.kg', 'content-type': 'application/json' },
      body: JSON.stringify({ emails: ['alice'] })
    }))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.results[0].email, 'alice@gmail.com')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('gmail page uses the toolbox chrome and does not ask for passwords', () => {
  const html = readFileSync(path.join(root, 'gmail/index.html'), 'utf8')
  const app = readFileSync(path.join(root, 'gmail/src/app.js'), 'utf8')
  const query = readFileSync(path.join(root, 'gmail/src/query.js'), 'utf8')
  assert.match(html, /class="site-header"/)
  assert.match(html, /href="\/"/)
  assert.match(html, /只填账号，不要填密码/)
  assert.match(html, /id="emailInput"/)
  assert.match(html, /id="resultList"/)
  assert.doesNotMatch(html, /type="password"/)
  assert.match(app, /parseEmailList/)
  assert.match(app, /checkEmailBatch/)
  assert.match(query, /\/api\/gmail\/check/)
  assert.doesNotMatch(app, /localStorage|sessionStorage/)
})
