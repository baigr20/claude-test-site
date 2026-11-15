const SUB2API_DATA_TYPE = 'sub2api-data'
const LEGACY_SUB2API_DATA_TYPE = 'sub2api-bundle'
const DEFAULT_OPENAI_CLIENT_ID = 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH'

export function convertCpaToSub(input, options = {}) {
  const records = parseFlexibleInput(input)
  const now = toRfc3339(new Date())
  const accounts = []
  const warnings = []

  records.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`第 ${index + 1} 条不是 JSON 对象`)
    }
    record = normalizeInputRecord(record)

    const accessToken = firstString(
      record.access_token,
      record.accessToken,
      getPath(record, ['tokens', 'access_token']),
      getPath(record, ['tokens', 'accessToken']),
      record.token
    )
    const idToken = firstString(
      record.id_token,
      record.idToken,
      getPath(record, ['tokens', 'id_token']),
      getPath(record, ['tokens', 'idToken'])
    )
    const refreshToken = firstString(
      record.refresh_token,
      record.refreshToken,
      getPath(record, ['tokens', 'refresh_token']),
      getPath(record, ['tokens', 'refreshToken']),
      record.rt
    )
    if (!accessToken && !refreshToken) {
      throw new Error(`第 ${index + 1} 条缺少 access_token/accessToken 或 refresh_token/rt`)
    }

    const accessClaims = decodeJwtPayload(accessToken)
    const idClaims = decodeJwtPayload(idToken)
    const auth = mergeAuthClaims(idClaims, accessClaims)
    const profile = objectOrEmpty(accessClaims['https://api.openai.com/profile'])

    const expEpoch = toEpochSeconds(accessClaims.exp) ?? parseDateToEpoch(record.expired) ?? parseDateToEpoch(record.expires_at)
    const credentials = {}

    if (accessToken) {
      credentials.access_token = accessToken
      if (expEpoch) {
        credentials.expires_at = toRfc3339(new Date(expEpoch * 1000))
      } else {
        warnings.push(`第 ${index + 1} 条无法解析 access_token 过期时间`)
      }
    }

    if (refreshToken) {
      credentials.refresh_token = refreshToken
      credentials.client_id = firstString(record.client_id, accessClaims.client_id, DEFAULT_OPENAI_CLIENT_ID)
    }
    if (idToken) credentials.id_token = idToken

    setIfPresent(credentials, 'email', firstString(record.email, validEmail(record.name), idClaims.email, accessClaims.email, profile.email))
    setIfPresent(credentials, 'chatgpt_account_id', firstString(record.chatgpt_account_id, record.account_id, auth.chatgpt_account_id, buildRtAccountId(refreshToken, index)))
    setIfPresent(credentials, 'chatgpt_user_id', firstString(record.chatgpt_user_id, auth.chatgpt_user_id, auth.user_id, accessClaims.sub))
    setIfPresent(credentials, 'organization_id', firstString(record.organization_id, record.org_id, auth.poid, pickDefaultOrganization(auth.organizations)))
    setIfPresent(credentials, 'plan_type', firstString(record.chatgpt_plan_type, record.plan_type, auth.chatgpt_plan_type))

    const extra = {
      import_source: 'cpa_converter',
      imported_at: now
    }
    if (accessToken) extra.access_token_sha256 = stableFingerprint(accessToken)
    setIfPresent(extra, 'last_refresh', firstString(record.last_refresh, record.lastRefresh))
    setIfPresent(extra, 'source_type', firstString(record.type))
    setIfPresent(extra, 'session_source', firstString(record.session_source, record.sessionSource))
    setIfPresent(extra, 'user_image', firstString(record.user_image, record.userImage))
    if (firstString(record.session_token, record.sessionToken)) {
      extra.session_token_present = true
      warnings.push(`第 ${index + 1} 条包含 session_token，已按 Sub2API 规则忽略`)
    }

    const account = {
      name: firstString(record.name, record.email, credentials.email, credentials.chatgpt_account_id, `RT 导入账号 ${index + 1}`),
      platform: 'openai',
      type: 'oauth',
      credentials,
      extra,
      concurrency: normalizeNonNegativeInt(options.concurrency, 3),
      priority: normalizeNonNegativeInt(options.priority, 50)
    }

    if (accessToken && !refreshToken && expEpoch) {
      account.expires_at = expEpoch
      account.auto_pause_on_expired = true
    }

    accounts.push(account)
  })
  applyUniqueSubAccountIdentities(accounts, warnings)

  return {
    payload: {
      type: SUB2API_DATA_TYPE,
      version: 1,
      exported_at: now,
      proxies: [],
      accounts
    },
    meta: summarizeAccounts(accounts, warnings, 'Sub2API')
  }
}

export function convertSubToCpa(input, options = {}) {
  const payload = parseSubPayload(input)
  const accounts = payload.accounts || []
  const warnings = []
  const records = accounts.map((account, index) => {
    const credentials = objectOrEmpty(account.credentials)
    const extra = objectOrEmpty(account.extra)
    const accessToken = firstString(credentials.access_token, credentials.accessToken)
    const refreshToken = firstString(credentials.refresh_token, credentials.refreshToken)
    if (!accessToken && !refreshToken) {
      throw new Error(`第 ${index + 1} 个账号缺少 credentials.access_token 或 credentials.refresh_token`)
    }

    if (!refreshToken) {
      warnings.push(`第 ${index + 1} 个账号缺少 refresh_token`)
    }

    const cpa = {
      type: firstString(extra.source_type, 'codex'),
      account_id: firstString(credentials.chatgpt_account_id, credentials.account_id),
      chatgpt_account_id: firstString(credentials.chatgpt_account_id, credentials.account_id),
      email: firstString(credentials.email),
      name: firstString(account.name, credentials.email),
      plan_type: firstString(credentials.plan_type),
      chatgpt_plan_type: firstString(credentials.plan_type),
      id_token: firstString(credentials.id_token),
      id_token_synthetic: Boolean(credentials.id_token_synthetic),
      access_token: accessToken,
      refresh_token: refreshToken,
      session_token: '',
      last_refresh: firstString(extra.last_refresh, extra.imported_at, payload.exported_at),
      expired: firstString(credentials.expires_at, epochToRfc3339(account.expires_at))
    }

    return pruneEmpty(cpa, options.keepEmptyFields !== false)
  })
  applyUniqueCpaRecordIdentities(records, warnings)

  return {
    records,
    output: records.map((record) => JSON.stringify(record)).join('\n'),
    meta: summarizeCpaRecords(records, warnings)
  }
}

export function repairSecondVerifyJson(sessionInput, repairInput) {
  const sources = buildSecondVerifySources(sessionInput)
  if (!sources.length) {
    throw new Error('session 输入缺少可用于修正的 access_token')
  }

  const repairDocuments = normalizeSecondVerifyRepairDocuments(repairInput)
  if (!repairDocuments.length) {
    throw new Error('请上传或粘贴带 refresh_token 的二验 JSON')
  }

  const repairResult = buildSecondVerifyDocument(sources, repairDocuments)
  const output = repairResult.stats.replaced > 0
    ? JSON.stringify(repairResult.document, null, 2)
    : ''

  return {
    document: repairResult.document,
    output,
    meta: summarizeSecondVerifyRepair(repairResult)
  }
}

export function convertAtToCpa(input, options = {}) {
  const records = parseFlexibleInput(input)
  const cpaRecords = records.map((record, index) => {
    if (!isAtSessionRecord(record)) {
      throw new Error(`第 ${index + 1} 条不是 GPT Session/AT JSON`)
    }
    return pruneEmpty(normalizeChatGptSession(record), options.keepEmptyFields !== false)
  })
  const warnings = []
  applyUniqueCpaRecordIdentities(cpaRecords, warnings)
  return {
    records: cpaRecords,
    output: cpaRecords.map((record) => JSON.stringify(record)).join('\n'),
    meta: summarizeCpaRecords(cpaRecords, warnings)
  }
}

export function convertInputToSub(input, options = {}) {
  const inspection = inspectInputFormat(input)
  if (inspection.kind === 'sub') {
    return convertSubToSub(input)
  }
  if (inspection.kind === 'mixed') {
    return convertMixedToSub(input, options)
  }
  return convertCpaToSub(input, options)
}

export function convertInputToCpa(input, options = {}) {
  const inspection = inspectInputFormat(input)
  if (inspection.kind === 'sub') {
    return convertSubToCpa(input, options)
  }
  if (inspection.kind === 'at') {
    return convertAtToCpa(input, options)
  }
  if (inspection.kind === 'mixed') {
    return convertMixedToCpa(input, options)
  }
  return convertCpaToCpa(input, options)
}

export function convertInputToCockpit(input, options = {}) {
  const cpaResult = convertInputToCpa(input, { ...options, keepEmptyFields: true })
  const records = cpaResult.records.map((record) => pruneEmpty({
    type: 'codex',
    id_token: firstString(record.id_token),
    access_token: firstString(record.access_token),
    refresh_token: firstString(record.refresh_token),
    account_id: firstString(record.account_id, record.chatgpt_account_id),
    last_refresh: firstString(record.last_refresh),
    email: firstString(record.email),
    expired: firstString(record.expired),
    account_note: firstString(record.account_note)
  }, options.keepEmptyFields !== false))
  const document = records.length === 1 ? records[0] : records

  return {
    records,
    document,
    output: JSON.stringify(document, null, 2),
    meta: {
      ...cpaResult.meta,
      format: 'Cockpit JSON'
    }
  }
}

function convertMixedToSub(input, options = {}) {
  const { subAccounts, cpaRecords } = splitConvertibleRecords(input)
  const warnings = []
  const accounts = subAccounts.map((account) => cloneSubAccount(account))

  if (cpaRecords.length) {
    const cpaResult = convertCpaToSub(JSON.stringify(cpaRecords), options)
    accounts.push(...cpaResult.payload.accounts)
    warnings.push(...cpaResult.meta.warnings)
  }

  applyUniqueSubAccountIdentities(accounts, warnings)

  return {
    payload: {
      type: SUB2API_DATA_TYPE,
      version: 1,
      exported_at: toRfc3339(new Date()),
      proxies: [],
      accounts
    },
    meta: summarizeAccounts(accounts, warnings, 'Sub2API')
  }
}

