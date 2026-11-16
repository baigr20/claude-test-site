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
    userId: text(data.userId, data.user_id, user.id, auth.chatgpt_user_id, auth.user_id,
      claims.chatgpt_user_id, claims.user_id, claims.sub),
    displayName: text(data.displayName, data.display_name, user.name, profile.name, claims.name),
    phone: text(data.phone, user.phone_number, user.phone, claims.phone_number),
    mfaEnabled: typeof data.mfaEnabled === 'boolean' ? data.mfaEnabled
      : typeof user.mfa === 'boolean' ? user.mfa
        : typeof user.mfa_enabled === 'boolean' ? user.mfa_enabled
          : typeof user.mfaEnabled === 'boolean' ? user.mfaEnabled : undefined,
    totpCount: data.totpCount ?? (Array.isArray(user.totp_authenticators) ? user.totp_authenticators.length : user.totp_count ?? user.totpCount ?? null),
    passkeyCount: data.passkeyCount ?? (Array.isArray(user.passkeys) ? user.passkeys.length : user.passkey_count ?? user.passkeyCount ?? null),
    refreshToken: text(data.refreshToken, data.refresh_token) || null,
    accountId: text(data.accountId, data.account_id, account.id, account.account_id,
      auth.chatgpt_account_id, auth.account_id, claims.chatgpt_account_id, claims.account_id) || null,
    planType: text(data.planType, data.plan_type, account.planType, account.plan_type, auth.chatgpt_plan_type, claims.chatgpt_plan_type),
    expires: text(data.expires) || expires,
    subscription: null,
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

function knownBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return null
}

function selectedAccount(payload, session) {
  const data = record(payload)
  const accounts = record(data.accounts)
  const preferred = text(session?.accountId)
  const preferredAccount = record(accounts[preferred])
  if (preferred && (preferredAccount.account || preferredAccount.entitlement || preferredAccount.last_active_subscription)) {
    return preferredAccount
  }
  if (accounts.default) return record(accounts.default)
  const ordering = Array.isArray(data.account_ordering) ? data.account_ordering : []
  for (const id of ordering) {
    if (accounts[id]) return record(accounts[id])
  }
  return {}
}

function channelFromOrigin(value) {
  const raw = String(value || '').toLowerCase()
  if (!raw) return 0
  if (/apple|ios|itunes|app_store/.test(raw)) return 3
  if (/android|google|play/.test(raw)) return 2
  if (/web|stripe|chatgpt/.test(raw)) return 1
  return 0
}

function cycleFrom(value) {
  const raw = String(value || '').toLowerCase()
  if (/year|annual/.test(raw)) return 'yearly'
  if (/month/.test(raw)) return 'monthly'
  return ''
}

function subscriptionState({ hasActive, entitlement, subscriptions, expireTime }) {
  const subs = record(subscriptions?._error ? null : subscriptions)
  const delinquent = entitlement.is_delinquent === true || subs.is_delinquent === true
  const status = String(first(subs.status, entitlement.subscription_status) || '').toLowerCase()
  if (delinquent || status === 'paused' || status === 'past_due') return 'paused'
  if (hasActive) return 'active'
  const end = Date.parse(expireTime || '')
  if (Number.isFinite(end) && end > Date.now()) return 'active'
  if (Number.isFinite(end) && end <= Date.now()) return 'expired'
  if (['canceled', 'cancelled', 'expired', 'inactive'].includes(status)) return 'expired'
  return 'none'
}

function windowUsage(value) {
  const entry = record(value)
  const used = first(entry.used_percent, entry.usedPercent)
  if (used === null || used === undefined || used === '') return null
  const resetAt = isoFromAny(first(entry.reset_at, entry.resets_at, entry.resetsAt))
    || (typeof entry.reset_after_seconds === 'number'
      ? new Date(Date.now() + entry.reset_after_seconds * 1000).toISOString()
      : '')
  return { usedPercent: Number(used), resetAt }
}

function creditEntries(value) {
  const data = record(value)
  const list = Array.isArray(data.credits) ? data.credits
    : Array.isArray(data.items) ? data.items
      : Array.isArray(value) ? value
        : []
  return list.map((item) => {
    const entry = record(item)
    return {
      title: text(entry.title, entry.name),
      description: text(entry.description, entry.detail),
      status: text(entry.status),
      expiresAt: isoFromAny(first(entry.expires_at, entry.expiresAt, entry.expire_time))
    }
  })
}

