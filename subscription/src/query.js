const PLAN_ALIASES = {
  free: 'free',
  chatgptfreeplan: 'free',
  go: 'go',
  chatgptgoplan: 'go',
  plus: 'plus',
  chatgptplusplan: 'plus',
  prolite: 'pro5x',
  pro_lite: 'pro5x',
  pro5x: 'pro5x',
  pro: 'pro20x',
  pro20x: 'pro20x',
  chatgptproplan: 'pro20x',
  pro500: 'pro500',
  pro_max: 'pro500',
  team: 'team',
  chatgptteamplan: 'team',
  business: 'business',
  enterprise: 'enterprise'
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null
}

export function readJwtClaims(token) {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return {}
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return record(JSON.parse(decodeURIComponent(Array.from(atob(padded), (char) =>
      `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`
    ).join(''))))
  } catch {
    return {}
  }
}

export function normalizePlan(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '')
  if (!raw) return ''
  if (PLAN_ALIASES[raw]) return PLAN_ALIASES[raw]
  for (const [key, plan] of Object.entries(PLAN_ALIASES)) {
    if (key && raw.includes(key)) return plan
  }
  return raw
}

export function parseSessionInput(rawText) {
  const input = typeof rawText === 'string' ? rawText.trim() : ''
  const fenced = input.match(/^```(?:json)?\s*([\s\S]*?)\s*```(?=\s|$)/i)
  const jsonText = fenced ? fenced[1] : input.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let data
  try { data = JSON.parse(jsonText) }
  catch { throw new Error('Session JSON 格式错误') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Session JSON 必须是包含 accessToken 的对象')
  }
  const accessToken = text(data.accessToken, data.access_token)
  if (!accessToken) throw new Error('Session JSON 缺少 accessToken 或 access_token')
  const claims = readJwtClaims(accessToken)
  const auth = record(claims['https://api.openai.com/auth'])
  const profile = record(claims['https://api.openai.com/profile'])
  const user = record(data.user)
  const account = record(data.account)
  const tokenExpiry = typeof claims.exp === 'number' && Number.isFinite(claims.exp)
    ? new Date(claims.exp * 1000) : null
  const expires = tokenExpiry && !Number.isNaN(tokenExpiry.getTime()) ? tokenExpiry.toISOString() : ''
  return {
    accessToken,
    sessionToken: text(data.sessionToken, data.session_token),
    email: text(data.email, user.email, profile.email, claims.email),
    userId: text(data.userId, data.user_id, user.id, auth.chatgpt_user_id, auth.user_id, claims.sub),
    displayName: text(data.displayName, data.display_name, user.name, profile.name, claims.name),
    phone: text(data.phone, user.phone_number, user.phone, claims.phone_number),
    mfaEnabled: typeof data.mfaEnabled === 'boolean' ? data.mfaEnabled
      : typeof user.mfa === 'boolean' ? user.mfa
        : typeof user.mfa_enabled === 'boolean' ? user.mfa_enabled
          : typeof user.mfaEnabled === 'boolean' ? user.mfaEnabled : undefined,
    totpCount: data.totpCount ?? (Array.isArray(user.totp_authenticators) ? user.totp_authenticators.length : user.totp_count ?? user.totpCount ?? null),
    passkeyCount: data.passkeyCount ?? (Array.isArray(user.passkeys) ? user.passkeys.length : user.passkey_count ?? user.passkeyCount ?? null),
    accountId: text(data.accountId, data.account_id, account.id, account.account_id, auth.chatgpt_account_id, claims.chatgpt_account_id) || null,
    planType: text(data.planType, data.plan_type, account.planType, account.plan_type, auth.chatgpt_plan_type, claims.chatgpt_plan_type),
    expires: text(data.expires) || expires,
    createdAt: isoFromAny(first(account.createdTime, account.created_time, account.created, user.created, user.iat, data.created)),
    user,
    account,
    claims,
    auth,
    profile
  }
}

