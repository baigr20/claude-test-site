export const MAX_CHECK_COUNT = 200
export const BATCH_SIZE = 50
export const STATUS_LABELS = {
  normal: '正常',
  abnormal: '异常',
  not_exist: '未注册',
  error: '错误'
}

const EMAIL_RE = /^(?!.*\.\.)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

export function looksLikePassword(line) {
  return /-{4,}|\||:/.test(String(line || ''))
}

export function isValidEmail(email) {
  const value = String(email || '')
  if (!value || value.length > 254) return false
  const at = value.indexOf('@')
  if (at < 1) return false
  if (value.slice(0, at).length > 64) return false
  return EMAIL_RE.test(value)
}

export function normalizeEmail(line) {
  const raw = String(line || '').trim()
  if (!raw) return ''
  const first = raw.split(/\s+/)[0]
  if (!first.includes('@')) return `${first}@gmail.com`
  const gmail = first.match(/^([^@]+)@gmail\.com.*$/i)
  if (gmail) return `${gmail[1]}@gmail.com`
  return first
}

export function parseEmailList(text) {
  const lines = String(text || '').split(/\r?\n/)
  const emails = []
  const seen = new Map()
  const invalid = []
  const duplicates = []

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index]
    const trimmed = original.trim()
    if (!trimmed) continue
    if (looksLikePassword(trimmed)) {
      return {
        ok: false,
        code: 'password',
        message: '不要导入密码，只需导入账号',
        emails: [],
        invalid: [],
        duplicates: []
      }
    }
    const email = normalizeEmail(trimmed)
    if (!isValidEmail(email)) {
      invalid.push({ line: index + 1, value: trimmed })
      continue
    }
    const key = email.toLowerCase()
    if (seen.has(key)) {
      duplicates.push({ line: index + 1, email, firstLine: seen.get(key) })
      continue
    }
    seen.set(key, index + 1)
    emails.push(email)
  }

  if (emails.length === 0 && invalid.length === 0) {
    return {
      ok: false,
      code: 'empty',
      message: '请先输入 Gmail 邮箱账号',
      emails: [],
      invalid,
      duplicates
    }
  }
  if (invalid.length) {
    return {
      ok: false,
      code: 'invalid',
      message: `第 ${invalid[0].line} 行不是有效邮箱：${invalid[0].value}`,
      emails,
      invalid,
      duplicates
    }
  }
  if (duplicates.length) {
    return {
      ok: false,
      code: 'duplicate',
      message: '有重复，请清理后重新开始',
      emails,
      invalid,
      duplicates
    }
  }
  if (emails.length > MAX_CHECK_COUNT) {
    return {
      ok: false,
      code: 'too_many',
      message: `单次最多检查 ${MAX_CHECK_COUNT} 个`,
      emails,
      invalid,
      duplicates
    }
  }
  return { ok: true, code: 'ok', message: '', emails, invalid, duplicates }
}

export function chunkEmails(emails, size = BATCH_SIZE) {
  const list = Array.isArray(emails) ? emails : []
  const batchSize = Math.max(1, Number(size) || BATCH_SIZE)
  const batches = []
  for (let index = 0; index < list.length; index += batchSize) {
    batches.push(list.slice(index, index + batchSize))
  }
  return batches
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.error
}

export function countByStatus(results) {
  const counts = { normal: 0, abnormal: 0, not_exist: 0, error: 0 }
  for (const item of Array.isArray(results) ? results : []) {
    const key = Object.hasOwn(counts, item?.status) ? item.status : 'error'
    counts[key] += 1
  }
  return counts
}

export function resultsToText(results, filter = 'all') {
  const rows = Array.isArray(results) ? results : []
  const filtered = filter === 'all' ? rows : rows.filter((item) => item.status === filter)
  return filtered.map((item) => `${item.email}\t${statusLabel(item.status)}`).join('\n')
}

export function resultsToCsv(results, filter = 'all') {
  const rows = Array.isArray(results) ? results : []
  const filtered = filter === 'all' ? rows : rows.filter((item) => item.status === filter)
  const lines = ['email,status', ...filtered.map((item) => `${item.email},${statusLabel(item.status)}`)]
  return `\uFEFF${lines.join('\n')}`
}