function convertMixedToCpa(input, options = {}) {
  const { subAccounts, cpaRecords } = splitConvertibleRecords(input)
  const warnings = []
  const records = []

  if (subAccounts.length) {
    const subResult = convertSubToCpa(JSON.stringify(buildSubPayloadFromAccounts(subAccounts)), options)
    records.push(...subResult.records)
    warnings.push(...subResult.meta.warnings)
  }

  if (cpaRecords.length) {
    const cpaResult = convertCpaToCpa(JSON.stringify(cpaRecords), options)
    records.push(...cpaResult.records)
    warnings.push(...cpaResult.meta.warnings)
  }

  applyUniqueCpaRecordIdentities(records, warnings)

  return {
    records,
    output: records.map((record) => JSON.stringify(record)).join('\n'),
    meta: summarizeCpaRecords(records, warnings)
  }
}

export function convertCpaToCpa(input, options = {}) {
  const records = parseFlexibleInput(input)
  const warnings = []
  const cpaRecords = records.map((record, index) => {
    const normalized = normalizeCpaRecord(record, index)
    if (!normalized.refresh_token) {
      warnings.push(`第 ${index + 1} 条缺少 refresh_token`)
    }
    return pruneEmpty(normalized, options.keepEmptyFields !== false)
  })
  applyUniqueCpaRecordIdentities(cpaRecords, warnings)

  return {
    records: cpaRecords,
    output: cpaRecords.map((record) => JSON.stringify(record)).join('\n'),
    meta: summarizeCpaRecords(cpaRecords, warnings)
  }
}

export function convertSubToSub(input) {
  const payload = parseSubPayload(input)
  const invalidIndex = payload.accounts.findIndex((account) => !hasSubUsableCredentials(account))
  if (invalidIndex >= 0) {
    throw new Error(`第 ${invalidIndex + 1} 个账号缺少 credentials.access_token 或 credentials.refresh_token`)
  }

  const normalizedPayload = {
    ...payload,
    type: SUB2API_DATA_TYPE,
    version: payload.version || 1,
    exported_at: firstString(payload.exported_at) || toRfc3339(new Date()),
    proxies: Array.isArray(payload.proxies) ? payload.proxies : [],
    accounts: payload.accounts.map((account) => ({
      ...account,
      credentials: { ...objectOrEmpty(account?.credentials) },
      extra: { ...objectOrEmpty(account?.extra) }
    }))
  }
  const warnings = []
  applyUniqueSubAccountIdentities(normalizedPayload.accounts, warnings)

  return {
    payload: normalizedPayload,
    meta: summarizeAccounts(normalizedPayload.accounts, warnings, 'Sub2API')
  }
}

export function limitSubPayload(payload, count) {
  const normalizedCount = normalizeLimitCount(count)
  if (!normalizedCount) {
    return payload
  }
  return sliceSubPayload(payload, 0, normalizedCount)
}

export function sliceSubPayload(payload, start = 0, count = 0) {
  const normalizedStart = normalizeRangeStart(start)
  const normalizedCount = normalizeLimitCount(count)
  const accounts = payload.accounts || []
  const nextPayload = { ...payload }
  nextPayload.accounts = normalizedCount
    ? accounts.slice(normalizedStart, normalizedStart + normalizedCount)
    : accounts.slice(normalizedStart)
  return nextPayload
}

export function limitCpaRecords(records, count) {
  const normalizedCount = normalizeLimitCount(count)
  if (!normalizedCount) {
    return records
  }
  return sliceCpaRecords(records, 0, normalizedCount)
}

export function sliceCpaRecords(records, start = 0, count = 0) {
  const normalizedStart = normalizeRangeStart(start)
  const normalizedCount = normalizeLimitCount(count)
  const source = records || []
  return normalizedCount
    ? source.slice(normalizedStart, normalizedStart + normalizedCount)
    : source.slice(normalizedStart)
}

export function buildCpaZip(records, count = 0, start = 0) {
  const normalizedStart = normalizeRangeStart(start)
  const selectedRecords = sliceCpaRecords(records, normalizedStart, count)
  const files = selectedRecords.map((record, index) => {
    const name = buildCpaFileName(record, normalizedStart + index)
    const content = JSON.stringify(record, null, 2)
    return {
      name,
      bytes: utf8Bytes(content)
    }
  })
  return buildStoreZip(files)
}

export function inspectInputFormat(input) {
  const text = String(input ?? '').trim()
  if (!text) {
    throw new Error('请输入或上传内容')
  }

  const errors = []
  try {
    const payload = parseSubPayload(text)
    const invalidIndex = payload.accounts.findIndex((account) => !hasSubUsableCredentials(account))
    if (invalidIndex >= 0) {
      throw new Error(`第 ${invalidIndex + 1} 个账号缺少 credentials.access_token 或 credentials.refresh_token`)
    }
    return {
      kind: 'sub',
      label: 'Sub2API',
      count: payload.accounts.length,
      missingRefreshToken: countSubMissingRefreshToken(payload.accounts)
    }
  } catch (error) {
    errors.push(`Sub2API：${error.message}`)
  }

  try {
    const records = parseFlexibleInput(text)
    if (records.length === 0) {
      throw new Error('没有可转换的记录')
    }
    const { subAccounts, cpaRecords, invalidIndex } = splitConvertibleRecordsFromValues(records)
    if (invalidIndex >= 0) {
      throw new Error(`第 ${invalidIndex + 1} 条缺少 access_token/accessToken 或 refresh_token/rt`)
    }
    if (subAccounts.length && cpaRecords.length) {
      return {
        kind: 'mixed',
        label: 'Sub2API + CPA/Codex',
        count: records.length,
        missingRefreshToken: countSubMissingRefreshToken(subAccounts) + cpaRecords.filter((record) => !getCpaRefreshToken(record)).length
      }
    }
    const allAtSession = cpaRecords.every((record) => isAtSessionRecord(record))
    const allRtLinks = cpaRecords.every((record) => isRtLinkRecord(record))
    return {
      kind: allAtSession ? 'at' : 'cpa',
      label: allAtSession ? 'GPT Session/AT' : allRtLinks ? 'RT 授权链接' : 'CPA/Codex',
      count: cpaRecords.length,
      missingRefreshToken: cpaRecords.filter((record) => !getCpaRefreshToken(record)).length
    }
  } catch (error) {
    errors.push(`CPA/Codex：${error.message}`)
  }

  throw new Error(`格式无法识别。${errors.join('；')}`)
}

export function parseFlexibleInput(input) {
  const text = String(input ?? '').trim()
  if (!text) return []

  const authCallbackError = readAuthCallbackError(text)
  if (authCallbackError) {
    throw new Error(authCallbackError)
  }

  try {
    const parsed = JSON.parse(text)
    return flattenInputValue(parsed)
  } catch {
    try {
      return parseNdjson(text)
    } catch {
      try {
        return parseRtLinks(text)
      } catch {
        return parseEmbeddedJsonObjects(text)
      }
    }
  }
}

export function parseSubPayload(input) {
  const text = String(input ?? '').trim()
  if (!text) throw new Error('请输入 Sub2API JSON')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    try {
      const records = parseNdjson(text)
      if (records.length && records.every(isSubAccountRecord)) {
        return buildSubPayloadFromAccounts(records)
      }
    } catch {
      // 非 Sub2API 账号 JSONL 时保留原始 JSON 解析错误，交给后续格式分支补充诊断。
    }
    try {
      const records = parseEmbeddedJsonObjects(text)
      if (records.length && records.every(isSubAccountRecord)) {
        return buildSubPayloadFromAccounts(records)
      }
    } catch {
      // 带订单头、说明文本或 RTF 包裹的内容若不是 Sub2API 账号对象，继续保留原始 JSON 解析错误。
    }
    throw new Error(`Sub2API JSON 解析失败：${error.message}`)
  }

  const payload = normalizeSubPayloadShape(parsed)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Sub2API 数据必须是 JSON 对象')
  }
  if (payload.type && payload.type !== SUB2API_DATA_TYPE && payload.type !== LEGACY_SUB2API_DATA_TYPE) {
    throw new Error(`不支持的数据类型：${payload.type}`)
  }
  if (!Array.isArray(payload.accounts)) {
    throw new Error('Sub2API 数据缺少 accounts 数组')
  }
  if (!Array.isArray(payload.proxies)) {
    payload.proxies = []
  }
  return payload
}

function buildSecondVerifySources(input) {
  const text = String(input ?? '').trim()
  if (!text) return []

  try {
    const payload = parseSubPayload(text)
    return payload.accounts
      .map((account) => {
        const credentials = objectOrEmpty(account?.credentials)
        const extra = objectOrEmpty(account?.extra)
        return {
          accessToken: firstString(credentials.access_token, credentials.accessToken),
          email: firstString(credentials.email, extra.email, account?.email, account?.name),
          accountId: firstString(
            credentials.chatgpt_account_id,
            credentials.account_id,
            account?.chatgpt_account_id,
            account?.account_id
          )
        }
      })
      .filter((source) => source.accessToken)
  } catch {
    // 非 Sub2API 输入继续按 CPA/GPT Session/JSONL/RT 链接解析。
  }

  return parseFlexibleInput(text)
    .map((record, index) => normalizeCpaRecord(record, index))
    .map((record) => ({
      accessToken: firstString(record.access_token, record.accessToken),
      email: firstString(record.email, record.name),
      accountId: firstString(record.chatgpt_account_id, record.account_id)
    }))
    .filter((source) => source.accessToken)
}

function normalizeSecondVerifyRepairDocuments(input) {
  if (Array.isArray(input) && input.every(isSecondVerifyRepairDocument)) {
    return input.map((item, index) => ({
      sourceName: firstString(item.sourceName, `repair-${index + 1}.json`),
      value: cloneJson(item.value)
    }))
  }

  const value = typeof input === 'string' ? parseSecondVerifyRepairJson(input) : input
  if (value === undefined || value === null) {
    return []
  }

  return [{
    sourceName: 'pasted-json',
    value: cloneJson(value)
  }]
}

function isSecondVerifyRepairDocument(item) {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, 'value'))
}

function parseSecondVerifyRepairJson(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`二验 JSON 解析失败：${error.message}`)
  }
}

