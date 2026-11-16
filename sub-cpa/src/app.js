import {
  buildCpaZip,
  convertInputToCockpit,
  convertInputToCpa,
  convertInputToSub,
  inspectInputFormat,
  sliceSubPayload
} from './converter.js?v=ce3b9bdc91'
import {
  buildCodexAuthRequest,
  clearAllCodexPkce,
  readCodexCallbackError,
  readCodexCodeCallback,
  resolveCodexCodeCallbackInput
} from './codex-oauth.js?v=bd15b3e471'

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
  lastError: '',
  outputSignature: '',
  downloadCursor: 0,
  codexAuth: { url: '', codeVerifier: '', oauthState: '' },
  lastCodexCodeExchange: { key: '', input: '' }
}

let inputTimer = 0
let dragDepth = 0

function oauthOptions() {
  return {
    currentState: state.codexAuth.oauthState,
    currentVerifier: state.codexAuth.codeVerifier,
    storage: globalThis.localStorage,
    cache: state.lastCodexCodeExchange
  }
}

function setOverlayVisible(node, visible) {
  if (!node) return
  node.classList.toggle('is-visible', Boolean(visible))
  node.setAttribute('aria-hidden', visible ? 'false' : 'true')
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
  void convertCurrent({ silent: true })
}

function scheduleAutoConvert() {
  window.clearTimeout(inputTimer)
  const input = el('sourceText').value.trim()
  if (!input) {
    resetStatus('待转换')
    return
  }
  inputTimer = window.setTimeout(() => {
    if (readCodexCodeCallback(input) || readCodexCallbackError(input)) {
      void convertCurrent({ silent: false })
      return
    }
    try {
      inspectOrExplain(input)
      void convertCurrent({ silent: true })
    } catch {
      el('statStatus').textContent = '等待完整格式'
    }
  }, 650)
}

async function prepareConversionInput(text) {
  const authError = readCodexCallbackError(text)
  if (authError) throw new Error(authError)
  if (readCodexCodeCallback(text)) {
    el('statStatus').textContent = '正在向官方接口换票'
    return resolveCodexCodeCallbackInput(text, oauthOptions())
  }
  return text
}

function inspectOrExplain(text) {
  if (readCodexCallbackError(text)) {
    throw new Error(readCodexCallbackError(text))
  }
  if (readCodexCodeCallback(text)) {
    return {
      kind: 'codex_oauth_callback',
      label: 'Codex 官方授权回调',
      count: 1,
      missingRefreshToken: 0
    }
  }
  return inspectInputFormat(text)
}

