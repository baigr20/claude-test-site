import { parseSessionInput } from './query.js?v=ac3a17e370'

const RESULT_TRANSFER_KEY = 'checkgpt.result.v2'
const WORKER_ORIGIN = 'https://claude-nx-subscription.bai1517735291.workers.dev'
let busy = false

document.addEventListener('DOMContentLoaded', initializeLandingPage)

function initializeLandingPage() {
  checkServiceStatus()
  window.setInterval(checkServiceStatus, 30000)
  document.getElementById('query-button')?.addEventListener('click', querySubscription)
  document.getElementById('clear-button')?.addEventListener('click', clearSession)
}

async function checkServiceStatus() {
  const status = document.getElementById('service-status')
  if (!status) return
  status.classList.remove('online', 'offline')
  status.classList.add('checking')
  status.setAttribute('aria-label', '正在确认查询服务状态')
  try {
    const response = await fetch(`${WORKER_ORIGIN}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.ok) throw new Error('service unavailable')
    status.classList.remove('checking', 'offline')
    status.classList.add('online')
    status.setAttribute('aria-label', '在线会员查询服务运行正常')
  } catch {
    status.classList.remove('checking', 'online')
    status.classList.add('offline')
    status.setAttribute('aria-label', '在线会员查询服务暂时无法连接')
  }
}

async function querySubscription() {
  if (busy) return
  const input = document.getElementById('session-json').value.trim()
  if (!input) return showInputError('请先粘贴 Session JSON')

  let session
  try { session = parseSessionInput(input) }
  catch (error) {
    showInputError(error.message)
    return
  }

  setBusy(true)
  showInputLoading('正在读取订阅与账单信息')
  try {
    const response = await fetch(`${WORKER_ORIGIN}/api/subscription/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      cache: 'no-store'
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.ok || !result.subscription || typeof result.actionToken !== 'string' || result.actionToken.length < 24) {
      throw new Error(result.message || '查询失败，请检查 Session 是否有效')
    }

    const transfer = JSON.stringify({
      type: 'chatgpt-billing-result-v2',
      createdAt: Date.now(),
      actionToken: result.actionToken,
      subscription: result.subscription,
      accountDiagnostics: result.accountDiagnostics || null,
      mobileBilling: result.mobileBilling || { status: 'unavailable', records: [] },
      queryMode: result.queryMode || 'unknown'
    })
    try { sessionStorage.setItem(RESULT_TRANSFER_KEY, transfer) } catch {}
    window.name = transfer
    session = null
    document.getElementById('session-json').value = ''
    window.location.assign('./result.html')
  } catch (error) {
    try { sessionStorage.removeItem(RESULT_TRANSFER_KEY) } catch {}
    window.name = ''
    showInputError(error instanceof Error ? error.message : '查询失败')
  } finally {
    setBusy(false)
  }
}

function showInputLoading(message) {
  document.getElementById('input-status').innerHTML = `
        <div class="input-message loading">
            <span class="query-spinner" aria-hidden="true"></span>
            <div><strong>${esc(message)}</strong><p>正在分别核对网页会员和移动端账单。</p></div>
        </div>`
}

function showInputError(message) {
  document.getElementById('input-status').innerHTML = `
        <div class="input-message error">
            <span>!</span>
            <div><strong>${esc(message)}</strong><p>支持完整或精简 Session JSON；需要浏览器会话的操作请补充 sessionToken。</p></div>
        </div>`
}

function clearSession() {
  if (busy) return
  document.getElementById('session-json').value = ''
  document.getElementById('input-status').innerHTML = ''
  try { sessionStorage.removeItem(RESULT_TRANSFER_KEY) } catch {}
  window.name = ''
}

function setBusy(value) {
  busy = value
  const queryButton = document.getElementById('query-button')
  const clearButton = document.getElementById('clear-button')
  if (queryButton) queryButton.disabled = value
  if (clearButton) clearButton.disabled = value
  if (queryButton) {
    queryButton.innerHTML = value
      ? '<span>正在映照…</span><b aria-hidden="true">·</b>'
      : '<span>照见我的订阅</span><b aria-hidden="true">→</b>'
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