function buildSecondVerifyDocument(sources, repairDocuments) {
  const outputs = []
  const skipped = []
  const stats = { targets: 0, replaced: 0 }
  let targetIndex = 0

  repairDocuments.forEach((documentItem) => {
    const clonedValue = cloneJson(documentItem.value)
    const targets = collectSecondVerifyTargets(clonedValue, documentItem.sourceName)

    if (!targets.length) {
      skipped.push({
        sourceName: documentItem.sourceName,
        path: '$',
        reason: '未找到同时包含 refresh_token 和 access_token 的对象'
      })
    }

    targets.forEach((target) => {
      const match = findSecondVerifyMatch(sources, target, targetIndex)
      stats.targets += 1

      if (match?.accessToken && replaceSecondVerifyAccessToken(target.value, match.accessToken)) {
        stats.replaced += 1
      } else {
        skipped.push({
          sourceName: target.sourceName,
          path: target.path,
          reason: '未找到可匹配的 session access_token'
        })
      }

      targetIndex += 1
    })

    outputs.push(clonedValue)
  })

  return {
    document: outputs.length === 1 ? outputs[0] : outputs,
    skipped,
    stats
  }
}

function collectSecondVerifyTargets(value, sourceName = 'uploaded-json') {
  const found = []
  const visited = new WeakSet()

  function visit(item, path, inheritedIdentity = {}) {
    if (!isJsonObject(item) && !Array.isArray(item)) {
      return
    }

    if (isJsonObject(item)) {
      if (visited.has(item)) {
        return
      }
      visited.add(item)

      const localIdentity = getSecondVerifyIdentity(item)
      const identity = {
        email: firstString(localIdentity.email, inheritedIdentity.email),
        accountId: firstString(localIdentity.accountId, inheritedIdentity.accountId)
      }

      if (hasSecondVerifyRefreshToken(item) && hasReplaceableSecondVerifyAccessToken(item)) {
        found.push({
          value: item,
          sourceName,
          path,
          email: identity.email,
          accountId: identity.accountId
        })
      }

      Object.entries(item).forEach(([key, child]) => {
        visit(child, `${path}.${key}`, identity)
      })
      return
    }

    item.forEach((child, index) => visit(child, `${path}[${index}]`, inheritedIdentity))
  }

  visit(value, '$')
  return found
}

function getSecondVerifyIdentity(record) {
  if (!isJsonObject(record)) {
    return {}
  }

  return {
    email: firstString(
      record.user?.email,
      record.email,
      record.credentials?.email,
      record.providerSpecificData?.email
    ),
    accountId: firstString(
      record.account?.id,
      record.account_id,
      record.chatgpt_account_id,
      record.chatgptAccountId,
      record.providerSpecificData?.chatgptAccountId,
      record.providerSpecificData?.chatgpt_account_id,
      record.credentials?.chatgpt_account_id,
      record.credentials?.account_id,
      record.provider === 'codex' ? record.id : undefined
    )
  }
}

function hasSecondVerifyRefreshToken(value) {
  return Boolean(firstString(value?.refreshToken, value?.refresh_token))
}

function hasReplaceableSecondVerifyAccessToken(value) {
  return hasOwn(value, 'access_token') || hasOwn(value, 'accessToken')
}

function replaceSecondVerifyAccessToken(value, accessToken) {
  if (hasOwn(value, 'access_token')) {
    value.access_token = accessToken
    return true
  }

  if (hasOwn(value, 'accessToken')) {
    value.accessToken = accessToken
    return true
  }

  return false
}

function findSecondVerifyMatch(sources, target, fallbackIndex) {
  const targetAccountId = normalizeSecondVerifyIdentity(target.accountId)
  const targetEmail = normalizeSecondVerifyIdentity(target.email)

  if (targetAccountId) {
    const byAccountId = sources.find((item) => normalizeSecondVerifyIdentity(item.accountId) === targetAccountId)
    if (byAccountId) {
      return byAccountId
    }
  }

  if (targetEmail) {
    const byEmail = sources.find((item) => normalizeSecondVerifyIdentity(item.email) === targetEmail)
    if (byEmail) {
      return byEmail
    }
  }

  if (sources.length === 1) {
    return sources[0]
  }

  return sources[fallbackIndex]
}

function normalizeSecondVerifyIdentity(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isCpaRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false
  record = normalizeInputRecord(record)
  return Boolean(firstString(
    record.access_token,
    record.accessToken,
    getPath(record, ['tokens', 'access_token']),
    getPath(record, ['tokens', 'accessToken']),
    record.token,
    record.refresh_token,
    record.refreshToken,
    getPath(record, ['tokens', 'refresh_token']),
    getPath(record, ['tokens', 'refreshToken']),
    record.rt
  ))
}

function isAtSessionRecord(record) {
  return isChatGptSession(record)
}

function isRtLinkRecord(record) {
  return firstString(record?.session_source) === 'rt_link'
}

function getCpaRefreshToken(record) {
  record = normalizeInputRecord(record)
  return firstString(
    record?.refresh_token,
    record?.refreshToken,
    getPath(record, ['tokens', 'refresh_token']),
    getPath(record, ['tokens', 'refreshToken'])
  )
}

function normalizeInputRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record
  }
  if (isChatGptSession(record)) {
    return normalizeChatGptSession(record)
  }
  return record
}

function isChatGptSession(record) {
  return Boolean(firstString(record.accessToken, record.access_token)) &&
    Boolean(record.user && typeof record.user === 'object') &&
    !firstString(record.type)
}

function normalizeChatGptSession(record) {
  const user = objectOrEmpty(record.user)
  const account = objectOrEmpty(record.account)
  const accountId = firstString(account.id, account.account_id, user.id, user.account_id, record.account_id, record.chatgpt_account_id)
  const planType = firstString(account.planType, account.plan_type, record.planType, record.plan_type, record.chatgpt_plan_type)
  return {
    type: 'codex',
    account_id: accountId,
    chatgpt_account_id: accountId,
    email: firstString(user.email),
    name: firstString(user.name, user.email),
    plan_type: planType,
    chatgpt_plan_type: planType,
    user_image: firstString(user.image, user.picture),
    access_token: firstString(record.accessToken, record.access_token),
    refresh_token: firstString(record.refreshToken, record.refresh_token),
    id_token: firstString(record.idToken, record.id_token),
    expired: firstString(record.expires, record.expires_at),
    last_refresh: new Date().toISOString(),
    session_source: 'chatgpt_web_session'
  }
}

function normalizeCpaRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`第 ${index + 1} 条不是 JSON 对象`)
  }

  record = normalizeInputRecord(record)
  const accessToken = firstString(
    record.access_token,
    record.accessToken,
    getPath(record, ['tokens', 'access_token']),
    getPath(record, ['tokens', 'accessToken']),
    record.token
  )
  const idToken = firstString(
    record.id_token,
    record.idToken,
    getPath(record, ['tokens', 'id_token']),
    getPath(record, ['tokens', 'idToken'])
  )
  const refreshToken = firstString(
    record.refresh_token,
    record.refreshToken,
    getPath(record, ['tokens', 'refresh_token']),
    getPath(record, ['tokens', 'refreshToken']),
    record.rt
  )
  if (!accessToken && !refreshToken) {
    throw new Error(`第 ${index + 1} 条缺少 access_token/accessToken 或 refresh_token/rt`)
  }

  const accessClaims = decodeJwtPayload(accessToken)
  const idClaims = decodeJwtPayload(idToken)
  const auth = mergeAuthClaims(idClaims, accessClaims)
  const profile = objectOrEmpty(accessClaims['https://api.openai.com/profile'])

  return {
    type: firstString(record.type, 'codex'),
    account_id: firstString(record.account_id, record.chatgpt_account_id, auth.chatgpt_account_id, buildRtAccountId(refreshToken, index)),
    chatgpt_account_id: firstString(record.chatgpt_account_id, record.account_id, auth.chatgpt_account_id, buildRtAccountId(refreshToken, index)),
    email: firstString(record.email, validEmail(record.name), idClaims.email, accessClaims.email, profile.email),
    name: firstString(record.name, record.email, idClaims.email, accessClaims.email, profile.email),
    plan_type: firstString(record.plan_type, record.chatgpt_plan_type, auth.chatgpt_plan_type),
    chatgpt_plan_type: firstString(record.chatgpt_plan_type, record.plan_type, auth.chatgpt_plan_type),
    id_token: idToken,
    id_token_synthetic: Boolean(record.id_token_synthetic || record.idTokenSynthetic),
    access_token: accessToken,
    refresh_token: refreshToken,
    session_token: firstString(record.session_token, record.sessionToken),
    last_refresh: firstString(record.last_refresh, record.lastRefresh),
    expired: firstString(record.expired, record.expires_at, record.expiresAt, epochToRfc3339(accessClaims.exp)),
    account_note: firstString(record.account_note, record.accountInfo, record.account_info, record.note, record.notes, record.remark),
    session_source: firstString(record.session_source, record.sessionSource),
    user_image: firstString(record.user_image, record.userImage)
  }
}

function countSubMissingRefreshToken(accounts) {
  return accounts.filter((account) => {
    const credentials = objectOrEmpty(account?.credentials)
    return !firstString(credentials.refresh_token, credentials.refreshToken)
  }).length
}

function splitConvertibleRecords(input) {
  const records = parseFlexibleInput(input)
  if (!records.length) {
    throw new Error('没有可转换的记录')
  }
  const result = splitConvertibleRecordsFromValues(records)
  if (result.invalidIndex >= 0) {
    throw new Error(`第 ${result.invalidIndex + 1} 条不是可转换的 Sub2API 或 CPA/Codex 账号`)
  }
  return result
}

function splitConvertibleRecordsFromValues(records) {
  const subAccounts = []
  const cpaRecords = []
  let invalidIndex = -1

  records.forEach((record, index) => {
    if (invalidIndex >= 0) return
    if (isSubAccountRecord(record)) {
      subAccounts.push(record)
      return
    }
    if (isCpaRecord(record)) {
      cpaRecords.push(record)
      return
    }
    invalidIndex = index
  })

  return {
    records,
    subAccounts,
    cpaRecords,
    invalidIndex
  }
}

function cloneSubAccount(account) {
  return {
    ...account,
    credentials: { ...objectOrEmpty(account?.credentials) },
    extra: { ...objectOrEmpty(account?.extra) }
  }
}