function usageFromPayload(usage, creditsPayload) {
  const data = record(!usage || usage._error ? null : usage)
  const creditsSource = record(!creditsPayload || creditsPayload._error ? null : creditsPayload)
  const rate = record(data.rate_limit || data.rateLimit || data.rate_limits)
  const primary = windowUsage(rate.primary_window || rate.primaryWindow || rate.primary)
  const secondary = windowUsage(rate.secondary_window || rate.secondaryWindow || rate.secondary)
  const creditRecord = [data.rate_limit_reset_credits, creditsSource.rate_limit_reset_credits, creditsSource]
    .map(record)
    .find((item) => typeof item.available_count === 'number' || Array.isArray(item.credits) || Array.isArray(item.items))
    || {}
  const extras = rate.additional_windows || rate.additional_limits || rate.other_windows || []
  const additionalLimits = Array.isArray(extras)
    ? extras.flatMap((item) => {
      const parsed = windowUsage(item)
      if (!parsed) return []
      return [{ label: text(record(item).label, record(item).name, record(item).id) || '其他用量', ...parsed }]
    })
    : []
  if (!primary && !secondary && typeof creditRecord.available_count !== 'number' && !additionalLimits.length && !creditEntries(creditRecord).length) {
    return { status: 'not_returned' }
  }
  return {
    status: 'available',
    usedPercent: primary?.usedPercent ?? null,
    resetAt: primary?.resetAt || '',
    secondaryUsedPercent: secondary?.usedPercent ?? null,
    secondaryResetAt: secondary?.resetAt || '',
    resetCreditsAvailable: typeof creditRecord.available_count === 'number' ? creditRecord.available_count : null,
    resetCredits: creditEntries(creditRecord),
    additionalLimits
  }
}

function featuresFromInit(payload) {
  if (!payload || payload._error) return { features: [], blocked: [] }
  const data = record(payload)
  const raw = Array.isArray(data.features) ? data.features
    : Array.isArray(data.web_features) ? data.web_features
      : []
  const features = raw.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ key: item.trim(), label: item.trim(), remaining: null, limit: null, used: null, resetAt: '', detail: '' }]
    }
    const entry = record(item)
    const label = text(entry.label, entry.title, entry.name, entry.key)
    if (!label) return []
    return [{
      key: text(entry.key, entry.id, entry.name, label),
      label,
      remaining: first(entry.remaining, entry.remaining_count),
      limit: first(entry.limit, entry.limit_count),
      used: first(entry.used, entry.used_count),
      resetAt: isoFromAny(first(entry.reset_at, entry.resets_at)),
      detail: text(entry.detail, entry.description)
    }]
  })
  const blockedRaw = Array.isArray(data.blocked_features) ? data.blocked_features : []
  const blocked = blockedRaw.map((item) => typeof item === 'string' ? item : text(record(item).key, record(item).label)).filter(Boolean)
  return { features, blocked }
}

