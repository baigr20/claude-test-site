import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { hashFile, htmlFiles, stampAll, withVersion } from '../scripts/stamp-assets.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('HTML and module imports point at content-hashed local CSS and JS', () => {
  const stamped = stampAll({ write: false })
  assert.equal(stamped.written.length, 0, `unstamped files: ${stamped.written.join(', ')}`)

  assert.equal(stamped.versions['assets/site.css'], hashFile('assets/site.css'))
  assert.equal(stamped.versions['sub-cpa/src/styles.css'], hashFile('sub-cpa/src/styles.css'))

  for (const rel of htmlFiles) {
    const html = readFileSync(path.join(root, rel), 'utf8')
    assert.equal(html, stamped.htmlWrites[rel].stamped, `${rel} is missing current asset hashes`)
    const refs = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1])
    const localRefs = refs.filter((ref) => /\.(?:css|js|svg)(?:\?|$)/.test(ref) && !/^https?:/i.test(ref))
    assert.ok(localRefs.length > 0, `${rel} should reference local assets`)
    for (const ref of localRefs) {
      assert.match(ref, /\?v=[0-9a-f]{10}$/, `${rel} has unversioned asset ${ref}`)
    }
    assert.doesNotMatch(html, /href=["']\/assets\/site\.css["']/)
    assert.doesNotMatch(html, /href=["'](?:\.\/src\/styles\.css|\/sub-cpa\/src\/styles\.css)["']/)
  }

  const home = readFileSync(path.join(root, 'assets/home.js'), 'utf8')
  assert.match(home, /from '\.\/search\.js\?v=42dafcea25'|from '\.\/search\.js\?v=[0-9a-f]{10}'/)
  assert.match(home, new RegExp(`from '\\./search\\.js\\?v=${stamped.versions['assets/search.js']}'`))

  const app = readFileSync(path.join(root, 'sub-cpa/src/app.js'), 'utf8')
  assert.match(app, new RegExp(`from '\\./converter\\.js\\?v=${stamped.versions['sub-cpa/src/converter.js']}'`))
  assert.match(app, new RegExp(`from '\\./codex-oauth\\.js\\?v=${stamped.versions['sub-cpa/src/codex-oauth.js']}'`))
})

test('mint CSS files themselves still have no leftover orange or dark editor colors', () => {
  const site = readFileSync(path.join(root, 'assets/site.css'), 'utf8')
  const tool = readFileSync(path.join(root, 'sub-cpa/src/styles.css'), 'utf8')
  const css = site + '\n' + tool
  assert.match(site, /--accent:\s*#3aa888/)
  assert.match(site, /--bg:\s*#f6f4ee/)
  assert.doesNotMatch(css, /#17130d|#ede8dc|#df5b2f|#fff7e7|#fffaf0|#a2361c/)
  assert.match(site, /\[hidden\]\s*\{\s*display:\s*none\s*!important/)
  assert.match(site, /\.modal\s*\{[^}]*opacity:\s*0[^}]*pointer-events:\s*none/s)
  assert.match(site, /\.modal\.is-visible\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/s)
  const index = readFileSync(path.join(root, 'sub-cpa/index.html'), 'utf8')
  assert.match(index, /site\.css\?v=/)
  assert.match(index, /styles\.css\?v=/)
  assert.match(index, /theme\.js\?v=/)
})