export function isoFromAny(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    const seconds = value > 10_000_000_000 ? value / 1000 : value
    const date = new Date(seconds * 1000)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function walk(obj, ...keys) {
  let current = obj
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

function sourceStatus(value) {
  if (value === undefined || value === null) return 'missing'
  if (typeof value === 'object' && value._error) {
    const error = String(value._error)
    if (/cors/i.test(error)) return 'cors'
    if (/HTTP 401|HTTP 403/.test(error)) return 'auth'
    if (/HTTP /.test(error)) return 'http'
    return 'error'
  }
  return 'ok'
}

export function walkInvoices(payload) {
  if (!payload || payload._error) return []
  const data = record(payload)
  const items = []
  const lists = [data.items, data.data, data.invoices, data.subscriptions, data.records]
  for (const list of lists) {
    if (Array.isArray(list)) items.push(...list)
  }
  if (Array.isArray(payload)) items.push(...payload)
  const orders = []
  for (const item of items) {
    const entry = record(item)
    const startTime = isoFromAny(first(entry.period_start, entry.start_time, entry.start, entry.created, entry.created_at, entry.createdTime))
    const expireTime = isoFromAny(first(entry.period_end, entry.expire_time, entry.expires_at, entry.end, entry.current_period_end))
    const amount = first(entry.amount_paid, entry.amount_due, entry.total, entry.amount, entry.billingAmount)
    if (!startTime && !expireTime && amount == null) continue
    const blob = JSON.stringify(entry)
    orders.push({
      id: text(entry.id, entry.invoice_id, entry.number),
      accountType: normalizePlan(first(entry.plan_type, entry.plan, entry.accountType)) || '',
      payChannelType: /apple|itunes|app_store/i.test(blob) ? 3
        : /google|play_store/i.test(blob) ? 2 : 1,
      startTime,
      expireTime,
      billingAmount: amount,
      currency: text(entry.currency).toUpperCase(),
      state: text(entry.status, entry.state) || 'unknown',
      hostedInvoiceUrl: text(entry.hosted_invoice_url, entry.invoice_pdf, entry.url)
    })
  }
  return orders
}

async function chatgptGet(path, session) {
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'application/json'
  }
  if (session.accountId) headers['ChatGPT-Account-Id'] = session.accountId
  try {
    const response = await fetch(`https://chatgpt.com${path}`, {
      method: 'GET',
      headers,
      mode: 'cors',
      cache: 'no-store'
    })
    if (!response.ok) return { _error: `HTTP ${response.status}`, status: response.status }
    return await response.json()
  } catch (error) {
    const message = String(error?.message || error)
    const cors = /failed to fetch|networkerror|cors|load failed/i.test(message)
    return { _error: cors ? 'cors' : message, status: 0 }
  }
}

async function queryViaProxy(session) {
  const endpoints = ['/api/subscription/query']
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          session: {
            accessToken: session.accessToken,
            sessionToken: session.sessionToken,
            account: session.account,
            user: session.user,
            expires: session.expires
          }
        })
      })
      if (!response.ok) continue
      const result = await response.json()
      if (result?.ok && result.subscription) {
        result.queryMode = result.queryMode || 'proxy'
        return result
      }
    } catch {
      continue
    }
  }
  return null
}

function usageFromPayload(usage) {
  if (!usage || usage._error) return { status: 'not_returned' }
  const data = record(usage)
  const rate = record(data.rate_limit || data.rateLimit || data.rate_limits)
  const primary = record(rate.primary_window || rate.primaryWindow || rate.primary)
  const used = first(primary.used_percent, primary.usedPercent)
  if (used === null) return { status: 'not_returned' }
  const resetAt = isoFromAny(first(primary.reset_at, primary.resets_at, primary.resetsAt))
    || (typeof primary.reset_after_seconds === 'number'
      ? new Date(Date.now() + primary.reset_after_seconds * 1000).toISOString()
      : '')
  const credits = record(data.rate_limit_reset_credits)
  return {
    status: 'available',
    usedPercent: used,
    resetAt,
    secondaryUsedPercent: null,
    secondaryResetAt: '',
    resetCreditsAvailable: typeof credits.available_count === 'number' ? credits.available_count : null,
    resetCredits: [],
    additionalLimits: []
  }
}

function modelsFromPayload(payload) {
  if (!payload || payload._error) return { status: 'not_returned', available: [] }
  const items = Array.isArray(payload?.models) ? payload.models : []
  const available = []
  const seen = new Set()
  for (const item of items) {
    const entry = record(item)
    const slug = text(entry.slug, entry.id, entry.model)
    const title = text(entry.title, entry.name, slug)
    const lowered = `${slug} ${title}`.toLowerCase()
    if (entry.enabled === false || entry.available === false) continue
    if (['alpha', 'reserved', 'gate_', '-t-mini-mini'].some((token) => lowered.includes(token))) continue
    if (!title || seen.has(title)) continue
    seen.add(title)
    available.push({ id: slug || title, ids: [slug].filter(Boolean), label: title })
  }
  return available.length ? { status: 'available', available, defaultModel: '' } : { status: 'not_returned', available: [] }
}

