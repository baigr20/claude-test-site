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

test('CSS hidden attribute beats flex/grid display on cards', () => {
  const css = readFileSync(path.join(root, 'assets/site.css'), 'utf8')
  assert.match(css, /(?:^|[\s;}])\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/m)
  assert.match(css, /\.card\s*\{[^}]*display:\s*flex/s)
})