function hasSubUsableCredentials(account) {
  const credentials = objectOrEmpty(account?.credentials)
  return Boolean(firstString(
    credentials.access_token,
    credentials.accessToken,
    credentials.refresh_token,
    credentials.refreshToken
  ))
}

function normalizeSubPayloadShape(parsed) {
  const payload = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed
  if (isSubAccountRecord(payload)) {
    return buildSubPayloadFromAccounts([payload])
  }
  if (isJsonObject(payload?.account) && isSubAccountRecord(payload.account)) {
    const normalized = buildSubPayloadFromAccounts([payload.account])
    if (firstString(payload.exported_at)) {
      normalized.exported_at = firstString(payload.exported_at)
    }
    if (Array.isArray(payload.proxies)) {
      normalized.proxies = payload.proxies
    }
    return normalized
  }
  if (Array.isArray(payload) && payload.every(isSubAccountRecord)) {
    return buildSubPayloadFromAccounts(payload)
  }
  return payload
}

function isSubAccountRecord(value) {
  return isJsonObject(value) &&
    isJsonObject(value.credentials) &&
    hasSubUsableCredentials(value)
}

function buildSubPayloadFromAccounts(accounts) {
  return {
    type: SUB2API_DATA_TYPE,
    version: 1,
    exported_at: toRfc3339(new Date()),
    proxies: [],
    accounts
  }
}

export function extractAdminAccountIds(input) {
  const ids = new Set()
  const collect = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collect)
      return
    }
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' || typeof value === 'number') {
        addAdminAccountId(ids, value)
      }
      return
    }

    addAdminAccountId(ids, value.id)
    addAdminAccountId(ids, value._id)
    addAdminAccountId(ids, value.account?.id)

    for (const key of ['accounts', 'items', 'records', 'list', 'data']) {
      if (Array.isArray(value[key])) {
        collect(value[key])
      } else if (value[key] && typeof value[key] === 'object' && value[key] !== value) {
        collect(value[key])
      }
    }
  }

  const text = String(input ?? '').trim()
  if (!text) return []
  collectAdminAccountIdsFromText(ids, text)

  try {
    collect(JSON.parse(text))
  } catch {
    try {
      parseFlexibleInput(text).forEach(collect)
    } catch {
      collectAdminAccountIdList(ids, text)
    }
  }

  return [...ids]
}

function collectAdminAccountIdsFromText(ids, text) {
  const accountPathPattern = /(?:^|[/?#&\s])accounts\/([A-Za-z0-9_-]{1,80})(?=$|[/?#&\s])/gi
  for (const match of text.matchAll(accountPathPattern)) {
    addAdminAccountId(ids, match[1])
  }

  const queryPattern = /(?:^|[?&#\s,;，；])(?:id|account_id|accountId|admin_account_id|adminAccountId)=([A-Za-z0-9_-]{1,80})(?=$|[&#\s,;，；])/g
  for (const match of text.matchAll(queryPattern)) {
    addAdminAccountId(ids, match[1])
  }

  collectAdminAccountIdList(ids, text)
}

function collectAdminAccountIdList(ids, text) {
  const parts = String(text ?? '').trim().split(/[\s,;，；]+/).filter(Boolean)
  if (!parts.length || !parts.every(isAdminAccountIdText)) return
  parts.forEach((part) => addAdminAccountId(ids, part))
}

function addAdminAccountId(ids, value) {
  const text = firstString(value)
  if (!text) return
  if (!isAdminAccountIdText(text)) return
  ids.add(text)
}

function isAdminAccountIdText(value) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(String(value ?? '').trim())
}

function buildAdminHealthRunnerScript(accountIds) {
  const idsJson = JSON.stringify(accountIds)
  return `(() => {
  const PRESET_ACCOUNT_IDS = ${idsJson};
  const API_BASE = '/api/v1';
  const PAGE_SIZE = 100;
  const DELAY_MS = 800;
  const MAX_PAGES = 200;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nowText = () => new Date().toISOString().replace(/[:.]/g, '-');
  const unwrap = (payload) => {
    if (payload && typeof payload === 'object' && payload.code === 0 && 'data' in payload) return payload.data;
    if (payload && typeof payload === 'object' && 'data' in payload && !Array.isArray(payload.data)) return payload.data;
    return payload;
  };
  const toArray = (payload) => {
    const value = unwrap(payload);
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return value.items || value.records || value.list || value.accounts || value.data || [];
  };
  const getTotal = (payload) => {
    const value = unwrap(payload);
    if (!value || typeof value !== 'object') return 0;
    return Number(value.total || value.count || value.total_count || 0) || 0;
  };
  const getAccountId = (account) => String(account?.id || account?.account_id || account?.accountId || '').trim();
  const getAccountName = (account) => String(account?.name || account?.email || account?.credentials?.email || account?.account_id || account?.id || '').trim();
  const apiFetch = async (path, options = {}) => {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const authToken = localStorage.getItem('auth_token');
    if (authToken) headers.Authorization = \`Bearer \${authToken}\`;
    const response = await fetch(\`\${API_BASE}\${path}\`, {
      credentials: 'include',
      ...options,
      headers
    });
    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || response.statusText || '请求失败';
      throw new Error(\`\${response.status} \${message}\`);
    }
    return payload;
  };
  const loadAccounts = async () => {
    if (PRESET_ACCOUNT_IDS.length) {
      return PRESET_ACCOUNT_IDS.map((id) => ({ id, name: id }));
    }
    const accounts = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await apiFetch(\`/admin/accounts?page=\${page}&page_size=\${PAGE_SIZE}\`, { method: 'GET' });
      const rows = toArray(payload);
      accounts.push(...rows);
      const total = getTotal(payload);
      if (!rows.length || (total && accounts.length >= total) || rows.length < PAGE_SIZE) break;
    }
    return accounts;
  };
  const normalizeTestResult = (payload) => {
    const data = unwrap(payload);
    const explicit = data && typeof data === 'object'
      ? (data.success ?? data.ok ?? data.passed ?? data.healthy ?? data.available)
      : undefined;
    const success = explicit === undefined ? true : Boolean(explicit);
    return {
      success,
      message: data?.message || data?.error || data?.reason || data?.status || '',
      data
    };
  };
  const downloadJson = (report) => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = \`account-health-result-\${nowText()}.json\`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  (async () => {
    console.log('[账号测活] 开始读取账号...');
    const accounts = await loadAccounts();
    const results = [];
    console.log(\`[账号测活] 待测试 \${accounts.length} 个账号\`);

    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      const id = getAccountId(account);
      const name = getAccountName(account);
      if (!id) {
        results.push({ index: index + 1, id: '', name, usable: false, status: 'skipped', message: '缺少后台账号 id' });
        continue;
      }
      try {
        console.log(\`[账号测活] \${index + 1}/\${accounts.length} 测试 \${name || id}\`);
        const payload = await apiFetch(\`/admin/accounts/\${encodeURIComponent(id)}/test\`, { method: 'POST' });
        const test = normalizeTestResult(payload);
        results.push({
          index: index + 1,
          id,
          name,
          usable: test.success,
          status: test.success ? 'usable' : 'unusable',
          message: test.message,
          response: test.data
        });
      } catch (error) {
        results.push({
          index: index + 1,
          id,
          name,
          usable: false,
          status: 'error',
          message: error.message || '测试失败'
        });
      }
      if (index < accounts.length - 1) await sleep(DELAY_MS);
    }

    const report = {
      type: 'sub2api-admin-account-health-result',
      generated_at: new Date().toISOString(),
      endpoint: '/api/v1/admin/accounts/{id}/test',
      total: results.length,
      usable: results.filter((item) => item.usable).length,
      unusable: results.filter((item) => !item.usable).length,
      results
    };
    window.Sub2ApiAccountHealthLastReport = report;
    console.table(results.map(({ index, id, name, usable, status, message }) => ({ index, id, name, usable, status, message })));
    downloadJson(report);
    alert(\`账号测活完成：可用 \${report.usable} 个，不可用 \${report.unusable} 个。结果 JSON 已下载。\`);
  })().catch((error) => {
    console.error('[账号测活] 失败', error);
    alert(\`账号测活失败：\${error.message || error}\`);
  });
})();`
}

function applyUniqueSubAccountIdentities(accounts, warnings) {
  const groups = groupDuplicateIndexes(accounts, (account) => {
    const credentials = objectOrEmpty(account?.credentials)
    return firstString(credentials.chatgpt_account_id, credentials.account_id)
  })
  groups.forEach(([baseId, indexes]) => {
    indexes.forEach((accountIndex) => {
      const account = accounts[accountIndex]
      const credentials = objectOrEmpty(account.credentials)
      const extra = objectOrEmpty(account.extra)
      const uniqueId = buildStableUniqueIdentity(baseId, buildSubIdentitySeed(account, accountIndex), accountIndex)
      if (credentials.chatgpt_account_id === uniqueId) return

      credentials.original_chatgpt_account_id = firstString(credentials.original_chatgpt_account_id, credentials.chatgpt_account_id)
      credentials.chatgpt_account_id = uniqueId
      if (firstString(credentials.account_id)) {
        credentials.original_account_id = firstString(credentials.original_account_id, credentials.account_id)
      }
      credentials.account_id = uniqueId
      extra.team_sub_account_identity_normalized = true
      account.credentials = credentials
      account.extra = extra
    })
    warnings.push(`检测到 ${indexes.length} 个账号共用 chatgpt_account_id=${baseId}，已为导出身份自动加唯一后缀`)
  })
}

function applyUniqueCpaRecordIdentities(records, warnings) {
  const groups = groupDuplicateIndexes(records, (record) => firstString(record.chatgpt_account_id, record.account_id))
  groups.forEach(([baseId, indexes]) => {
    indexes.forEach((recordIndex) => {
      const record = records[recordIndex]
      const uniqueId = buildStableUniqueIdentity(baseId, buildCpaIdentitySeed(record, recordIndex), recordIndex)
      if (record.chatgpt_account_id === uniqueId && record.account_id === uniqueId) return

      record.original_chatgpt_account_id = firstString(record.original_chatgpt_account_id, record.chatgpt_account_id)
      record.original_account_id = firstString(record.original_account_id, record.account_id)
      record.chatgpt_account_id = uniqueId
      record.account_id = uniqueId
      record.team_sub_account_identity_normalized = true
    })
    warnings.push(`检测到 ${indexes.length} 条记录共用 chatgpt_account_id/account_id=${baseId}，已为 CPA 导出身份自动加唯一后缀`)
  })
}

function groupDuplicateIndexes(items, getKey) {
  const groups = new Map()
  items.forEach((item, index) => {
    const key = firstString(getKey(item))
    if (!key) return
    const current = groups.get(key) || []
    current.push(index)
    groups.set(key, current)
  })
  return [...groups.entries()].filter(([, indexes]) => indexes.length > 1)
}

function buildSubIdentitySeed(account, index) {
  const credentials = objectOrEmpty(account?.credentials)
  const extra = objectOrEmpty(account?.extra)
  return firstString(
    credentials.email,
    account?.name,
    credentials.refresh_token,
    credentials.access_token,
    extra.access_token_sha256,
    `account-${index + 1}`
  )
}

function buildCpaIdentitySeed(record, index) {
  return firstString(
    record?.email,
    record?.name,
    record?.refresh_token,
    record?.access_token,
    `account-${index + 1}`
  )
}

function buildStableUniqueIdentity(baseId, seed, index) {
  const suffix = stableFingerprint(`${seed || baseId}:${index + 1}`).slice(0, 10)
  return `${baseId}__${suffix}`
}

function buildRtAccountId(refreshToken, index) {
  const seed = firstString(refreshToken, `rt-link-${index + 1}`)
  return `rt_${stableFingerprint(seed).slice(0, 12)}`
}

function parseNdjson(text) {
  const values = []
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      values.push(...flattenInputValue(JSON.parse(trimmed)))
    } catch (error) {
      throw new Error(`第 ${index + 1} 行 JSON 解析失败：${error.message}`)
    }
  })
  return values
}

