import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  buildCpaZip,
  convertInputToCockpit,
  convertInputToCpa,
  convertInputToSub,
  inspectInputFormat
} from '../sub-cpa/src/converter.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function encodeJwt(payload) {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${json}.demo-signature-not-real`
}

function demoTokens(suffix = '001') {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: encodeJwt({
      sub: `demo-user-${suffix}`,
      email: `demo.${suffix}@example.test`,
      client_id: 'app_demo_local_converter',
      exp,
      'https://api.openai.com/profile': { email: `demo.${suffix}@example.test` }
    }),
    id_token: encodeJwt({
      sub: `demo-user-${suffix}`,
      email: `demo.${suffix}@example.test`,
      exp
    }),
    refresh_token: `rt-demo-not-a-real-token-${suffix}`
  }
}

function cpaRecord(suffix = '001') {
  const tokens = demoTokens(suffix)
  return {
    type: 'codex',
    account_id: `acc_demo_${suffix}`,
    chatgpt_account_id: `acc_demo_${suffix}`,
    email: `demo.${suffix}@example.test`,
    name: 'Demo User',
    plan_type: 'demo',
    ...tokens,
    account_note: 'Fictional test fixture'
  }
}

function subPayload(suffixes = ['001']) {
  return {
    type: 'sub2api-data',
    version: 1,
    exported_at: '2026-01-01T00:00:00.000Z',
    proxies: [],
    accounts: suffixes.map((suffix) => {
      const tokens = demoTokens(suffix)
      return {
        id: `sub_demo_${suffix}`,
        name: `demo.${suffix}@example.test`,
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          id_token: tokens.id_token,
          email: `demo.${suffix}@example.test`
        }
      }
    })
  }
}

function sessionRecord(suffix = '001') {
  const tokens = demoTokens(suffix)
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    user: {
      id: `user_demo_${suffix}`,
      email: `demo.${suffix}@example.test`,
      name: 'Demo Session'
    },
    account: {
      id: `acc_session_${suffix}`,
      planType: 'demo'
    }
  }
}

function subOutput(result) {
  if (result.output) return result.output
  if (result.payload) return JSON.stringify(result.payload)
  throw new Error('missing sub output')
}

function assertJsonValue(text) {
  const parsed = JSON.parse(text)
  assert.ok(parsed)
  return parsed
}

test('inspects CPA, Sub2API, session and RT link formats', () => {
  const cpa = inspectInputFormat(JSON.stringify(cpaRecord('010')))
  assert.equal(cpa.label, 'CPA/Codex')
  assert.equal(cpa.count, 1)

  const sub = inspectInputFormat(JSON.stringify(subPayload(['011'])))
  assert.equal(sub.label, 'Sub2API')
  assert.equal(sub.kind, 'sub')

  const session = inspectInputFormat(JSON.stringify(sessionRecord('012')))
  assert.equal(session.label, 'GPT Session/AT')

  const link = inspectInputFormat('https://example.test/callback?refresh_token=rt-demo-not-a-real-token-link&email=demo.link@example.test')
  assert.equal(link.label, 'RT 授权链接')
  assert.equal(link.count, 1)
})

test('converts CPA to SUB, Cockpit and normalized CPA', () => {
  const input = JSON.stringify(cpaRecord('020'))
  const sub = convertInputToSub(input)
  const subJson = assertJsonValue(subOutput(sub))
  assert.equal(subJson.type, 'sub2api-data')
  assert.equal(subJson.accounts.length, 1)
  assert.equal(subJson.accounts[0].credentials.refresh_token, 'rt-demo-not-a-real-token-020')
  assert.equal(sub.meta.count, 1)

  const cpa = convertInputToCpa(input)
  assert.match(cpa.output, /"type":\s*"codex"/)
  const row = JSON.parse(cpa.output)
  assert.equal(row.email, 'demo.020@example.test')
  assert.equal(cpa.meta.format, 'CPA JSONL')

  const cockpit = convertInputToCockpit(input)
  const doc = assertJsonValue(cockpit.output)
  assert.equal(doc.type, 'codex')
  assert.equal(doc.refresh_token, 'rt-demo-not-a-real-token-020')
  assert.equal(cockpit.meta.format, 'Cockpit JSON')
})

test('converts Sub2API to CPA and Cockpit', () => {
  const input = JSON.stringify(subPayload(['030', '031']))
  const cpa = convertInputToCpa(input)
  const rows = cpa.output.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].refresh_token, 'rt-demo-not-a-real-token-030')
  const cockpit = convertInputToCockpit(input)
  const docs = JSON.parse(cockpit.output)
  assert.equal(docs.length, 2)
})

