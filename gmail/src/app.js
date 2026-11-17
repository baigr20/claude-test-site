import {
  BATCH_SIZE,
  chunkEmails,
  countByStatus,
  parseEmailList,
  resultsToCsv,
  resultsToText,
  statusLabel
} from './parse.js?v=50cc8d9c95'
import { checkEmailBatch } from './query.js?v=247d234e1a'

const el = (id) => document.getElementById(id)

const state = {
  checking: false,
  paused: false,
  abort: null,
  pending: [],
  results: [],
  total: 0
}

function setStatus(text, kind = '') {
  const node = el('statusText')
  node.textContent = text
  node.dataset.kind = kind
}

function setActionMsg(text) {
  const node = el('actionMsg')
  node.textContent = text || ''
  node.hidden = !text
  if (text) window.setTimeout(() => {
    if (node.textContent === text) {
      node.textContent = ''
      node.hidden = true
    }
  }, 2400)
}

function updateLineNumbers() {
  const textarea = el('emailInput')
  const lines = textarea.value.split('\n')
  const count = lines.filter((line) => line.trim()).length
  el('emailCount').textContent = `${count} 个`
  el('lineNumbers').textContent = lines.map((_, index) => index + 1).join('\n') || '1'
}

function syncLineScroll() {
  el('lineNumbers').scrollTop = el('emailInput').scrollTop
}

function renderCounts() {
  const counts = countByStatus(state.results)
  el('countNormal').textContent = String(counts.normal)
  el('countAbnormal').textContent = String(counts.abnormal)
  el('countNotExist').textContent = String(counts.not_exist)
  el('countError').textContent = String(counts.error)
}

function renderProgress() {
  const done = state.results.length
  const total = state.total
  const pct = total ? Math.round((done / total) * 100) : 0
  el('statDone').textContent = String(done)
  el('statTotal').textContent = String(total)
  el('progressFill').style.width = `${pct}%`
  el('progressPercent').textContent = `${pct}%`
}

function currentFilter() {
  return el('filterStatus').value || 'all'
}

function applyFilter() {
  const filter = currentFilter()
  for (const row of el('resultList').querySelectorAll('.result-item')) {
    row.hidden = !(filter === 'all' || row.dataset.status === filter)
  }
}

function ensureResultList() {
  const empty = el('emptyState')
  if (empty) empty.remove()
}

function appendResult(item) {
  ensureResultList()
  const row = document.createElement('div')
  row.className = 'result-item'
  row.dataset.status = item.status
  const email = document.createElement('span')
  email.className = 'result-email'
  email.textContent = item.email
  const badge = document.createElement('span')
  badge.className = `result-badge is-${item.status}`
  badge.textContent = statusLabel(item.status)
  row.append(email, badge)
  el('resultList').append(row)
  el('resultList').scrollTop = el('resultList').scrollHeight
  applyFilter()
}

function resetResults() {
  state.results = []
  el('resultList').replaceChildren()
  const empty = document.createElement('div')
  empty.id = 'emptyState'
  empty.className = 'empty-state'
  empty.textContent = '检查结果将在此处实时显示'
  el('resultList').append(empty)
  renderCounts()
  renderProgress()
}

function setCheckingUi(checking) {
  el('checkButton').hidden = checking
  el('pauseButton').hidden = !checking
  el('spinner').hidden = !(checking && !state.paused)
  el('emailInput').disabled = checking
}

function setPausedUi(paused) {
  el('pauseButton').textContent = paused ? '继续检查' : '停止检查'
  el('spinner').hidden = paused
}

async function processQueue() {
  while (state.pending.length && !state.paused) {
    const batch = state.pending.shift()
    state.abort = new AbortController()
    try {
      const rows = await checkEmailBatch(batch, { signal: state.abort.signal })
      for (const row of rows) {
        if (state.paused) {
          const remain = rows.slice(rows.indexOf(row)).map((item) => item.email)
          state.pending.unshift(remain)
          return
        }
        state.results.push(row)
        appendResult(row)
        renderCounts()
        renderProgress()
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        state.pending.unshift(batch)
        return
      }
      for (const email of batch) {
        const row = { email, status: 'error', detail: error.message || '查询失败' }
        state.results.push(row)
        appendResult(row)
      }
      renderCounts()
      renderProgress()
    }
  }
  if (!state.pending.length && !state.paused) finishCheck('检查完成', 'ok')
}

function finishCheck(message, kind = '') {
  state.checking = false
  state.paused = false
  state.abort = null
  setCheckingUi(false)
  setPausedUi(false)
  if (state.total) {
    el('progressFill').style.width = '100%'
    el('progressPercent').textContent = '100%'
  }
  setStatus(message, kind)
}

async function startCheck(event) {
  event.preventDefault()
  if (state.checking) return
  const parsed = parseEmailList(el('emailInput').value)
  if (!parsed.ok) {
    setStatus(parsed.message, 'error')
    return
  }
  state.checking = true
  state.paused = false
  state.results = []
  state.total = parsed.emails.length
  state.pending = chunkEmails(parsed.emails, BATCH_SIZE)
  el('resultList').replaceChildren()
  renderCounts()
  renderProgress()
  setCheckingUi(true)
  setPausedUi(false)
  setStatus(`正在检查 ${parsed.emails.length} 个账号`, '')
  await processQueue()
}

function togglePause() {
  if (!state.checking) return
  state.paused = !state.paused
  setPausedUi(state.paused)
  if (state.paused) {
    state.abort?.abort()
    setStatus('已暂停', '')
    return
  }
  setStatus('继续检查', '')
  processQueue()
}

function clearInput() {
  el('emailInput').value = ''
  updateLineNumbers()
}

function clearAll() {
  if (state.checking) {
    state.paused = true
    state.abort?.abort()
    finishCheck('已清空', '')
  }
  clearInput()
  resetResults()
  state.pending = []
  state.total = 0
  renderProgress()
  setStatus('等待输入')
}

function copyResults() {
  const text = resultsToText(state.results, currentFilter())
  if (!text) {
    setActionMsg('暂无结果')
    return
  }
  navigator.clipboard.writeText(text).then(() => setActionMsg('复制成功'))
}

function exportResults() {
  const csv = resultsToCsv(state.results, currentFilter())
  if (csv.trim() === '\uFEFFemail,status') {
    setActionMsg('暂无结果')
    return
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `gmail_check_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
  setActionMsg('导出成功')
}

el('emailInput').addEventListener('input', updateLineNumbers)
el('emailInput').addEventListener('scroll', syncLineScroll)
el('checkForm').addEventListener('submit', startCheck)
el('pauseButton').addEventListener('click', togglePause)
el('clearInput').addEventListener('click', clearInput)
el('clearAll').addEventListener('click', clearAll)
el('filterStatus').addEventListener('change', applyFilter)
el('copyResults').addEventListener('click', copyResults)
el('exportResults').addEventListener('click', exportResults)
updateLineNumbers()
resetResults()
setStatus('等待输入')