async function convertCurrent({ silent = false } = {}) {
  const text = el('sourceText').value.trim()
  if (!text) {
    if (!silent) showToast('请先粘贴或上传内容')
    resetStatus('待转换')
    return
  }
  try {
    const prepared = await prepareConversionInput(text)
    if (prepared !== text && readCodexCodeCallback(text)) {
      el('sourceText').value = prepared
    }
    const result = buildResult(prepared, state.target)
    state.lastResult = result
    state.lastError = ''
    if (state.outputSignature !== result.output) {
      state.outputSignature = result.output
      state.downloadCursor = 0
    }
    el('outputText').value = result.output
    applyMeta(result.meta, '已转换')
    const warnings = result.meta?.warnings || []
    if (warnings.length) showToast(warnings.join('；'))
  } catch (error) {
    state.lastResult = null
    state.lastError = error.message || String(error)
    el('outputText').value = state.lastError
    applyMeta({ count: 0, missingRefreshToken: 0, format: TARGET_FORMAT[state.target] }, '转换失败')
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
    if (inspection.kind === 'codex_oauth_callback') {
      showToast('已识别为官方授权回调。点击“转换”后，本页会向 OpenAI 官方 token 接口换票，不会把链接发给其他服务。')
    } else {
      showToast(`已识别为 ${inspection.label}，共 ${inspection.count} 条`)
    }
  } catch (error) {
    applyMeta({ count: 0, missingRefreshToken: 0, format: TARGET_FORMAT[state.target] }, '无法识别')
    el('outputText').value = error.message || String(error)
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
  state.outputSignature = ''
  state.downloadCursor = 0
  el('outputText').value = ''
  applyMeta({ count: 0, missingRefreshToken: 0, format: TARGET_FORMAT[state.target] }, status)
}

function pasteDemo() {
  el('sourceText').value = `${JSON.stringify(buildDemoBundle(), null, 2)}\n`
  convertCurrent()
  showToast('已填入虚构示例，不能用于真实登录')
}

function clearAll() {
  window.clearTimeout(inputTimer)
  el('sourceText').value = ''
  if (el('fileInput')) el('fileInput').value = ''
  state.codexAuth = { url: '', codeVerifier: '', oauthState: '' }
  state.lastCodexCodeExchange = { key: '', input: '' }
  if (el('codexAuthUrl')) el('codexAuthUrl').value = ''
  if (el('codexCodeVerifier')) el('codexCodeVerifier').value = ''
  clearAllCodexPkce(globalThis.localStorage)
  closeCodexLoginDialog()
  closeDownloadDialog()
  resetStatus('待转换')
}

async function startCodexLogin() {
  const pendingWindow = window.open('about:blank', '_blank')
  if (pendingWindow) pendingWindow.opener = null
  try {
    const authRequest = await buildCodexAuthRequest()
    state.codexAuth = authRequest
    el('codexAuthUrl').value = authRequest.url
    el('codexCodeVerifier').value = authRequest.codeVerifier
    openCodexLoginDialog()
    openOfficialAuthUrl(authRequest.url, pendingWindow)
  } catch (error) {
    if (pendingWindow && !pendingWindow.closed) pendingWindow.close()
    showToast(error.message || '授权链接生成失败')
  }
}

function openCodexLoginDialog() {
  setOverlayVisible(el('codexLoginDialog'), true)
}

function closeCodexLoginDialog() {
  setOverlayVisible(el('codexLoginDialog'), false)
}

function openDownloadDialog() {
  const count = getCurrentOutputCount()
  const remaining = Math.max(0, count - state.downloadCursor)
  if (el('downloadLimit')) {
    el('downloadLimit').value = ''
    el('downloadLimit').max = String(remaining || count)
    el('downloadLimit').placeholder = state.downloadCursor > 0 ? `剩余 ${remaining} 条` : `全部 ${count} 条`
  }
  if (el('downloadHint')) {
    el('downloadHint').textContent = state.target === 'sub'
      ? buildDownloadHint(count, remaining, '确认后下载一个 Sub2API JSON 文件。')
      : state.target === 'cockpit'
        ? buildDownloadHint(count, remaining, '确认后下载一个 Cockpit JSON 文件。')
        : buildDownloadHint(count, remaining, '确认后下载 ZIP，每个账号一个 CPA JSON 文件。')
  }
  setOverlayVisible(el('downloadDialog'), true)
  window.setTimeout(() => el('downloadLimit')?.focus(), 0)
}

function closeDownloadDialog() {
  setOverlayVisible(el('downloadDialog'), false)
}

async function copyCodexAuthUrl() {
  if (!state.codexAuth.url) {
    showToast('请先生成授权链接')
    return
  }
  await navigator.clipboard.writeText(state.codexAuth.url)
  showToast('已复制授权链接')
}

function openCodexAuthUrl() {
  if (!state.codexAuth.url) {
    startCodexLogin()
    return
  }
  openOfficialAuthUrl(state.codexAuth.url)
}

function openOfficialAuthUrl(url, pendingWindow = null) {
  if (!url.startsWith('https://auth.openai.com/')) {
    showToast('授权链接不是 OpenAI 官方地址，已取消打开')
    if (pendingWindow && !pendingWindow.closed) pendingWindow.close()
    return
  }
  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.location.replace(url)
    showToast('已打开 Codex 授权页')
    return
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    showToast('浏览器拦截了新标签，请复制授权链接手动打开')
    return
  }
  showToast('已打开 Codex 授权页')
}

async function readFile(file) {
  const text = await file.text()
  el('sourceText').value = text
  convertCurrent()
  showToast(`已读取 ${file.name}`)
}

function getCurrentOutputCount() {
  const output = state.lastResult?.output
  if (!output) return 0
  if (state.target === 'sub') {
    return (JSON.parse(output).accounts || []).length
  }
  if (state.target === 'cockpit') {
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed.length : 1
  }
  return output.split(/\r?\n/).filter((line) => line.trim()).length
}

function buildDownloadHint(count, remaining, suffix) {
  if (state.downloadCursor > 0 && remaining > 0) {
    return `当前共 ${count} 条，已下载 ${state.downloadCursor} 条，本次从第 ${state.downloadCursor + 1} 条开始；${suffix}`
  }
  if (state.downloadCursor >= count && count > 0) {
    return `当前共 ${count} 条，上一轮已下载完；本次将从第 1 条重新开始。`
  }
  return `当前共 ${count} 条；${suffix}`
}

