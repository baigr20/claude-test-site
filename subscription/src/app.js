import { querySubscriptionLocally } from './query.js?v=95e3e08133'

const RESULT_TRANSFER_KEY = 'checkgpt.result.v2'
let busy = false

document.addEventListener('DOMContentLoaded', initializeLandingPage)

async function initializeLandingPage() {
  const status = document.getElementById('service-status')
  const privacy = document.getElementById('privacy-copy')
  let proxy = false
  try {
    const response = await fetch('/api/health', { cache: 'no-store' })
    if (response.ok) {
      const data = await response.json()
      proxy = Boolean(data?.ok && data.proxy)
    }
  } catch {}
  if (status) {
    status.classList.remove('checking', 'offline')
    status.classList.add('online')
    status.setAttribute('aria-label', proxy
      ? '同源代理可用，可向 ChatGPT 查询手机号、额度和账单'
      : '当前没有同源代理，仅在浏览器解析会话')
    const label = status.querySelector('b')
    if (label) label.textContent = proxy ? '同源代理可用' : '浏览器本地查询'
  }
  if (privacy) {
    privacy.textContent = proxy
      ? '查询会经本站同源代理向 ChatGPT 拉取手机号、额度和账单；代理只在内存中使用会话，不落盘、不记日志。'
      : '当前没有同源代理。会话只在浏览器里解析；跨域拦截时手机号、历史订单和订阅到期时间会是空的。'
  }
  document.getElementById('query-button')?.addEventListener('click', querySubscription)
  document.getElementById('clear-button')?.addEventListener('click', clearSession)
}

async function querySubscription() {
  if (busy) return
  const input = document.getElementById('session-json').value.trim()
  if (!input) return showInputError('请先粘贴 Session JSON')

  setBusy(true)
  showInputLoading('正在读取订阅信息')
  try {
    const result = await querySubscriptionLocally(input)
    if (!result?.ok || !result.subscription || !result.actionToken) {
      throw new Error(result?.message || '查询失败，请检查 Session 是否有效')
    }
    const transfer = JSON.stringify({
      type: 'chatgpt-billing-result-v2',
      createdAt: Date.now(),
      actionToken: result.actionToken,
      subscription: result.subscription,
      accountDiagnostics: result.accountDiagnostics || null,
      mobileBilling: result.mobileBilling || { status: 'unavailable', records: [] },
      queryMode: result.queryMode || 'browser-session'
    })
    try { sessionStorage.setItem(RESULT_TRANSFER_KEY, transfer) } catch {}
    window.name = transfer
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
            <div><strong>${esc(message)}</strong><p>先尝试同源代理；没有代理时再在浏览器里解析会话并直连 ChatGPT。</p></div>
        </div>`
}

function showInputError(message) {
  document.getElementById('input-status').innerHTML = `
        <div class="input-message error">
            <span>!</span>
            <div><strong>${esc(message)}</strong><p>支持完整或精简 Session JSON。有同源代理时只在内存中转发，不落盘。</p></div>
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
