import { BATCH_SIZE, MAX_CHECK_COUNT, parseEmailList } from '../gmail/src/parse.js'

export const UPSTREAM_CHECK = 'https://www.acctcheck.com/api/check'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const ALLOWED_STATUS = new Set(['normal', 'abnormal', 'not_exist', 'error'])

function asEmailList(payload) {
  if (Array.isArray(payload?.emails)) return payload.emails
  if (typeof payload?.text === 'string') return payload.text.split(/\r?\n/)
  return []
}

export function normalizeCheckPayload(payload) {
  const parsed = parseEmailList(asEmailList(payload).join('\n'))
  if (!parsed.ok) return { ok: false, message: parsed.message }
  return { ok: true, emails: parsed.emails }
}

function mapResult(item, fallbackEmail) {
  const email = typeof item?.email === 'string' && item.email ? item.email : fallbackEmail
  const status = ALLOWED_STATUS.has(item?.status) ? item.status : 'error'
  const detail = typeof item?.detail === 'string' ? item.detail : ''
  return { email, status, detail }
}

export async function checkUpstreamBatch(emails, fetchImpl = fetch) {
  const response = await fetchImpl(UPSTREAM_CHECK, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://www.acctcheck.com',
      Referer: 'https://www.acctcheck.com/zh-cn/',
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify({ emails })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !Array.isArray(data.results)) {
    const message = typeof data.error === 'string' && data.error
      ? data.error
      : `上游返回 HTTP ${response.status}`
    return emails.map((email) => ({ email, status: 'error', detail: message }))
  }
  const byEmail = new Map(data.results.map((item) => [String(item?.email || '').toLowerCase(), item]))
  return emails.map((email) => mapResult(byEmail.get(email.toLowerCase()), email))
}

export async function handleGmailCheck(payload, fetchImpl = fetch) {
  const normalized = normalizeCheckPayload(payload)
  if (!normalized.ok) return { status: 400, body: { ok: false, message: normalized.message } }
  if (normalized.emails.length > MAX_CHECK_COUNT) {
    return { status: 400, body: { ok: false, message: `单次最多检查 ${MAX_CHECK_COUNT} 个` } }
  }

  const results = []
  for (let index = 0; index < normalized.emails.length; index += BATCH_SIZE) {
    const batch = normalized.emails.slice(index, index + BATCH_SIZE)
    results.push(...await checkUpstreamBatch(batch, fetchImpl))
  }
  return { status: 200, body: { ok: true, results, total: results.length } }
}
