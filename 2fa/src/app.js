import {
  generateTotpFromInput,
  parseTotpInput,
  remainingSeconds
} from './totp.js?v=789b2de7d5'

const el = (id) => document.getElementById(id)

const state = {
  rawInput: '',
  parsed: null,
  code: '',
  timer: 0
}

function showToast(message) {
  const toast = el('toast')
  if (!toast) return
  toast.textContent = message
  toast.classList.add('is-visible')
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200)
}

function setStatus(text, kind = '') {
  const status = el('statusText')
  if (!status) return
  status.textContent = text
  status.dataset.kind = kind
}

function currentOtpDigits() {
  const code = String(state.code || '')
  return /^\d+$/.test(code) ? code : ''
}

function resetCopyButtonLabel() {
  const button = el('copyCode')
  if (!button) return
  window.clearTimeout(resetCopyButtonLabel.timer)
  button.textContent = '复制验证码'
  delete button.dataset.copiedCode
}

function updateCopyButton({ copied = false } = {}) {
  const button = el('copyCode')
  if (!button) return
  const code = currentOtpDigits()
  button.disabled = !code
  if (!code) {
    resetCopyButtonLabel()
    return
  }
  if (copied) {
    button.textContent = '已复制'
    button.dataset.copiedCode = code
    window.clearTimeout(resetCopyButtonLabel.timer)
    resetCopyButtonLabel.timer = window.setTimeout(resetCopyButtonLabel, 1600)
    return
  }
  if (button.dataset.copiedCode !== code) resetCopyButtonLabel()
}

function renderCode(code, remaining, period) {
  el('otpCode').textContent = code || '------'
  el('countdownText').textContent = code ? `${remaining} 秒后刷新` : '等待生成'
  const ratio = code && period ? remaining / period : 0
  el('countdownBar').style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`
  updateCopyButton()
}

function renderMeta(parsed) {
  const box = el('otpMeta')
  if (!parsed) {
    box.hidden = true
    box.textContent = ''
    return
  }
  const parts = [`${parsed.algorithm} · ${parsed.digits} 位 · ${parsed.period} 秒`]
  const title = [parsed.issuer, parsed.label].filter(Boolean).join(' / ')
  if (title) parts.unshift(title)
  box.hidden = false
  box.textContent = parts.join(' · ')
}

function clearResult() {
  state.parsed = null
  state.code = ''
  renderCode('', 0, 30)
  renderMeta(null)
}

async function refreshCode({ silent = false } = {}) {
  const text = el('secretInput').value
  state.rawInput = text
  if (!text.trim()) {
    clearResult()
    setStatus('等待输入', '')
    return
  }
  try {
    const parsed = parseTotpInput(text)
    const result = await generateTotpFromInput(text, { timestampMs: Date.now() })
    state.parsed = parsed
    state.code = result.code
    renderCode(result.code, result.remaining, result.period)
    renderMeta(result)
    setStatus('仅在当前页面内存中计算，不会上传或保存', 'ok')
  } catch (error) {
    clearResult()
    setStatus(error.message || String(error), 'error')
    if (!silent) showToast(error.message || String(error))
  }
}

function startClock() {
  window.clearInterval(state.timer)
  state.timer = window.setInterval(() => {
    if (!el('secretInput').value.trim() || !state.code) return
    const period = state.parsed?.period || 30
    const remaining = remainingSeconds(Date.now(), period)
    if (remaining === period || !state.code) {
      void refreshCode({ silent: true })
      return
    }
    renderCode(state.code, remaining, period)
  }, 250)
}

function clearAll() {
  el('secretInput').value = ''
  state.rawInput = ''
  clearResult()
  setStatus('已清空当前页面中的密钥和验证码', '')
  showToast('已清空')
  el('secretInput').focus()
}

async function copyCode() {
  const code = currentOtpDigits()
  if (!code) {
    showToast('还没有可复制的验证码')
    return
  }
  try {
    await navigator.clipboard.writeText(code)
    updateCopyButton({ copied: true })
    showToast('已复制')
  } catch {
    resetCopyButtonLabel()
    showToast('复制失败，请手动选择验证码')
  }
}

el('generateCode').addEventListener('click', () => { void refreshCode({ silent: false }) })
el('copyCode').addEventListener('click', () => { void copyCode() })
el('clearAll').addEventListener('click', clearAll)
el('secretInput').addEventListener('input', () => { void refreshCode({ silent: true }) })
el('secretForm').addEventListener('submit', (event) => {
  event.preventDefault()
  void refreshCode({ silent: false })
})

renderCode('', 0, 30)
setStatus('等待输入', '')
startClock()