function parseRtLinks(text) {
  const urls = extractUrlCandidates(text)
  const records = []

  urls.forEach((candidate, index) => {
    const params = readUrlParams(candidate)
    const refreshToken = firstParam(params, ['refresh_token', 'refreshToken', 'refresh-token', 'rt', 'refresh'])
    const accessToken = firstParam(params, ['access_token', 'accessToken', 'at', 'token'])
    if (!refreshToken && !accessToken) return

    records.push(pruneEmpty({
      type: 'codex',
      account_id: firstParam(params, ['account_id', 'accountId', 'chatgpt_account_id', 'chatgptAccountId']) || buildRtAccountId(refreshToken, index),
      chatgpt_account_id: firstParam(params, ['chatgpt_account_id', 'chatgptAccountId', 'account_id', 'accountId']) || buildRtAccountId(refreshToken, index),
      email: firstParam(params, ['email', 'mail']),
      name: firstParam(params, ['name', 'email', 'mail']),
      plan_type: firstParam(params, ['plan_type', 'planType', 'chatgpt_plan_type', 'chatgptPlanType']),
      chatgpt_plan_type: firstParam(params, ['chatgpt_plan_type', 'chatgptPlanType', 'plan_type', 'planType']),
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: firstParam(params, ['id_token', 'idToken']),
      expired: firstParam(params, ['expired', 'expires', 'expires_at', 'expiresAt']),
      client_id: firstParam(params, ['client_id', 'clientId']),
      session_source: 'rt_link'
    }, false))
  })

  if (!records.length) {
    throw new Error('未找到带 refresh_token/rt 的链接')
  }
  return records
}

function extractUrlCandidates(text) {
  const normalized = String(text ?? '')
    .replace(/&amp;/g, '&')
    .trim()
  const matches = extractAnyUrlCandidates(normalized)
  const candidates = matches.length ? matches : normalized.split(/\s+/)
  return candidates
    .map((candidate) => candidate.trim().replace(/^[("'[<]+|[)"'\]>]+$/g, ''))
    .filter((candidate) => /(?:refresh_token|refreshToken|rt|access_token|accessToken|at)=/i.test(candidate))
}

function extractAnyUrlCandidates(text) {
  return String(text ?? '').match(/https?:\/\/[^\s"'<>]+/g) || []
}

function readAuthCallbackError(text) {
  const normalized = String(text ?? '')
    .replace(/&amp;/g, '&')
    .trim()
  const candidates = extractAnyUrlCandidates(normalized)
  if (!candidates.length && /(?:^|[?&#])error=/i.test(normalized)) {
    candidates.push(normalized)
  }

  for (const candidate of candidates) {
    const params = readUrlParams(candidate)
    const error = firstParam(params, ['error'])
    if (!error) continue

    const description = firstParam(params, ['error_description', 'errorDescription'])
    const reason = firstString(description, error)
    const action = /code_challenge_method|plain/i.test(reason)
      ? '授权链接已改为 S256，请重新点击“登录 Codex”生成新链接'
      : '请重新点击“登录 Codex”生成新链接'
    return `Codex 授权失败：${reason}。${action}`
  }

  return ''
}

function readUrlParams(candidate) {
  const params = new Map()
  collectUrlParams(candidate, params, 0)
  return params
}

function collectUrlParams(candidate, params, depth) {
  if (!candidate || depth > 2) return
  const decoded = safeDecode(candidate)
  const variants = [candidate, decoded].filter(Boolean)
  variants.forEach((value) => {
    try {
      const url = new URL(value, 'https://local.invalid')
      collectSearchParams(url.searchParams, params, depth)
      collectHashParams(url.hash, params, depth)
    } catch {
      collectSearchParams(new URLSearchParams(value.replace(/^[?#]/, '')), params, depth)
    }
    if (!/^https?:\/\//i.test(value) && value.includes('=')) {
      collectSearchParams(new URLSearchParams(value.replace(/^[?#]/, '')), params, depth)
    }
  })
}

function collectSearchParams(searchParams, params, depth) {
  searchParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value)
    if (/(?:refresh_token|refreshToken|rt|access_token|accessToken|at)=/i.test(value)) {
      collectUrlParams(value, params, depth + 1)
    }
  })
}

function collectHashParams(hash, params, depth) {
  const text = firstString(hash).replace(/^#/, '')
  if (!text) return
  const queryText = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text
  collectSearchParams(new URLSearchParams(queryText), params, depth)
}

function firstParam(params, names) {
  for (const name of names) {
    const value = firstString(params.get(name))
    if (value) return value
  }
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()))
  for (const [key, value] of params.entries()) {
    if (normalizedNames.has(key.toLowerCase())) {
      const text = firstString(value)
      if (text) return text
    }
  }
  return ''
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseEmbeddedJsonObjects(text) {
  const source = normalizeEmbeddedJsonText(text)
  const values = []

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '{' || !looksLikeJsonObjectStart(source, index)) {
      continue
    }

    const snippet = readBalancedJsonObject(source, index)
    if (!snippet) {
      continue
    }

    try {
      values.push(...flattenInputValue(JSON.parse(snippet.text)))
      index = snippet.end
    } catch {
      // RTF 里也可能有非 JSON 的花括号控制块，跳过继续找下一段。
    }
  }

  if (!values.length) {
    throw new Error('未找到可解析的 JSON 对象')
  }
  return values
}

function normalizeEmbeddedJsonText(text) {
  return String(text ?? '')
    .replace(/\\([{}])/g, '$1')
}

function looksLikeJsonObjectStart(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (/\s/.test(char)) continue
    return char === '"'
  }
  return false
}

function readBalancedJsonObject(source, start) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return {
          text: source.slice(start, index + 1),
          end: index
        }
      }
    }
  }

  return null
}

function flattenInputValue(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenInputValue(item))
  }
  if (value && typeof value === 'object' && Array.isArray(value.accounts) && value.type) {
    return value.accounts
  }
  return [value]
}

function decodeJwtPayload(token) {
  const text = firstString(token)
  if (!text) return {}
  const parts = text.split('.')
  if (parts.length < 2) return {}
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(decodeBase64Utf8(padded))
  } catch {
    return {}
  }
}

function decodeBase64Utf8(base64Text) {
  if (typeof atob === 'function') {
    const binary = atob(base64Text)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  return Buffer.from(base64Text, 'base64').toString('utf8')
}

function mergeAuthClaims(...claimsList) {
  const merged = {}
  claimsList.forEach((claims) => {
    const auth = objectOrEmpty(claims['https://api.openai.com/auth'])
    Object.entries(auth).forEach(([key, value]) => {
      if (merged[key] === undefined && value !== undefined && value !== null && value !== '') {
        merged[key] = value
      }
    })
  })
  return merged
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
}

function getPath(source, path) {
  return path.reduce((current, key) => objectOrEmpty(current)[key], source)
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function validEmail(value) {
  const text = firstString(value)
  return text.includes('@') ? text : ''
}

function setIfPresent(target, key, value) {
  const text = firstString(value)
  if (text) target[key] = text
}

function pickDefaultOrganization(organizations) {
  if (!Array.isArray(organizations)) return ''
  const selected = organizations.find((item) => item && item.is_default) || organizations[0]
  return firstString(selected?.id)
}

function toEpochSeconds(value) {
  if (value === undefined || value === null || value === '') return null
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null
  return numberValue > 10_000_000_000 ? Math.floor(numberValue / 1000) : Math.floor(numberValue)
}

function parseDateToEpoch(value) {
  const text = firstString(value)
  if (!text) return null
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) return null
  return Math.floor(timestamp / 1000)
}

function toRfc3339(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function epochToRfc3339(value) {
  const epoch = toEpochSeconds(value)
  return epoch ? toRfc3339(new Date(epoch * 1000)) : ''
}

function normalizeNonNegativeInt(value, fallback) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) return fallback
  return Math.floor(numberValue)
}

function normalizeLimitCount(value) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0
  return Math.floor(numberValue)
}

function normalizeRangeStart(value) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0
  return Math.floor(numberValue)
}

function buildCpaFileName(record, index) {
  const identity = firstString(record?.email, record?.name, record?.chatgpt_account_id, record?.account_id, `account-${index + 1}`)
  const safeIdentity = identity
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 96)
  return `${String(index + 1).padStart(3, '0')}-${safeIdentity || `account-${index + 1}`}.json`
}

function buildStoreZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  const now = new Date()
  const { dosDate, dosTime } = toDosDateTime(now)

  files.forEach((file) => {
    const nameBytes = utf8Bytes(file.name)
    const crc = crc32(file.bytes)
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, dosTime, true)
    localView.setUint16(12, dosDate, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, file.bytes.length, true)
    localView.setUint32(22, file.bytes.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    localHeader.set(nameBytes, 30)

    localParts.push(localHeader, file.bytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, dosTime, true)
    centralView.setUint16(14, dosDate, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, file.bytes.length, true)
    centralView.setUint32(24, file.bytes.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    centralHeader.set(nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + file.bytes.length
  })

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralOffset, true)
  endView.setUint16(20, 0, true)

  return concatUint8Arrays([...localParts, ...centralParts, end])
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  parts.forEach((part) => {
    out.set(part, offset)
    offset += part.length
  })
  return out
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

const crc32Table = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function stableFingerprint(value) {
  const text = firstString(value)
  return sha256Hex(text)
}

function sha256Hex(message) {
  const bytes = utf8Bytes(message)
  const bitLength = bytes.length * 8
  const withOne = bytes.length + 1
  const paddedLength = Math.ceil((withOne + 8) / 64) * 64
  const data = new Uint8Array(paddedLength)
  data.set(bytes)
  data[bytes.length] = 0x80

  const view = new DataView(data.buffer)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  view.setUint32(paddedLength - 8, high)
  view.setUint32(paddedLength - 4, low)

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]
  const w = new Uint32Array(64)

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4)
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotateRight(w[i - 15], 7) ^ rotateRight(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotateRight(w[i - 2], 17) ^ rotateRight(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + k[i] + w[i]) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  return h.map((part) => part.toString(16).padStart(8, '0')).join('')
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits))
}

function utf8Bytes(value) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value)
  }
  return Buffer.from(value, 'utf8')
}

function summarizeAccounts(accounts, warnings, format) {
  return {
    count: accounts.length,
    missingRefreshToken: accounts.filter((account) => !objectOrEmpty(account.credentials).refresh_token).length,
    format,
    warnings
  }
}

function summarizeCpaRecords(records, warnings) {
  return {
    count: records.length,
    missingRefreshToken: records.filter((record) => !record.refresh_token).length,
    format: 'CPA JSONL',
    warnings
  }
}

function summarizeSecondVerifyRepair(repairResult) {
  return {
    count: repairResult.stats.replaced,
    missingRefreshToken: repairResult.stats.targets - repairResult.stats.replaced,
    format: '二验 JSON 修正',
    warnings: repairResult.skipped.map((item) => `${item.sourceName}${item.path}：${item.reason}`)
  }
}

function pruneEmpty(source, keepEmptyFields) {
  if (keepEmptyFields) return source
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== '' && value !== null && value !== undefined))
}

// 账号对话测试页使用的宽容导入层。它不会替代上面的严格转换函数：
// 单条坏记录只进入 errors，批次中的其它账号仍可继续使用。
export function importAccountDocuments(inputs) {
  const documents = normalizeAccountImportDocuments(inputs)
  const accounts = []
  const errors = []
  const warnings = []

  documents.forEach((document, documentIndex) => {
    const sourceName = firstString(document.sourceName, `输入 ${documentIndex + 1}`)
    const parsed = parseAccountImportDocument(document.value, sourceName, errors)
    parsed.forEach((entry) => {
      collectAccountImportCandidates(entry.value, {
        sourceName,
        recordIndex: entry.recordIndex,
        line: entry.line,
        sourceHint: '',
        sourceMetadata: {}
      }).forEach((candidate) => {
        try {
          const account = normalizeImportedAccount(candidate, accounts.length)
          accounts.push(account)
          if (!account.accountId) {
            warnings.push(`${sourceName} 第 ${candidate.recordIndex + 1} 条未提供 account_id，已保留为空（未伪造）`)
          }
          if (!account.platformSupported) {
            warnings.push(`${sourceName} 第 ${candidate.recordIndex + 1} 条平台 ${account.platform || 'unknown'} 不受 OpenAI 对话测试支持，已禁止自动测试`)
          } else if (!account.testable) {
            warnings.push(`${sourceName} 第 ${candidate.recordIndex + 1} 条缺少可测试凭据：${account.credentialStatus}`)
          }
        } catch (error) {
          errors.push(buildAccountImportError(sourceName, candidate.recordIndex, candidate.line, error.message))
        }
      })
    })
  })

  return { accounts, errors, warnings }
}

// target: cpa（单账号为对象，多账号为数组）、cpa-array、cpa-ndjson、sub2api。
export function exportAccountDocuments(accounts, target = 'cpa') {
  const source = Array.isArray(accounts) ? accounts : []
  const warnings = []
  const normalizedTarget = normalizeAccountExportTarget(target)

  if (normalizedTarget === 'sub2api') {
    const proxyMerge = mergeImportedSubProxies(source, warnings)
    const exportedAccounts = source.map((account, index) => exportNormalizedAccountToSub(account, index, warnings, proxyMerge.accountProxyMaps.get(account.key)))
    const firstMetadata = objectOrEmpty(source[0]?.sourceMetadata)
    const payload = {
      ...cloneImportJsonObject(firstMetadata),
      type: SUB2API_DATA_TYPE,
      version: Number(firstMetadata.version) || 1,
      exported_at: toRfc3339(new Date()),
      proxies: proxyMerge.proxies,
      accounts: exportedAccounts
    }
    return {
      target: normalizedTarget,
      accounts: exportedAccounts,
      payload,
      document: payload,
      output: JSON.stringify(payload, null, 2),
      warnings
    }
  }

  const records = source.map((account, index) => exportNormalizedAccountToCpa(account, index, warnings))
  const document = normalizedTarget === 'cpa-array'
    ? records
    : normalizedTarget === 'cpa-ndjson'
      ? records
      : records.length === 1 ? records[0] : records
  const output = normalizedTarget === 'cpa-ndjson'
    ? records.map((record) => JSON.stringify(record)).join('\n')
    : JSON.stringify(document, null, 2)

  return { target: normalizedTarget, records, document, output, warnings }
}

function normalizeAccountImportDocuments(inputs) {
  if (Array.isArray(inputs) && inputs.length > 0 && inputs.every((item) => typeof item === 'string' || isAccountImportDescriptor(item))) {
    return inputs.map((item, index) => typeof item === 'string'
      ? { sourceName: `输入 ${index + 1}`, value: item }
      : {
          sourceName: firstString(item.sourceName, item.fileName, item.filename, item.name, `输入 ${index + 1}`),
          value: hasOwn(item, 'value') ? item.value : hasOwn(item, 'text') ? item.text : hasOwn(item, 'content') ? item.content : item.data
        })
  }
  if (isAccountImportDescriptor(inputs)) {
    return [{
      sourceName: firstString(inputs.sourceName, inputs.fileName, inputs.filename, inputs.name, '输入 1'),
      value: hasOwn(inputs, 'value') ? inputs.value : hasOwn(inputs, 'text') ? inputs.text : hasOwn(inputs, 'content') ? inputs.content : inputs.data
    }]
  }
  return [{ sourceName: '输入 1', value: inputs }]
}

function isAccountImportDescriptor(value) {
  return isJsonObject(value) &&
    Boolean(firstString(value.sourceName, value.fileName, value.filename)) &&
    (hasOwn(value, 'value') || hasOwn(value, 'text') || hasOwn(value, 'content') || hasOwn(value, 'data'))
}

function parseAccountImportDocument(value, sourceName, errors) {
  if (typeof value !== 'string') {
    return [{ value, recordIndex: 0 }]
  }
  const text = value.trim()
  if (!text) {
    errors.push(buildAccountImportError(sourceName, 0, null, 'empty_input'))
    return []
  }
  try {
    return [{ value: JSON.parse(text), recordIndex: 0 }]
  } catch (jsonError) {
    const entries = []
    const lines = text.split(/\r?\n/)
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        entries.push({ value: JSON.parse(trimmed), recordIndex: entries.length, line: lineIndex + 1 })
      } catch (error) {
        errors.push(buildAccountImportError(sourceName, lineIndex, lineIndex + 1, 'invalid_json'))
      }
    })
    if (!entries.length && !lines.some((line) => line.trim())) {
      errors.push(buildAccountImportError(sourceName, 0, null, 'invalid_json'))
    }
    return entries
  }
}

function collectAccountImportCandidates(value, context) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectAccountImportCandidates(item, { ...context, recordIndex: index }))
  }
  if (!isJsonObject(value)) {
    return [{ ...context, value }]
  }

  const wrappedData = value.data
  if (isJsonObject(wrappedData) || Array.isArray(wrappedData)) {
    const metadata = copyAccountEnvelopeMetadata(value, ['data'])
    return collectAccountImportCandidates(wrappedData, {
      ...context,
      sourceMetadata: { ...context.sourceMetadata, ...metadata }
    })
  }

  if (Array.isArray(value.items)) {
    const metadata = copyAccountEnvelopeMetadata(value, ['items'])
    const sourceHint = value.items.length > 0 && value.items.every((item) => isJsonObject(item) && isJsonObject(item.credentials))
      ? 'sub2api'
      : context.sourceHint
    return value.items.flatMap((item, index) => collectAccountImportCandidates(item, {
      ...context,
      recordIndex: index,
      sourceHint,
      sourceMetadata: { ...context.sourceMetadata, ...metadata }
    }))
  }

  if (Array.isArray(value.accounts)) {
    const metadata = copyAccountEnvelopeMetadata(value, ['accounts'])
    return value.accounts.map((account, index) => ({
      ...context,
      value: account,
      recordIndex: index,
      sourceHint: 'sub2api',
      sourceMetadata: { ...context.sourceMetadata, ...metadata }
    }))
  }

  if (isJsonObject(value.account) && looksLikeImportAccount(value.account)) {
    const metadata = copyAccountEnvelopeMetadata(value, ['account'])
    return [{
      ...context,
      value: value.account,
      sourceHint: isJsonObject(value.account.credentials) ? 'sub2api' : context.sourceHint,
      sourceMetadata: { ...context.sourceMetadata, ...metadata }
    }]
  }

  return [{
    ...context,
    value,
    sourceHint: context.sourceHint || (isJsonObject(value.credentials) ? 'sub2api' : isChatGptSession(value) ? 'codex-session' : 'cpa')
  }]
}