test('converts GPT session JSON to all three targets', () => {
  const input = JSON.stringify(sessionRecord('040'))
  assert.equal(inspectInputFormat(input).kind, 'at')
  const cpa = convertInputToCpa(input)
  const row = JSON.parse(cpa.output)
  assert.equal(row.session_source, 'chatgpt_web_session')
  assert.equal(row.email, 'demo.040@example.test')
  const sub = convertInputToSub(input)
  assert.equal(JSON.parse(subOutput(sub)).accounts.length, 1)
  const cockpit = convertInputToCockpit(input)
  assert.equal(JSON.parse(cockpit.output).account_id, 'acc_session_040')
})

test('converts mixed Sub2API and CPA records', () => {
  const mixed = [subPayload(['050']).accounts[0], cpaRecord('051')]
  const inspection = inspectInputFormat(JSON.stringify(mixed))
  assert.equal(inspection.kind, 'mixed')
  const sub = convertInputToSub(JSON.stringify(mixed))
  assert.equal(JSON.parse(subOutput(sub)).accounts.length, 2)
  const cpa = convertInputToCpa(JSON.stringify(mixed))
  assert.equal(cpa.output.trim().split('\n').length, 2)
})

test('converts CPA JSONL and rejects invalid input', () => {
  const jsonl = `${JSON.stringify(cpaRecord('060'))}\n${JSON.stringify(cpaRecord('061'))}\n`
  const sub = convertInputToSub(jsonl)
  assert.equal(JSON.parse(subOutput(sub)).accounts.length, 2)

  assert.throws(() => inspectInputFormat('this is not json or a token link'), /格式无法识别/)
  assert.throws(() => convertInputToSub('{"hello":"world"}'), /缺少 access_token|格式无法识别|不是/)
  assert.throws(() => inspectInputFormat(''), /请输入或上传内容/)
})

test('file-shaped fixtures convert and CPA zip is a valid store archive', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sub-cpa-'))
  const file = path.join(dir, 'accounts.json')
  writeFileSync(file, JSON.stringify([cpaRecord('070'), cpaRecord('071')]))
  const text = readFileSync(file, 'utf8')
  const cpa = convertInputToCpa(text)
  assert.equal(cpa.records.length, 2)
  const zip = buildCpaZip(cpa.records)
  assert.ok(zip instanceof Uint8Array)
  assert.ok(zip.length > 40)
  assert.equal(String.fromCharCode(zip[0], zip[1], zip[2], zip[3]), 'PK\u0003\u0004')
})

test('published frontend does not call network or hidden account APIs', () => {
  const app = readFileSync(path.join(root, 'sub-cpa/src/app.js'), 'utf8')
  const home = readFileSync(path.join(root, 'index.html'), 'utf8')
  const tool = readFileSync(path.join(root, 'sub-cpa/index.html'), 'utf8')
  const theme = readFileSync(path.join(root, 'assets/theme.js'), 'utf8')
  const homeJs = readFileSync(path.join(root, 'assets/home.js'), 'utf8')
  const frontend = [app, home, tool, theme, homeJs].join('\n')

  for (const needle of [
    'XMLHttpRequest',
    'WebSocket(',
    'navigator.sendBeacon',
    'workbench-storage',
    'workbench-transfer',
    'aasfa.xgrok',
    'protocol-login',
    'workers.dev'
  ]) {
    assert.equal(frontend.includes(needle), false, `frontend still contains ${needle}`)
  }
  assert.equal(app.includes('/api/'), false)

  assert.match(app, /from '\.\/converter\.js(?:\?v=[0-9a-f]+)?'/)
  assert.doesNotMatch(app, /extractAdminAccountIds|buildAdminHealthRunnerScript/)
  assert.match(tool, /本地转换 · 不上传凭证/)
  assert.match(tool, /id="codexLoginDialog"/)
  assert.doesNotMatch(tool, /protocolLogin|workbench-storage/)
  assert.match(home, /本地处理，不上传凭证/)
  assert.match(home, /href="\/sub-cpa\/"/)
  assert.doesNotMatch(home, /公共问答|apiBase|grok-4\./)
})

test('CNAME and rollback backup are intact', () => {
  const cname = readFileSync(path.join(root, 'CNAME'), 'utf8').trim()
  assert.equal(cname, 'claude.nx.kg')
  const backupPath = '/workspace/backups/claude-test-site-pre-toolbox/index.html'
  if (!existsSync(backupPath)) return
  const backup = readFileSync(backupPath, 'utf8')
  assert.match(backup, /公共问答 · Grok/)
})
