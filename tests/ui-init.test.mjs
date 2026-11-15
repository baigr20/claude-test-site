import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(path.join(root, 'sub-cpa/index.html'), 'utf8')
const css = readFileSync(path.join(root, 'sub-cpa/src/styles.css'), 'utf8')
const app = readFileSync(path.join(root, 'sub-cpa/src/app.js'), 'utf8')

function markupOf(id) {
  const start = html.search(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))
  assert.ok(start >= 0, `missing #${id}`)
  const tagEnd = html.indexOf('>', start)
  return html.slice(start, tagEnd + 1)
}

function cssBlock(selector) {
  const blocks = []
  const needle = selector
  let index = 0
  while (index < css.length) {
    const start = css.indexOf(needle, index)
    if (start < 0) break
    // require the selector is not a prefix of a longer class, and is followed by `{`
    const before = start === 0 ? '' : css[start - 1]
    if (before && /[A-Za-z0-9_-]/.test(before)) {
      index = start + needle.length
      continue
    }
    const open = css.indexOf('{', start)
    if (open < 0) break
    const between = css.slice(start + needle.length, open).trim()
    if (between !== '' && !between.startsWith(',')) {
      index = start + needle.length
      continue
    }
    let depth = 0
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) {
          blocks.push(css.slice(open + 1, i))
          index = i + 1
          break
        }
      }
    }
  }
  assert.ok(blocks.length, `missing CSS rule ${selector}`)
  return blocks.join('\n')
}

test('first paint of /sub-cpa/ is the converter, with login and download dialogs hidden', () => {
  assert.match(html, /<h1>\s*Sub \/ CPA 互转\s*<\/h1>/)
  assert.match(html, /id="sourceText"/)
  assert.match(html, /id="outputText"/)
  assert.match(html, /id="convertNow"/)
  assert.match(html, /本地转换 · 不上传凭证/)
  assert.match(html, /href="\/"/)

  for (const id of ['codexLoginDialog', 'downloadDialog', 'dropOverlay']) {
    const tag = markupOf(id)
    assert.match(tag, /aria-hidden="true"/)
    assert.doesNotMatch(tag, /\bis-visible\b/)
    assert.doesNotMatch(tag, /(?:^|\s)hidden(?:="[^"]*")?(?=[\s>])/)
  }

  const toast = markupOf('toast')
  assert.doesNotMatch(toast, /\bis-visible\b/)

  assert.match(html, /id="codexLogin"[^>]*>Codex 登录</)
  assert.doesNotMatch(html, /protocolLogin|workbench-storage|aasfa\.xgrok|\/api\/order-cards|\/api\/local-health/)
})

test('original modal CSS keeps overlays invisible until .is-visible', () => {
  const modal = cssBlock('.modal')
  const visible = cssBlock('.modal.is-visible')
  assert.match(modal, /display:\s*grid/)
  assert.match(modal, /opacity:\s*0/)
  assert.match(modal, /pointer-events:\s*none/)
  assert.match(visible, /opacity:\s*1/)
  assert.match(visible, /pointer-events:\s*auto/)

  const overlay = cssBlock('.drop-overlay')
  assert.match(overlay, /opacity:\s*0/)
  assert.match(overlay, /pointer-events:\s*none/)
  assert.match(cssBlock('.drop-overlay.is-visible'), /opacity:\s*1/)

  const toast = cssBlock('.toast')
  assert.match(toast, /opacity:\s*0/)
  assert.match(cssBlock('.toast.is-visible'), /opacity:\s*1/)

  // The tool page must not depend on the toolbox [hidden] fix for these overlays.
  assert.doesNotMatch(html, /assets\/site\.css/)
  assert.match(html, /href="\.\/src\/styles\.css"/)
})

test('authorization starts only from the Codex login click, never on module load', () => {
  const startCount = [...app.matchAll(/\bstartCodexLogin\s*\(/g)].length
  assert.ok(startCount >= 2, 'expected startCodexLogin definition and click-time calls')

  assert.match(app, /addEventListener\(\s*['"]click['"]\s*,\s*\(\)\s*=>\s*\{\s*void startCodexLogin\(\)/)
  assert.match(app, /function openCodexAuthUrl\s*\([^)]*\)\s*\{[\s\S]*?startCodexLogin\(\)/)
  assert.match(app, /addEventListener\(\s*['"]click['"]\s*,\s*closeCodexLoginDialog/)
  assert.match(app, /function clearAll\s*\([^)]*\)\s*\{[\s\S]*?closeCodexLoginDialog\(\)/)
  assert.match(app, /function clearAll\s*\([^)]*\)\s*\{[\s\S]*?closeDownloadDialog\(\)/)
  assert.match(app, /addEventListener\(\s*['"]click['"]\s*,\s*closeDownloadDialog/)
  assert.match(app, /key === ['"]Escape['"][\s\S]*closeCodexLoginDialog\(\)/)

  assert.match(app, /function openCodexLoginDialog\s*\([^)]*\)\s*\{[\s\S]*?setOverlayVisible\([^)]*codexLoginDialog['"]?\)?,\s*true/)
  assert.match(app, /function closeCodexLoginDialog\s*\([^)]*\)\s*\{[\s\S]*?setOverlayVisible\([^)]*codexLoginDialog['"]?\)?,\s*false/)

  const afterBinds = app.split(/function bindEvents\s*\(\s*\)\s*\{/)[1]
  assert.ok(afterBinds, 'missing bindEvents')
  const bindEnd = afterBinds.lastIndexOf('}')
  // The module footer after bindEvents() starts after its closing brace.
  // Safer: look at the last three statements in the file.
  const footer = app.trim().split('\n').filter((line) => line.trim()).slice(-8).join('\n')
  assert.match(footer, /bindEvents\(\)/)
  assert.match(footer, /bindDrop\(\)/)
  assert.match(footer, /setTarget\(\s*['"]sub['"]\s*,\s*\{\s*convert:\s*false\s*\}\s*\)/)
  assert.doesNotMatch(footer, /startCodexLogin\s*\(/)
  assert.doesNotMatch(footer, /openCodexLoginDialog\s*\(/)
  assert.doesNotMatch(footer, /openOfficialAuthUrl\s*\(/)
  assert.doesNotMatch(footer, /window\.open\s*\(/)

  assert.doesNotMatch(app, /DOMContentLoaded[\s\S]{0,200}startCodexLogin/)
  assert.doesNotMatch(app, /addEventListener\(\s*['"]load['"][\s\S]{0,200}startCodexLogin/)
})
