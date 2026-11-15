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
    user,
    account,
    claims,
    auth,
    profile
  }
}

function isoFromAny(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    const seconds = value > 10_000_000_000 ? value / 1000 : value
    const date = new Date(seconds * 1000)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

async function chatgptGet(path, session) {
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'application/json'
  }
  if (session.accountId) headers['ChatGPT-Account-Id'] = session.accountId
  const response = await fetch(`https://chatgpt.com${path}`, {
    method: 'GET',
    headers,
    mode: 'cors',
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`)
  return response.json()
}

function usageFromPayload(usage) {
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

export async function querySubscriptionLocally(rawText) {
  const session = parseSessionInput(rawText)
  const plan = normalizePlan(session.planType) || 'free'
  const paid = plan !== 'free'
  const fetched = {}
  await Promise.allSettled([
    chatgptGet('/backend-api/me', session).then((data) => { fetched.me = data }),
    chatgptGet('/backend-api/accounts', session).then((data) => { fetched.accounts = data }),
    chatgptGet('/backend-api/models', session).then((data) => { fetched.models = data }),
    chatgptGet('/backend-api/wham/usage', session).then((data) => { fetched.usage = data })
  ])

  const me = record(fetched.me)
  const usage = fetched.usage ? usageFromPayload(fetched.usage) : { status: 'not_returned' }
  const models = fetched.models ? modelsFromPayload(fetched.models) : { status: 'not_returned', available: [] }
  const live = Boolean(fetched.me || fetched.usage || fetched.models || fetched.accounts)

  const actionToken = crypto.getRandomValues(new Uint8Array(24)).reduce((text, byte) => text + byte.toString(16).padStart(2, '0'), '')
  return {
    ok: true,
    actionToken,
    queryMode: live ? 'browser-live' : 'browser-session',
    subscription: {
      state: paid ? 'active' : 'none',
      accountType: paid ? plan : 'free',
      payChannelType: 0,
      autoRenewKnown: false,
      autoRenew: null,
      expireTime: '',
      startTime: '',
      gracePeriodEndTime: '',
      paymentCycle: '',
      currency: '',
      currencyName: '',
      billingRegion: text(me.country),
      isOverdue: false,
      billingAmount: null,
      formattedPrice: '',
      email: text(me.email, session.email),
      upgradePrice: { status: 'not_applicable' }
    },
    accountDiagnostics: {
      profile: {
        displayName: text(me.name, session.displayName, session.email) || 'ChatGPT 用户',
        email: text(me.email, session.email),
        phone: text(me.phone_number, session.phone)
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
      blockedFeatures: []
    },
    mobileBilling: { status: 'unavailable', records: [] }
  }
}