function securityFrom(settings, session) {
  const data = record(settings?._error ? null : settings)
  const user = record(data.user || data)
  const totpList = user.totp_authenticators || data.totp_authenticators
  const passkeys = user.passkeys || data.passkeys
  return {
    mfaEnabled: knownBoolean(user.mfa, user.mfa_enabled, user.mfaEnabled, data.mfa, data.mfa_enabled, session.mfaEnabled),
    totpCount: Array.isArray(totpList) ? totpList.length : (session.totpCount ?? null),
    totpConfirmed: Array.isArray(totpList) || Boolean(session.totpCount),
    passkeyCount: Array.isArray(passkeys) ? passkeys.length : (session.passkeyCount ?? null),
    passkeyConfirmed: Array.isArray(passkeys) || Boolean(session.passkeyCount)
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
  const settings = record(fetched.settings?._error ? null : fetched.settings)
  const checkAccount = selectedAccount(fetched.accountCheck?._error ? null : fetched.accountCheck, session)
  const accounts = record(fetched.accounts?._error ? null : fetched.accounts)
  const accountsAccount = selectedAccount(accounts, session)
  const accountItem = record(Array.isArray(accounts.items) ? accounts.items[0] : null)
  const entitlement = record(checkAccount.entitlement || accountsAccount.entitlement || walk(accounts, 'accounts', 'default', 'entitlement'))
  const lastActive = record(checkAccount.last_active_subscription || accountsAccount.last_active_subscription)
  const accountNested = record(checkAccount.account || accountsAccount.account || walk(accounts, 'accounts', 'default', 'account'))
  const subscriptions = record(fetched.subscriptions?._error ? null : fetched.subscriptions)
  const livePlan = normalizePlan(first(
    entitlement.subscription_plan,
    me.plan_type,
    accountNested.plan_type,
    accountItem.plan_type,
    entitlement.plan_type,
    lastActive.plan_type,
    session.planType
  )) || 'free'
  const hasActive = typeof entitlement.has_active_subscription === 'boolean'
    ? entitlement.has_active_subscription
    : livePlan !== 'free'
  const usage = usageFromPayload(fetched.usage, fetched.credits)
  const models = modelsFromPayload(fetched.models)
  const featureLimits = featuresFromInit(fetched.init)
  const orders = [
    ...walkInvoices(fetched.invoices),
    ...walkInvoices(fetched.subscriptions)
  ]
  const sources = {
    me: sourceStatus(fetched.me),
    accounts: sourceStatus(fetched.accounts),
    accountCheck: sourceStatus(fetched.accountCheck),
    models: sourceStatus(fetched.models),
    usage: sourceStatus(fetched.usage),
    credits: sourceStatus(fetched.credits),
    settings: sourceStatus(fetched.settings),
    init: sourceStatus(fetched.init),
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
    subscriptions.current_period_end,
    subscriptions.expires_at,
    entitlement.expires_at,
    lastActive.expires_at,
    entitlement.subscription_expires_at,
    accountItem.subscription_expires_at,
    accountNested.subscription_expires_at
  ))
  const state = subscriptionState({
    hasActive,
    entitlement,
    subscriptions: fetched.subscriptions,
    expireTime: billingExpire
  })
  const autoRenew = knownBoolean(lastActive.will_renew, subscriptions.will_renew, entitlement.will_renew)
  const originChannel = channelFromOrigin(first(lastActive.purchase_origin_platform, subscriptions.purchase_origin_platform))
  const invoiceMobile = orders.filter((item) => item.payChannelType === 2 || item.payChannelType === 3)
  const payChannelType = originChannel || (invoiceMobile.length ? invoiceMobile[0].payChannelType : ((state === 'active' || state === 'paused') ? 1 : 0))
  const webOrders = orders.filter((item) => item.payChannelType === 1)
  const currency = text(lastActive.billing_currency, entitlement.billing_currency, subscriptions.billing_currency, webOrders[0]?.currency).toUpperCase()
  const billingAmount = first(lastActive.price, lastActive.billing_amount, entitlement.billing_amount, webOrders[0]?.billingAmount)
  const billingRegion = text(lastActive.billing_region, entitlement.billing_region, me.country, entitlement.country)
  const isOverdue = entitlement.is_delinquent === true || subscriptions.is_delinquent === true
  const startTime = isoFromAny(first(lastActive.starts_at, entitlement.starts_at, orders[0]?.startTime, createdAt))
  const accountType = state === 'none' || !livePlan ? 'free' : livePlan
  const liveMobile = payChannelType === 2 || payChannelType === 3
    ? [{
      id: text(lastActive.subscription_id, subscriptions.id),
      accountType,
      payChannelType,
      startTime,
      expireTime: billingExpire,
      billingAmount,
      currency,
      state,
      autoRenewKnown: autoRenew !== null,
      autoRenew,
      billingRegion,
      isOverdue,
      refundedTime: ''
    }]
    : []
  const mobileRecords = [...liveMobile, ...invoiceMobile]
  const phone = text(me.phone_number, me.phone, settings.phone_number, session.phone)
  const actionToken = crypto.getRandomValues(new Uint8Array(24)).reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '')
  return {
    ok: true,
    actionToken,
    queryMode: queryMode || (anyLive ? 'browser-live' : 'browser-session'),
    subscription: {
      state,
      accountType,
      payChannelType,
      autoRenewKnown: autoRenew !== null,
      autoRenew,
      expireTime: billingExpire,
      startTime,
      createdAt,
      gracePeriodEndTime: isoFromAny(first(
        entitlement.grace_period_end_timestamp,
        entitlement.grace_period_end,
        subscriptions.grace_period_end
      )),
      paymentCycle: cycleFrom(first(lastActive.billing_period, entitlement.billing_period, subscriptions.billing_period)),
      currency,
      currencyName: text(lastActive.currency_name, entitlement.currency_name),
      billingRegion,
      isOverdue,
      billingAmount,
      formattedPrice: text(lastActive.formatted_price, entitlement.formatted_price),
      email: text(me.email, session.email),
      upgradePrice: { status: 'not_applicable' }
    },
    accountDiagnostics: {
      profile: {
        displayName: text(me.name, session.displayName, session.email) || 'ChatGPT 用户',
        email: text(me.email, session.email),
        phone
      },
      security: securityFrom(fetched.settings, session),
      session: { expiresAt: session.expires },
      codexUsage: usage,
      models,
      webFeatures: featureLimits.features,
      blockedFeatures: featureLimits.blocked,
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
        models: models.status,
        autoRenew: autoRenew !== null
      }
    },
    mobileBilling: mobileRecords.length
      ? { status: 'complete', records: mobileRecords }
      : { status: 'unavailable', records: [] }
  }
}
