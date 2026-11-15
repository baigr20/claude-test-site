import {
  buildCpaZip,
  convertInputToCockpit,
  convertInputToCpa,
  convertInputToSub,
  inspectInputFormat
} from './converter.js'

const TARGETS = ['cpa', 'cockpit', 'sub']
const TARGET_LABELS = {
  cpa: 'CPA',
  cockpit: 'Cockpit',
  sub: 'SUB'
}
const TARGET_FORMAT = {
  cpa: 'CPA JSONL',
  cockpit: 'Cockpit JSON',
  sub: 'Sub2API'
}

const el = (id) => document.getElementById(id)

const state = {
  target: 'sub',
  lastResult: null,
  lastError: ''
}

function encodeJwt(payload) {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.demo-signature-not-real`
}

function buildDemoBundle() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const accessToken = encodeJwt({
    sub: 'demo-user-001',
    email: 'demo.user@example.test',
    client_id: 'app_demo_local_converter',
    exp
  })
  const idToken = encodeJwt({
    sub: 'demo-user-001',
    email: 'demo.user@example.test',
    exp
  })
  return {
    type: 'codex',
    account_id: 'acc_demo_001',
    chatgpt_account_id: 'acc_demo_001',
    email: 'demo.user@example.test',
    name: 'Demo User',
    plan_type: 'demo',
    access_token: accessToken,
    refresh_token: 'rt-demo-not-a-real-token-0001',
    id_token: idToken,
    account_note: 'Fictional NX toolbox example. Not a real credential.'
  }
}

function looksLikeCodeOnlyCallback(text) {
  const value = String(text || '')
  const hasCode = /(?:^|[?&#])code=/.test(value)
  const hasRefresh = /(?:refresh_token|refreshToken|rt)=/.test(value)
  const hasAccess = /(?:access_token|accessToken)=/.test(value)
  return hasCode && !hasRefresh && !hasAccess
}

function setTarget(target, { convert = true } = {}) {
  state.target = TARGETS.includes(target) ? target : 'sub'
  TARGETS.forEach((name) => {
    const button = el(`target${name[0].toUpperCase()}${name.slice(1)}`)
    if (button) button.classList.toggle('is-active', name === state.target)
  })
  el('statFormat').textContent = TARGET_FORMAT[state.target]
  el('outputTitle').textContent = `${TARGET_LABELS[state.target]} 输出`
  if (convert) convertIfInput()
}

function nextTarget() {
  const index = TARGETS.indexOf(state.target)
  setTarget(TARGETS[(index + 1) % TARGETS.length])
}

function convertIfInput() {
  if (!el('sourceText').value.trim()) {
    resetStatus('待转换')
    return
  }
  convertCurrent()
}

function inspectOrExplain(text) {
  if (looksLikeCodeOnlyCallback(text)) {
    throw new Error('检测到授权回调里只有 code，没有 refresh_token / rt。本页是纯本地转换，不会向授权服务器换票。请粘贴已包含刷新令牌或访问令牌的内容。')
  }
  return inspectInputFormat(text)
}

function convertCurrent() {
  const text = el('sourceText').value.trim()
  if (!text) {
    showToast('请先粘贴或上传内容')
    resetStatus('待转换')
    return
  }
  try {
    inspectOrExplain(text)
    const result = buildResult(text, state.target)
    state.lastResult = result
    state.lastError = ''
    el('outputText').value = result.output
    el('outputText').dataset.kind = 'ok'
    applyMeta(result.meta, '已转换')
    showWarnings(result.meta?.warnings || [])
  } catch (error) {
    state.lastResult = null
    state.lastError = error.message || String(error)
    el('outputText').value = state.lastError
    el('outputText').dataset.kind = 'error'
    applyMeta({ count: 0, missingRefreshToken: 0, format: TARGET_FORMAT[state.target] }, '转换失败')
    showWarnings([])
    showToast(state.lastError)
  }
}

function checkCurrentFormat() {
  const text = el('sourceText').value.trim()
  if (!text) {
    showToast('请先粘贴或上传内容')
    return
  }
  try {
    const inspection = inspectOrExplain(text)
    applyMeta({
      count: inspection.count,
      missingRefreshToken: inspection.missingRefreshToken,
      format: TARGET_FORMAT[state.target]
    }, `已识别：${inspection.label}`)
    showWarnings([])
    showToast(`已识别为 ${inspection.label}，共 ${inspection.count} 条`)
  } catch (error) {
    applyMeta({ count: 0, missingRefreshToken: 0, format: TARGET_FORMAT[state.target] }, '无法识别')
    el('outputText').value = error.message || String(error)
    el('outputText').dataset.kind = 'error'
    showToast(error.message || String(error))
  }
}

function withOutput(result) {
  if (result?.output) return result
  if (result?.payload) {
    return { ...result, output: JSON.stringify(result.payload, null, 2) }
  }
  throw new Error('转换结果为空')
}

function buildResult(text, target) {
  if (target === 'cpa') return withOutput(convertInputToCpa(text))
  if (target === 'cockpit') return withOutput(convertInputToCockpit(text))
  return withOutput(convertInputToSub(text))
}

function applyMeta(meta, status) {
  el('statCount').textContent = String(meta?.count ?? 0)
  el('statMissingRefresh').textContent = String(meta?.missingRefreshToken ?? 0)
  el('statFormat').textContent = meta?.format || TARGET_FORMAT[state.target]
  el('statStatus').textContent = status
}

function resetStatus(status) {
  state.lastResult = null
  state.lastError = ''
  el('outputText').value = ''
  el('outputText').dataset.kind = ''
  applyMeta({ count: 0, missingRefreshToken: 0, format: TARGET_FORMAT[state.target] }, status)
  showWarnings([])
}

function showWarnings(warnings) {
  const box = el('warningBox')
  if (!warnings.length) {
    box.hidden = true
    box.textContent = ''
    return
  }
  box.hidden = false
  box.textContent = warnings.join('；')
}

function pasteDemo() {
  el('sourceText').value = `${JSON.stringify(buildDemoBundle(), null, 2)}\n`
  convertCurrent()
  showToast('已填入虚构示例，不能用于真实登录')
}

function clearAll() {
  el('sourceText').value = ''
  el('fileInput').value = ''
  resetStatus('待转换')
}

async function readFile(file) {
  const text = await file.text()
  el('sourceText').value = text
  convertCurrent()
  showToast(`已读取 ${file.name}`)
}

function downloadOutput() {
  if (!state.lastResult?.output) {
    showToast('还没有可下载的转换结果')
    return
  }
  const target = state.target
  const filename = target === 'cpa' ? 'cpa-records.jsonl' : target === 'cockpit' ? 'cockpit.json' : 'sub2api.json'
  const type = 'application/json;charset=utf-8'
  downloadBlob(new Blob([state.lastResult.output], { type }), filename)
}

function downloadCpaZip() {
  if (!state.lastResult?.records?.length || state.target !== 'cpa') {
    showToast('请先把目标设为 CPA 并完成转换，再下载 ZIP')
    return
  }
  const zip = buildCpaZip(state.lastResult.records)
  downloadBlob(new Blob([zip], { type: 'application/zip' }), 'cpa-records.zip')
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function showToast(message) {
  const toast = el('toast')
  toast.textContent = message
  toast.hidden = false
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => { toast.hidden = true }, 3200)
}

function isFileDrag(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files')
}

function bindDrop() {
  const overlay = el('dropOverlay')
  const zone = el('dropZone')
  let dragDepth = 0

  const show = () => { overlay.hidden = false }
  const hide = () => { overlay.hidden = true; dragDepth = 0; zone.classList.remove('is-hot') }

  window.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth += 1
    show()
    zone.classList.add('is-hot')
  })
  window.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
  })
  window.addEventListener('dragleave', (event) => {
    if (!isFileDrag(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (!dragDepth) hide()
  })
  window.addEventListener('drop', async (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    hide()
    const file = event.dataTransfer?.files?.[0]
    if (file) await readFile(file)
  })
}

el('targetCpa').addEventListener('click', () => setTarget('cpa'))
el('targetCockpit').addEventListener('click', () => setTarget('cockpit'))
el('targetSub').addEventListener('click', () => setTarget('sub'))
el('convertNow').addEventListener('click', convertCurrent)
el('checkFormat').addEventListener('click', checkCurrentFormat)
el('swapDirection').addEventListener('click', nextTarget)
el('pasteDemo').addEventListener('click', pasteDemo)
el('clearAll').addEventListener('click', clearAll)
el('downloadOutput').addEventListener('click', downloadOutput)
el('downloadZip').addEventListener('click', downloadCpaZip)
el('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (file) await readFile(file)
})
el('sourceText').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    convertCurrent()
  }
})

bindDrop()
setTarget('sub', { convert: false })