export function buildResult(session, fetched = {}, queryMode = '') {
  const me = record(fetched.me?._error ? null : fetched.me)
  const accounts = record(fetched.accounts?._error ? null : fetched.accounts)
  const accountItem = record(Array.isArray(accounts.items) ? accounts.items[0] : null)
  const entitlement = record(first(
    walk(accounts, 'accounts', 'default', 'entitlement'),
    walk(accounts, 'accounts', 'default')
  ))
  const accountNested = record(walk(accounts, 'accounts', 'default', 'account'))
  const livePlan = normalizePlan(first(
    me.plan_type,
    accountNested.plan_type,
    accountItem.plan_type,
    entitlement.plan_type,
    session.planType
  )) || 'free'
  const paid = livePlan !== 'free'
  const usage = usageFromPayload(fetched.usage)
  const models = modelsFromPayload(fetched.models)
  const orders = [
    ...walkInvoices(fetched.invoices),
    ...walkInvoices(fetched.subscriptions)
  ]
  const sources = {
    me: sourceStatus(fetched.me),
    accounts: sourceStatus(fetched.accounts),
    models: sourceStatus(fetched.models),
    usage: sourceStatus(fetched.usage),
    invoices: sourceStatus(fetched.invoices),
    subscriptions: sourceStatus(fetched.subscriptions)
  }
  const anyLive = Object.values(sources).some((status) => status === 'ok')
  const createdAt = isoFromAny(first(
    accountItem.created_time,
    accountNested.created_time,
    entitlement.created_time,
    session.createdAt
  ))
  const billingExpire = isoFromAny(first(
    walk(fetched.subscriptions, 'current_period_end'),
    walk(fetched.subscriptions, 'expires_at'),
    entitlement.expires_at,
    entitlement.subscription_expires_at,
    accountItem.subscription_expires_at,
    accountNested.subscription_expires_at
  ))
  const actionToken = crypto.getRandomValues(new Uint8Array(24)).reduce((text, byte) => text + byte.toString(16).padStart(2, '0'), '')
  const mobileRecords = orders.filter((item) => item.payChannelType === 2 || item.payChannelType === 3)
  const webOrders = orders.filter((item) => item.payChannelType === 1)
  const phone = text(me.phone_number, me.phone, session.phone)
  const resolvedMode = queryMode || (anyLive ? 'browser-live' : 'browser-session')
  return {
    ok: true,
    actionToken,
    queryMode: resolvedMode,
    subscription: {
      state: paid ? 'active' : 'none',
      accountType: paid ? livePlan : 'free',
      payChannelType: mobileRecords.length ? mobileRecords[0].payChannelType : paid ? 1 : 0,
      autoRenewKnown: false,
      autoRenew: null,
      expireTime: billingExpire,
      startTime: isoFromAny(first(orders[0]?.startTime, entitlement.starts_at, createdAt)),
      createdAt,
      gracePeriodEndTime: '',
      paymentCycle: paid ? 'monthly' : '',
      currency: webOrders[0]?.currency || '',
      currencyName: '',
      billingRegion: text(me.country, entitlement.country),
      isOverdue: false,
      billingAmount: webOrders[0]?.billingAmount ?? null,
      formattedPrice: '',
      email: text(me.email, session.email),
      upgradePrice: { status: 'not_applicable' }
    },
    accountDiagnostics: {
      profile: {
        displayName: text(me.name, session.displayName, session.email) || 'ChatGPT 用户',
        email: text(me.email, session.email),
        phone
      },
      security: {
        mfaEnabled: typeof session.mfaEnabled === 'boolean' ? session.mfaEnabled : null,
        totpCount: session.totpCount,
        totpConfirmed: Boolean(session.totpCount),
        passkeyCount: session.passkeyCount,
        passkeyConfirmed: Boolean(session.passkeyCount)
      },
      session: { expiresAt: session.expires },
      codexUsage: usage,
      models,
      webFeatures: [],
      blockedFeatures: [],
      webInvoices: webOrders,
      sources,
      fieldAvailability: {
        phone: Boolean(phone),
        expireTime: Boolean(billingExpire),
        createdAt: Boolean(createdAt),
        sessionExpires: Boolean(session.expires),
        invoices: webOrders.length,
        mobileOrders: mobileRecords.length,
        usage: usage.status,
        models: models.status
      }
    },
    mobileBilling: mobileRecords.length
      ? { status: 'complete', records: mobileRecords }
      : { status: 'unavailable', records: [] }
  }
}

export async function querySubscriptionLocally(rawText) {
  const session = parseSessionInput(rawText)
  const proxied = await queryViaProxy(session)
  if (proxied) return proxied

  const fetched = {}
  await Promise.allSettled([
    chatgptGet('/backend-api/me', session).then((data) => { fetched.me = data }),
    chatgptGet('/backend-api/accounts', session).then((data) => { fetched.accounts = data }),
    chatgptGet('/backend-api/models', session).then((data) => { fetched.models = data }),
    chatgptGet('/backend-api/wham/usage', session).then((data) => { fetched.usage = data }),
    chatgptGet('/backend-api/payments/invoices', session).then((data) => { fetched.invoices = data }),
    chatgptGet('/backend-api/subscriptions', session).then((data) => { fetched.subscriptions = data })
  ])
  return buildResult(session, fetched)
}
