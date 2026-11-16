import { parseGrokPayload } from './parse.js?v=bf50bdbb4c'

const el = (id) => document.getElementById(id)

function setStatus(text, kind = '') {
  const status = el('statusText')
  status.textContent = text
  status.dataset.kind = kind
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

function addFact(list, label, value) {
  if (!value) return
  const row = document.createElement('div')
  const name = document.createElement('dt')
  const content = document.createElement('dd')
  name.textContent = label
  content.textContent = value
  row.append(name, content)
  list.append(row)
}

function daysText(item) {
  if (!item.expiry) return '没有到期时间'
  if (item.overdue && item.daysLeft < 0) return `已过 ${-item.daysLeft} 天`
  if (item.overdue) return item.overdueText ? `剩余 0 天，${item.overdueText}` : '剩余 0 天'
  return `剩余 ${item.daysLeft} 天`
}

function renderRow(item, isPrimary) {
  const article = document.createElement('article')
  article.className = 'sub-row'
  if (isPrimary) article.classList.add('is-primary')
  const title = document.createElement('h3')
  title.textContent = `${item.tierLabel} · ${item.statusLabel}`
  const meta = document.createElement('p')
  meta.textContent = [item.channelLabel, item.intervalLabel, item.productId, item.autoRenewLabel].filter(Boolean).join(' · ')
  const time = document.createElement('p')
  time.textContent = item.expiry
    ? `${daysText(item)} · 到期 ${item.expiryText}（北京时间）`
    : `${daysText(item)}${item.createdText ? ` · 创建于 ${item.createdText}` : ''}`
  article.append(title, meta, time)
  return article
}

function renderResult(result) {
  const panel = el('resultPanel')
  panel.hidden = false
  el('headline').textContent = result.summary.headline
  el('headlineDetail').textContent = result.summary.detail
  const facts = el('summary')
  clearNode(facts)
  addFact(facts, '主套餐', result.dominant.display || result.dominant.plan)
  addFact(facts, '套餐代码', result.dominant.plan && result.dominant.display ? result.dominant.plan : '')
  addFact(facts, '记录数', `${result.items.length} 条`)
  const rows = el('rows')
  clearNode(rows)
  result.items.forEach((item, index) => rows.append(renderRow(item, index === result.primaryIndex)))
}

function checkPayload(event) {
  event.preventDefault()
  try {
    const result = parseGrokPayload(el('payload').value, Date.now())
    renderResult(result)
    setStatus('已在本页解析，JSON 没有上传。', 'ok')
  } catch (error) {
    el('resultPanel').hidden = true
    setStatus(error.message || '无法解析', 'error')
  }
}

function clearAll() {
  el('payload').value = ''
  el('resultPanel').hidden = true
  setStatus('等待粘贴')
}

el('checkForm').addEventListener('submit', checkPayload)
el('clearAll').addEventListener('click', clearAll)
