import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { filterToolCards, normalizeSearchText, toolMatchesQuery } from '../assets/search.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cards = [
  {
    id: 'sub-cpa',
    category: 'convert',
    searchText: 'sub cpa sub/cpa sub-cpa cockpit sub2api 转换 互转 codex session json jsonl Sub / CPA 互转 在浏览器本地'
  },
  {
    id: '2fa',
    category: 'security',
    searchText: '2fa totp otp otpauth 动态验证码 验证码 安全 base32 密钥 authenticator 动态验证码（TOTP） 在浏览器本地'
  }
]

test('normalizes punctuation so Sub / CPA matches the tool', () => {
  assert.equal(normalizeSearchText('Sub / CPA'), 'sub cpa')
  assert.equal(toolMatchesQuery(cards[0].searchText, 'Sub / CPA'), true)
  assert.equal(toolMatchesQuery(cards[0].searchText, 'sub-cpa'), true)
  assert.equal(toolMatchesQuery(cards[0].searchText, '互转'), true)
  assert.equal(toolMatchesQuery(cards[0].searchText, 'zz-no-match'), false)
})

test('filter shows the card for Sub / CPA and hides it for zz-no-match', () => {
  const hit = filterToolCards(cards, { query: 'Sub / CPA', category: 'all' })
  assert.equal(hit[0].visible, true)
  assert.equal(hit.filter((item) => item.visible).length, 1)

  const miss = filterToolCards(cards, { query: 'zz-no-match', category: 'all' })
  assert.equal(miss[0].visible, false)
  assert.equal(miss.filter((item) => item.visible).length, 0)
})

test('filter shows both homepage tools and respects category plus search', () => {
  const all = filterToolCards(cards, { query: '', category: 'all' })
  assert.equal(all.filter((item) => item.visible).map((item) => item.id).join(','), 'sub-cpa,2fa')

  const convert = filterToolCards(cards, { query: '', category: 'convert' })
  assert.equal(convert.filter((item) => item.visible).map((item) => item.id).join(','), 'sub-cpa')

  const security = filterToolCards(cards, { query: '', category: 'security' })
  assert.equal(security.filter((item) => item.visible).map((item) => item.id).join(','), '2fa')

  const totp = filterToolCards(cards, { query: 'TOTP', category: 'all' })
  assert.equal(totp.filter((item) => item.visible).map((item) => item.id).join(','), '2fa')

  const convertQuery = filterToolCards(cards, { query: 'Sub / CPA', category: 'all' })
  assert.equal(convertQuery.filter((item) => item.visible).map((item) => item.id).join(','), 'sub-cpa')
})

test('CSS hidden attribute beats flex/grid display on cards', () => {
  const css = readFileSync(path.join(root, 'assets/site.css'), 'utf8')
  const hidden = css.match(/(?:^|[\s;}])\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/m)
  assert.ok(hidden, 'expected a standalone [hidden] { display: none !important } rule')
  assert.match(css, /\.card\s*\{[^}]*display:\s*flex/s)
  const hiddenAt = css.search(/(?:^|[\s;}])\[hidden\]\s*\{/m)
  const cardAt = css.search(/\.card\s*\{/)
  assert.ok(hiddenAt >= 0 && hiddenAt < cardAt, '[hidden] must be defined before .card so later display:flex cannot un-hide it without !important')
})
