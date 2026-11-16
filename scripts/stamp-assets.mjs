import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const leafAssets = [
  'assets/site.css',
  'assets/search.js',
  'assets/theme.js',
  'assets/favicon.svg',
  'sub-cpa/src/styles.css',
  'sub-cpa/src/converter.js',
  'sub-cpa/src/codex-oauth.js',
  '2fa/src/styles.css',
  '2fa/src/totp.js',
  'subscription/src/styles.css',
  'subscription/src/query.js',
  'subscription/src/result.js',
  'grok/src/styles.css',
  'grok/src/parse.js'
]

export const stampedModules = {
  'assets/home.js': ['./search.js'],
  'sub-cpa/src/app.js': ['./converter.js', './codex-oauth.js'],
  '2fa/src/app.js': ['./totp.js'],
  'subscription/src/app.js': ['./query.js'],
  'grok/src/app.js': ['./parse.js']
}

export const htmlFiles = [
  'index.html',
  '404.html',
  'sub-cpa/index.html',
  '2fa/index.html',
  'subscription/index.html',
  'subscription/result.html',
  'grok/index.html'
]

export function sha10(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 10)
}

export function hashFile(rel) {
  return sha10(readFileSync(path.join(root, rel)))
}

export function withVersion(specifier, hash) {
  const bare = String(specifier).replace(/\?v=[0-9a-f]+$/i, '')
  return `${bare}?v=${hash}`
}

export function stampImportSpecifiers(source, specifierToHash) {
  let next = source
  for (const [specifier, hash] of Object.entries(specifierToHash)) {
    const bare = specifier.replace(/\?v=[0-9a-f]+$/i, '')
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(['"])${escaped}(?:\\?v=[0-9a-f]+)?(['"])`, 'g')
    next = next.replace(re, `$1${withVersion(bare, hash)}$2`)
  }
  return next
}

export function stampHtml(source, fileToHash, htmlRel) {
  const dir = path.dirname(path.join(root, htmlRel))
  let next = source
  for (const [rel, hash] of Object.entries(fileToHash)) {
    const abs = path.join(root, rel)
    const sitePath = '/' + rel.split(path.sep).join('/')
    const relativePath = './' + path.relative(dir, abs).split(path.sep).join('/')
    for (const ref of new Set([sitePath, relativePath, rel.split(path.sep).join('/')])) {
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(href|src)=(['"])${escaped}(?:\\?v=[0-9a-f]+)?(['"])`, 'g')
      next = next.replace(re, `$1=$2${withVersion(ref, hash)}$3`)
    }
  }
  return next
}

export function collectVersions() {
  const versions = {}
  for (const rel of leafAssets) versions[rel] = hashFile(rel)

  const modules = {}
  for (const [rel, specifiers] of Object.entries(stampedModules)) {
    const map = {}
    for (const specifier of specifiers) {
      const resolved = path.normalize(path.join(path.dirname(rel), specifier)).split(path.sep).join('/')
      if (!versions[resolved]) throw new Error(`missing hash for ${resolved} imported by ${rel}`)
      map[specifier] = versions[resolved]
    }
    const original = readFileSync(path.join(root, rel), 'utf8')
    const stamped = stampImportSpecifiers(original, map)
    modules[rel] = { original, stamped, map }
  }
  return { versions, modules }
}

export function stampAll({ write = true } = {}) {
  const { versions, modules } = collectVersions()
  const written = []
  for (const [rel, item] of Object.entries(modules)) {
    if (item.original !== item.stamped && write) {
      writeFileSync(path.join(root, rel), item.stamped)
      written.push(rel)
    }
    versions[rel] = sha10(item.stamped)
  }
  const htmlWrites = {}
  for (const rel of htmlFiles) {
    const original = readFileSync(path.join(root, rel), 'utf8')
    const stamped = stampHtml(original, versions, rel)
    htmlWrites[rel] = { original, stamped }
    if (original !== stamped && write) {
      writeFileSync(path.join(root, rel), stamped)
      written.push(rel)
    }
  }
  return { versions, modules, htmlWrites, written }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = stampAll({ write: true })
  console.log(JSON.stringify({ versions: result.versions, written: result.written }, null, 2))
}
