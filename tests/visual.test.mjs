import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const site = readFileSync(path.join(root, 'assets/site.css'), 'utf8')
const tool = readFileSync(path.join(root, 'sub-cpa/src/styles.css'), 'utf8')
const home = readFileSync(path.join(root, 'index.html'), 'utf8')
const page = readFileSync(path.join(root, 'sub-cpa/index.html'), 'utf8')
const theme = readFileSync(path.join(root, 'assets/theme.js'), 'utf8')

test('homepage and converter share the mint design tokens and chrome', () => {
  assert.match(site, /:root\s*\{[^}]*--bg:\s*#f6f4ee/s)
  assert.match(site, /:root\s*\{[^}]*--accent:\s*#3aa888/s)
  assert.match(site, /:root\s*\{[^}]*--ink:\s*#2c3a35/s)
  assert.match(site, /--sky:\s*#7eb8d4/)
  assert.match(site, /html\[data-theme="dark"\]\s*\{[^}]*--bg:\s*#15201c/s)

  assert.match(home, /href="\/assets\/site\.css"/)
  assert.match(page, /href="\/assets\/site\.css"/)
  assert.match(page, /href="\.\/src\/styles\.css"/)
  assert.match(home, /class="site-header"/)
  assert.match(page, /class="site-header"/)
  assert.match(home, /class="site-footer"/)
  assert.match(page, /class="site-footer"/)
  assert.match(home, /id="themeToggle"/)
  assert.match(page, /id="themeToggle"/)

  // Converter layout must use shared tokens, not a second palette.
  assert.doesNotMatch(tool, /:root\s*\{/)
  assert.match(tool, /var\(--bg-elev\)/)
  assert.match(tool, /var\(--accent\)/)
  assert.match(tool, /var\(--mono\)/)
})

test('light theme has no leftover dark editor or orange original palette', () => {
  const css = site + '\n' + tool
  assert.doesNotMatch(css, /#17130d|#ede8dc|#df5b2f|#fff7e7|#fffaf0/)
  assert.match(tool, /#sourceText[^{]*\{[^}]*color:\s*var\(--ink\)/s)
  assert.match(tool, /#sourceText[^{]*\{[^}]*font-family:\s*var\(--mono\)/s)
  assert.match(tool, /overflow-x:\s*auto/)
  assert.match(tool, /overflow-wrap:\s*anywhere/)
  assert.match(site, /#codexAuthUrl|#codexCodeVerifier|\.modal__textarea/)
  assert.match(site, /\.modal__panel--wide|\.modal__textarea/)
  assert.match(site, /max-height:\s*min\(88svh/)
})

test('theme defaults to light unless the user saved a choice', () => {
  assert.match(theme, /return 'light'/)
  assert.doesNotMatch(theme, /prefers-color-scheme:\s*dark\)\s*\.matches\s*\?\s*'dark'/)
})