function copyAccountEnvelopeMetadata(value, excludedKeys) {
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !excludedKeys.includes(key))
    .map(([key, item]) => [key, cloneImportJsonValue(item)]))
}

function looksLikeImportAccount(value) {
  if (!isJsonObject(value)) return false
  const credentials = objectOrEmpty(value.credentials)
  return Boolean(firstString(
    value.access_token, value.accessToken, value.refresh_token, value.refreshToken,
    value.api_key, value.apiKey, credentials.access_token, credentials.accessToken,
    credentials.refresh_token, credentials.refreshToken, credentials.api_key, credentials.apiKey
  ))
}

function normalizeImportedAccount(candidate, outputIndex) {
  const record = candidate.value
  if (!isJsonObject(record)) {
    throw new Error('账号记录必须是 JSON 对象')
  }
  const sourceCredentials = objectOrEmpty(record.credentials)
  const tokens = objectOrEmpty(record.tokens)
  const tokenObject = objectOrEmpty(record.token)
  const nestedAccount = objectOrEmpty(record.account)
  const user = objectOrEmpty(record.user)
  const accessToken = firstImportedCredential(record.access_token, record.accessToken, tokens.access_token, tokens.accessToken, tokenObject.access_token, tokenObject.accessToken, sourceCredentials.access_token, sourceCredentials.accessToken, record.token)
  const refreshToken = firstImportedCredential(record.refresh_token, record.refreshToken, record.rt, tokens.refresh_token, tokens.refreshToken, tokenObject.refresh_token, tokenObject.refreshToken, sourceCredentials.refresh_token, sourceCredentials.refreshToken)
  const idToken = firstImportedCredential(record.id_token, record.idToken, tokens.id_token, tokens.idToken, tokenObject.id_token, tokenObject.idToken, sourceCredentials.id_token, sourceCredentials.idToken)
  const apiKey = firstImportedCredential(record.api_key, record.apiKey, record.OPENAI_API_KEY, sourceCredentials.api_key, sourceCredentials.apiKey, sourceCredentials.key)
  const sessionToken = firstImportedCredential(record.session_token, record.sessionToken, sourceCredentials.session_token, sourceCredentials.sessionToken)
  const lastRefresh = firstString(record.last_refresh, record.lastRefresh, sourceCredentials.last_refresh, sourceCredentials.lastRefresh)
  if (!accessToken && !refreshToken && !idToken && !apiKey && !sessionToken) {
    throw new Error('缺少 access_token、refresh_token、id_token 或 api_key')
  }

  const accessClaims = decodeJwtPayload(accessToken)
  const idClaims = decodeJwtPayload(idToken)
  const auth = mergeAuthClaims(idClaims, accessClaims)
  const profile = objectOrEmpty(accessClaims['https://api.openai.com/profile'])
  const clientId = firstString(record.client_id, record.clientId, sourceCredentials.client_id, sourceCredentials.clientId, accessClaims.client_id)
  const accountId = firstString(
    record.original_chatgpt_account_id, record.original_account_id,
    sourceCredentials.original_chatgpt_account_id, sourceCredentials.original_account_id,
    record.account_id, record.chatgpt_account_id,
    sourceCredentials.chatgpt_account_id, sourceCredentials.account_id,
    tokens.account_id, tokens.chatgpt_account_id, tokenObject.account_id, tokenObject.chatgpt_account_id,
    nestedAccount.id, nestedAccount.account_id,
    auth.chatgpt_account_id
  )
  const workspaceId = firstString(
    record.workspace_id, record.organization_id, record.org_id,
    sourceCredentials.workspace_id, sourceCredentials.organization_id,
    nestedAccount.workspace_id, auth.poid, pickDefaultOrganization(auth.organizations)
  )
  const email = firstString(record.email, sourceCredentials.email, user.email, validEmail(record.name), idClaims.email, accessClaims.email, profile.email)
  const planType = firstString(record.plan_type, record.chatgpt_plan_type, record.planType, sourceCredentials.plan_type, nestedAccount.planType, nestedAccount.plan_type, auth.chatgpt_plan_type)
  const expiresAt = firstString(record.expired, record.expires_at, record.expiresAt, sourceCredentials.expires_at, epochToRfc3339(accessClaims.exp))
  const sourceAccountType = firstString(record.type, record.auth_type, record.authType)
  const authType = firstString(record.auth_type, record.authType, ['oauth', 'api_key', 'apikey'].includes(record.type) ? record.type : '', apiKey ? 'api_key' : 'oauth')
  const inferredPlatform = !sourceAccountType || ['codex', 'openai', 'chatgpt', 'oauth', 'api_key', 'apikey'].includes(sourceAccountType.toLowerCase()) || isChatGptSession(record) ? 'openai' : sourceAccountType
  const platform = firstString(record.platform, record.provider, sourceCredentials.platform, inferredPlatform).toLowerCase()
  const platformSupported = platform === 'openai'
  const availability = platformSupported
    ? classifyImportedAccountCredentials({ accessToken, refreshToken, apiKey, sessionToken, expiresAt, accessClaims })
    : { testable: false, credentialStatus: 'unsupported_platform' }
  const credentials = {
    ...cloneImportJsonObject(sourceCredentials)
  }
  setImportCredential(credentials, 'access_token', accessToken)
  setImportCredential(credentials, 'refresh_token', refreshToken)
  setImportCredential(credentials, 'id_token', idToken)
  setImportCredential(credentials, 'api_key', apiKey)
  setImportCredential(credentials, 'session_token', sessionToken)
  setImportCredential(credentials, 'client_id', clientId)
  setImportCredential(credentials, 'last_refresh', lastRefresh)
  setImportCredential(credentials, 'email', email)
  setImportCredential(credentials, 'chatgpt_account_id', accountId)
  setImportCredential(credentials, 'organization_id', workspaceId)
  setImportCredential(credentials, 'plan_type', planType)
  setImportCredential(credentials, 'expires_at', expiresAt)

  const source = candidate.sourceHint || 'cpa'
  const identitySeed = JSON.stringify([
    candidate.sourceName,
    candidate.recordIndex,
    source,
    accountId,
    workspaceId,
    email,
    stableFingerprint(firstString(refreshToken, accessToken, apiKey, sessionToken, `record-${outputIndex + 1}`))
  ])

  return {
    key: `account_${stableFingerprint(identitySeed).slice(0, 20)}`,
    name: firstString(record.name, user.name, email, accountId, `${candidate.sourceName} #${candidate.recordIndex + 1}`),
    email,
    accountId,
    workspaceId,
    planType,
    authType,
    accountType: candidate.sourceHint === 'sub2api' ? sourceAccountType : '',
    platform,
    platformSupported,
    credentials,
    testable: availability.testable,
    credentialStatus: availability.credentialStatus,
    usable: null,
    status: 'untested',
    source,
    sourceName: candidate.sourceName,
    sourceMetadata: cloneImportJsonObject(candidate.sourceMetadata),
    original: cloneImportJsonValue(record)
  }
}

function classifyImportedAccountCredentials({ accessToken, refreshToken, apiKey, sessionToken, expiresAt, accessClaims }) {
  if (apiKey) return { testable: true, credentialStatus: 'api_key' }
  if (refreshToken) return { testable: true, credentialStatus: 'refresh_token' }
  if (accessToken) {
    const exp = toEpochSeconds(accessClaims.exp) ?? parseDateToEpoch(expiresAt)
    if (exp && exp <= Math.floor(Date.now() / 1000)) {
      return { testable: false, credentialStatus: 'expired_access_token' }
    }
    return { testable: true, credentialStatus: 'access_token' }
  }
  if (sessionToken) return { testable: false, credentialStatus: 'session_token_only' }
  return { testable: false, credentialStatus: 'missing_credentials' }
}

function setImportCredential(credentials, key, value) {
  const text = firstString(value)
  if (text) credentials[key] = text
}

function buildAccountImportError(sourceName, recordIndex, line, codeOrMessage) {
  const knownCodes = {
    invalid_json: 'JSON 解析失败',
    empty_input: '内容为空',
    invalid_account: '账号记录无效'
  }
  const code = knownCodes[codeOrMessage] ? codeOrMessage : 'invalid_account'
  const error = {
    sourceName,
    index: Number.isInteger(recordIndex) ? recordIndex : 0,
    code,
    message: knownCodes[code]
  }
  if (line) error.line = line
  return error
}

function normalizeAccountExportTarget(target) {
  const value = firstString(target, 'cpa').toLowerCase()
  if (['sub', 'sub2api', 'sub2api-data'].includes(value)) return 'sub2api'
  if (['cpa-array', 'array'].includes(value)) return 'cpa-array'
  if (['cpa-ndjson', 'ndjson', 'jsonl'].includes(value)) return 'cpa-ndjson'
  if (['cpa', 'cpa-json', 'json'].includes(value)) return 'cpa'
  throw new Error(`不支持的账号导出目标：${target}`)
}

