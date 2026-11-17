export const GMAIL_CHECK_API = 'https://claude-nx-subscription.bai1517735291.workers.dev/api/gmail/check'
export const GMAIL_HEALTH_API = 'https://claude-nx-subscription.bai1517735291.workers.dev/api/health'

export async function checkEmailBatch(emails, { signal } = {}) {
  const response = await fetch(GMAIL_CHECK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails }),
    cache: 'no-store',
    signal
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !Array.isArray(data.results)) {
    throw new Error(data.message || '查询失败')
  }
  return data.results
}