function getDownloadLimit() {
  const value = Number(el('downloadLimit')?.value)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function advanceDownloadCursor(downloadedCount, totalCount) {
  state.downloadCursor += downloadedCount
  if (state.downloadCursor > totalCount) state.downloadCursor = totalCount
}

function showDownloadToast(downloadedCount, totalCount) {
  const nextStart = state.downloadCursor + 1
  if (state.downloadCursor >= totalCount) {
    showToast(`已下载 ${downloadedCount} 条，当前内容已全部下载`)
    return
  }
  showToast(`已下载 ${downloadedCount} 条，下次从第 ${nextStart} 条开始`)
}

function downloadOutput() {
  if (!state.lastResult?.output) {
    showToast('没有可下载的输出')
    return
  }
  openDownloadDialog()
}

function confirmDownload(event) {
  event.preventDefault()
  const count = getCurrentOutputCount()
  if (count <= 0) {
    showToast('没有可下载的输出')
    return
  }
  if (state.downloadCursor >= count) state.downloadCursor = 0
  const requestedLimit = getDownloadLimit()
  const remaining = count - state.downloadCursor
  const limit = requestedLimit ? Math.min(requestedLimit, remaining) : remaining

  if (state.target === 'sub') {
    const payload = JSON.parse(state.lastResult.output)
    const limited = sliceSubPayload(payload, state.downloadCursor, limit)
    downloadBlob(new Blob([JSON.stringify(limited, null, 2)], { type: 'application/json' }), 'sub2api-import.json')
  } else if (state.target === 'cockpit') {
    const parsed = JSON.parse(state.lastResult.output)
    const records = Array.isArray(parsed) ? parsed : [parsed]
    const selected = records.slice(state.downloadCursor, state.downloadCursor + limit)
    const document = selected.length === 1 ? selected[0] : selected
    downloadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), 'cockpit-accounts.json')
  } else {
    const records = state.lastResult.output
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
    const zipBytes = buildCpaZip(records, limit, state.downloadCursor)
    downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), 'cpa-accounts.zip')
  }

  advanceDownloadCursor(limit, count)
  closeDownloadDialog()
  showDownloadToast(limit, count)
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
  if (!toast) return
  toast.textContent = message
  toast.classList.add('is-visible')
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove('is-visible')
  }, 2200)
}

function isFileDrag(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files')
}

function showDropOverlay() {
  el('dropZone')?.classList.add('is-dragging')
  setOverlayVisible(el('dropOverlay'), true)
}

function hideDropOverlay() {
  el('dropZone')?.classList.remove('is-dragging')
  setOverlayVisible(el('dropOverlay'), false)
  dragDepth = 0
}

function bindDrop() {
  window.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth += 1
    showDropOverlay()
  })
  window.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  })
  window.addEventListener('dragleave', (event) => {
    if (!isFileDrag(event) && dragDepth === 0) return
    event.preventDefault()
    dragDepth = Math.max(0, dragDepth - 1)
    if (!dragDepth) hideDropOverlay()
  })
  window.addEventListener('drop', async (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    hideDropOverlay()
    const file = event.dataTransfer?.files?.[0]
    if (file) await readFile(file)
  })
  el('dropZone')?.addEventListener('click', () => el('fileInput')?.click())
  el('dropZone')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      el('fileInput')?.click()
    }
  })
}

function bindEvents() {
  el('codexLogin')?.addEventListener('click', () => { void startCodexLogin() })
  el('closeCodexLogin')?.addEventListener('click', closeCodexLoginDialog)
  el('copyCodexAuthUrl')?.addEventListener('click', () => { void copyCodexAuthUrl() })
  el('openCodexAuthUrl')?.addEventListener('click', openCodexAuthUrl)
  el('codexLoginDialog')?.addEventListener('click', (event) => {
    if (event.target === el('codexLoginDialog')) closeCodexLoginDialog()
  })
  el('downloadOutput')?.addEventListener('click', downloadOutput)
  el('downloadForm')?.addEventListener('submit', confirmDownload)
  el('cancelDownload')?.addEventListener('click', closeDownloadDialog)
  el('downloadDialog')?.addEventListener('click', (event) => {
    if (event.target === el('downloadDialog')) closeDownloadDialog()
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCodexLoginDialog()
      closeDownloadDialog()
    }
  })
  el('targetCpa').addEventListener('click', () => setTarget('cpa'))
  el('targetCockpit').addEventListener('click', () => setTarget('cockpit'))
  el('targetSub').addEventListener('click', () => setTarget('sub'))
  el('convertNow').addEventListener('click', () => { void convertCurrent() })
  el('checkFormat').addEventListener('click', checkCurrentFormat)
  el('swapDirection').addEventListener('click', nextTarget)
  el('pasteDemo').addEventListener('click', pasteDemo)
  el('clearAll').addEventListener('click', clearAll)
  el('fileInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (file) await readFile(file)
  })
  el('sourceText').addEventListener('input', scheduleAutoConvert)
  el('sourceText').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void convertCurrent()
    }
  })
}

bindEvents()
bindDrop()
setTarget('sub', { convert: false })