function exportNormalizedAccountToCpa(account, index, warnings) {
  if (account?.platformSupported === false) throw new Error(`第 ${index + 1} 个账号不是 OpenAI/Codex，不能导出为 Codex CPA 鉴权文件；可选择 SUB 格式保留原始数据`)
  if (!isJsonObject(account)) throw new Error(`第 ${index + 1} 个账号不是对象`)
  const credentials = objectOrEmpty(account.credentials)
  const canReuseOriginal = account.source !== 'sub2api' && isJsonObject(account.original) && !isChatGptSession(account.original)
  const record = canReuseOriginal ? cloneImportJsonObject(account.original) : {}
  const accessToken = firstString(credentials.access_token, credentials.accessToken)
  const refreshToken = firstString(credentials.refresh_token, credentials.refreshToken)
  const idToken = firstString(credentials.id_token, credentials.idToken)
  const apiKey = firstString(credentials.api_key, credentials.apiKey)
  const accountId = firstString(account.accountId, credentials.chatgpt_account_id, credentials.account_id)
  if (['api_key', 'apikey', 'api-key'].includes(account.authType) || (apiKey && !accessToken && !refreshToken)) {
    throw new Error(`第 ${index + 1} 个账号是 API Key 凭据，不能伪装为 CPA Codex auth-file；请导出 Sub2API 备份或使用 CPA 的 codex-api-key 配置`)
  }

  record.type = 'codex'
  setExportField(record, 'name', account.name)
  setExportField(record, 'email', account.email, credentials.email)
  setExportField(record, 'account_id', accountId)
  setExportField(record, 'chatgpt_account_id', accountId)
  setExportField(record, 'plan_type', account.planType, credentials.plan_type)
  setExportField(record, 'chatgpt_plan_type', account.planType, credentials.plan_type)
  setExportField(record, 'access_token', accessToken)
  setExportField(record, 'refresh_token', refreshToken)
  setExportField(record, 'id_token', idToken)
  setExportField(record, 'api_key', apiKey)
  setExportField(record, 'session_token', credentials.session_token, credentials.sessionToken)
  setExportField(record, 'client_id', credentials.client_id, credentials.clientId)
  setExportField(record, 'last_refresh', credentials.last_refresh, credentials.lastRefresh)
  setExportField(record, 'expired', credentials.expires_at, credentials.expiresAt)
  setExportField(record, 'expires_at', credentials.expires_at, credentials.expiresAt)
  syncCpaCredentialAliases(record, {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    api_key: apiKey,
    session_token: firstString(credentials.session_token, credentials.sessionToken),
    client_id: firstString(credentials.client_id, credentials.clientId),
    last_refresh: firstString(credentials.last_refresh, credentials.lastRefresh),
    expires_at: firstString(credentials.expires_at, credentials.expiresAt)
  })
  if (!accountId) warnings.push(`第 ${index + 1} 个账号导出时未写入 account_id（源数据未提供）`)
  return pruneExportEmptyFields(record)
}

function syncCpaCredentialAliases(record, values) {
  const aliases = {
    access_token: 'accessToken',
    refresh_token: 'refreshToken',
    id_token: 'idToken',
    api_key: 'apiKey',
    session_token: 'sessionToken',
    client_id: 'clientId',
    last_refresh: 'lastRefresh',
    expires_at: 'expiresAt'
  }
  const containers = [record]
  if (isJsonObject(record.tokens)) containers.push(record.tokens)
  if (isJsonObject(record.token)) containers.push(record.token)
  if (isJsonObject(record.credentials)) containers.push(record.credentials)
  Object.entries(values).forEach(([snakeKey, value]) => {
    const camelKey = aliases[snakeKey]
    containers.forEach((container, containerIndex) => {
      for (const key of [snakeKey, camelKey]) {
        if (containerIndex === 0 && key === snakeKey) continue
        if (!hasOwn(container, key)) continue
        if (value) container[key] = value
        else delete container[key]
      }
    })
  })
}

function mergeImportedSubProxies(accounts, warnings) {
  const proxies = []
  const canonicalKeys = new Set()
  const documentMaps = new Map()
  const accountProxyMaps = new Map()
  const aliases = new Map()

  accounts.forEach((account) => {
    const sourceProxies = Array.isArray(account?.sourceMetadata?.proxies) ? account.sourceMetadata.proxies : []
    const documentKey = `${firstString(account?.sourceName, 'input')}:${stableFingerprint(JSON.stringify(sourceProxies))}`
    let proxyMap = documentMaps.get(documentKey)
    if (!proxyMap) {
      proxyMap = new Map()
      sourceProxies.forEach((sourceProxy, proxyIndex) => {
        if (!isJsonObject(sourceProxy)) {
          throw new Error(`${account.sourceName} 第 ${proxyIndex + 1} 个代理不是有效对象`)
        }
        const normalized = normalizeNativeSubProxy(sourceProxy, account.sourceName, proxyIndex)
        const sourceAliases = [sourceProxy.proxy_key, sourceProxy.id, normalized.proxy.proxy_key]
          .map(value => exactProxyString(value))
          .filter(value => value !== '')
        sourceAliases.forEach(alias => {
          const previous = aliases.get(alias)
          if (previous && previous !== normalized.proxy.proxy_key) {
            warnings.push(`${account.sourceName} 第 ${proxyIndex + 1} 个代理与其它文档的同名代理定义冲突，已按真实定义重新生成 proxy_key`)
          }
          aliases.set(alias, normalized.proxy.proxy_key)
          proxyMap.set(alias, normalized.proxy.proxy_key)
        })
        if (exactProxyString(sourceProxy.proxy_key) && exactProxyString(sourceProxy.proxy_key) !== normalized.proxy.proxy_key) {
          warnings.push(`${account.sourceName} 第 ${proxyIndex + 1} 个代理的 proxy_key 与代理定义不一致，已规范化`)
        }
        if (!canonicalKeys.has(normalized.proxy.proxy_key)) {
          canonicalKeys.add(normalized.proxy.proxy_key)
          proxies.push(normalized.proxy)
        }
      })
      documentMaps.set(documentKey, proxyMap)
    }
    accountProxyMaps.set(account.key, proxyMap)
  })

  return { proxies, accountProxyMaps }
}

function normalizeNativeSubProxy(sourceProxy, sourceName, proxyIndex) {
  const proxy = cloneImportJsonObject(sourceProxy)
  let protocol = exactProxyString(proxy.protocol).replace(/:$/, '')
  let host = exactProxyString(proxy.host)
  let port = Number(proxy.port)
  let username = exactProxyString(proxy.username)
  let password = exactProxyString(proxy.password)
  const rawUrl = firstString(proxy.url)
  if (rawUrl && (!protocol || !host || !Number.isInteger(port) || port <= 0)) {
    try {
      const url = new URL(rawUrl)
      protocol ||= url.protocol.replace(/:$/, '')
      host ||= url.hostname
      port = Number.isInteger(port) && port > 0 ? port : Number(url.port || defaultProxyPort(protocol))
      username ||= decodeURIComponent(url.username)
      password ||= decodeURIComponent(url.password)
    } catch {
      throw new Error(`${sourceName} 第 ${proxyIndex + 1} 个代理定义无效，请检查 protocol/host/port`)
    }
  }
  if (!host || !Number.isInteger(port) || port <= 0) {
    throw new Error(`${sourceName} 第 ${proxyIndex + 1} 个代理缺少有效 host/port`)
  }
  proxy.protocol = protocol
  proxy.host = host
  proxy.port = port
  proxy.username = username
  proxy.password = password
  proxy.name = firstString(proxy.name, `${host}:${port}`)
  proxy.status = firstString(proxy.status, 'active')
  proxy.proxy_key = buildNativeSubProxyKey(protocol, host, port, username, password)
  delete proxy.id
  delete proxy.url
  return { proxy }
}

function buildNativeSubProxyKey(protocol, host, port, username, password) {
  return [protocol, host, port, username, password].map(value => String(value ?? '')).join('|')
}

function exactProxyString(value) {
  return value === undefined || value === null ? '' : String(value)
}

function defaultProxyPort(protocol) {
  if (protocol === 'http') return 80
  if (protocol === 'https') return 443
  if (protocol === 'socks5' || protocol === 'socks5h') return 1080
  return 0
}

function remapSubAccountProxyReference(result, proxyMap, account, index) {
  const reference = exactProxyString(result.proxy_key) || exactProxyString(result.proxy_id) || exactProxyString(result.proxyId)
  if (!reference) {
    delete result.proxy_id
    delete result.proxyId
    return
  }
  const resolved = proxyMap instanceof Map ? proxyMap.get(reference) : ''
  if (!resolved) {
    throw new Error(`${account.sourceName || '输入'} 第 ${index + 1} 个账号（${account.name || '未命名'}）引用的代理不存在，请修正或移除该账号的代理选择`)
  }
  result.proxy_key = resolved
  delete result.proxy_id
  delete result.proxyId
}

function normalizePositiveNumber(value, fallback) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback
}

function normalizePositiveInteger(value, fallback) {
  const numberValue = Number(value)
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback
}

function exportNormalizedAccountToSub(account, index, warnings, proxyMap = new Map()) {
  if (!isJsonObject(account)) throw new Error(`第 ${index + 1} 个账号不是对象`)
  const normalizedCredentials = objectOrEmpty(account.credentials)
  const canReuseOriginal = account.source === 'sub2api' && isJsonObject(account.original)
  const result = canReuseOriginal ? cloneImportJsonObject(account.original) : {}
  const credentials = {
    ...objectOrEmpty(result.credentials),
    ...cloneImportJsonObject(normalizedCredentials)
  }
  const accountId = firstString(account.accountId, credentials.chatgpt_account_id, credentials.account_id)
  setExportField(credentials, 'email', account.email)
  setExportField(credentials, 'chatgpt_account_id', accountId)
  setExportField(credentials, 'organization_id', account.workspaceId)
  setExportField(credentials, 'plan_type', account.planType)
  result.name = firstString(account.name, result.name, account.email, accountId, `导入账号 ${index + 1}`)
  result.platform = firstString(account.platform, result.platform, 'openai')
  result.type = firstString(account.accountType, result.type, account.authType, credentials.api_key ? 'api_key' : 'oauth')
  syncCpaCredentialAliases({ credentials }, {
    access_token: credentials.access_token, refresh_token: credentials.refresh_token,
    id_token: credentials.id_token, api_key: credentials.api_key,
    client_id: credentials.client_id, expires_at: credentials.expires_at, last_refresh: credentials.last_refresh
  })
  result.credentials = pruneExportEmptyFields(credentials)
  remapSubAccountProxyReference(result, proxyMap, account, index)
  result.concurrency = normalizePositiveInteger(result.concurrency ?? account.original?.concurrency, 3)
  result.priority = normalizePositiveInteger(result.priority ?? account.original?.priority, 50)
  result.rate_multiplier = normalizePositiveNumber(result.rate_multiplier ?? account.original?.rate_multiplier, 1)
  if (!isJsonObject(result.extra)) result.extra = {}
  if (!accountId) warnings.push(`第 ${index + 1} 个账号导出时未写入 account_id（源数据未提供）`)
  return result
}

function setExportField(target, key, ...values) {
  const value = firstString(...values)
  if (value) target[key] = value
  else delete target[key]
}

function pruneExportEmptyFields(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== null && item !== undefined))
}

function cloneImportJsonObject(value) {
  return isJsonObject(value) ? cloneImportJsonValue(value) : {}
}

function cloneImportJsonValue(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function firstImportedCredential(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || ''
}
