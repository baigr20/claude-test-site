const DAY_MS = 24 * 60 * 60 * 1000

const TIER_LABELS = {
  SUBSCRIPTION_TIER_GROK_PRO: 'SuperGrok',
  SUBSCRIPTION_TIER_GROK_PREMIUM: 'SuperGrok Premium',
  SUBSCRIPTION_TIER_GROK_BASIC: 'SuperGrok Basic',
  SUBSCRIPTION_TIER_SUPER_GROK_PRO: 'SuperGrok Pro',
  SUBSCRIPTION_TIER_X_PREMIUM_PLUS: 'X Premium+',
  SUBSCRIPTION_TIER_X_PREMIUM: 'X Premium',
  SUBSCRIPTION_TIER_X_BASIC: 'X Basic'
}

const STATUS_LABELS = {
  SUBSCRIPTION_STATUS_ACTIVE: '生效',
  SUBSCRIPTION_STATUS_INACTIVE: '未生效'
}

const INTERVAL_LABELS = {
  BILLING_INTERVAL_MONTHLY: '月付',
  BILLING_INTERVAL_YEARLY: '年付'
}

const CHANNEL_LABELS = {
  google: 'Google Play',
  stripe: 'Stripe',
  apple: 'Apple',
  x: 'X',
  unknown: '未知渠道'
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function tierLabel(tier) {
  const raw = text(tier)
  if (TIER_LABELS[raw]) return TIER_LABELS[raw]
  if (!raw) return '未知套餐'
  return raw.replace(/^SUBSCRIPTION_TIER_/, '').replace(/_/g, ' ')
}

function channelOf(entry) {
  const google = record(entry.google)
  const stripe = record(entry.stripe)
  const apple = record(entry.apple)
  const x = record(entry.x)
  if (google && (google.expiryTime || google.productId || google.purchaseToken)) return 'google'
  if (stripe && (stripe.subscriptionId || stripe.currentPeriodEnd || stripe.productId)) return 'stripe'
  if (apple && Object.keys(apple).length) return 'apple'
  if (x) return 'x'
  if (google) return 'google'
  if (stripe) return 'stripe'
  return 'unknown'
}

function expiryOf(entry, channel) {
  if (channel === 'google') return text(entry.google?.expiryTime) || text(entry.billingPeriodEnd)
  if (channel === 'stripe') return text(entry.stripe?.currentPeriodEnd) || text(entry.billingPeriodEnd)
  if (channel === 'apple') return text(entry.apple?.expiryTime) || text(entry.billingPeriodEnd)
  return text(entry.billingPeriodEnd)
}

function productIdOf(entry, channel) {
  if (channel === 'google') return text(entry.google?.productId)
  if (channel === 'stripe') return text(entry.stripe?.productId)
  if (channel === 'apple') return text(entry.apple?.productId)
  return ''
}

function autoRenewOf(entry, channel) {
  if (channel === 'google' && typeof entry.google?.autoRenewEnabled === 'boolean') {
    return entry.google.autoRenewEnabled
  }
  if (typeof entry.cancelAtPeriodEnd === 'boolean') return !entry.cancelAtPeriodEnd
  if (channel === 'stripe' && typeof entry.stripe?.cancelAtPeriodEnd === 'boolean') {
    return !entry.stripe.cancelAtPeriodEnd
  }
  return null
}

export function formatBeijing(iso) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(time))
  const pick = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`
}

export function overduePhrase(remainingMs) {
  if (!(remainingMs < 0)) return ''
  const past = -remainingMs
  const minute = 60 * 1000
  const hour = 60 * minute
  if (past < hour) return `已过 ${Math.max(1, Math.round(past / minute))} 分钟`
  if (past < DAY_MS) return `已过 ${Math.floor(past / hour)} 小时`
  return ''
}

function expiryState(expiry, now) {
  const end = Date.parse(expiry)
  if (!expiry || !Number.isFinite(end)) {
    return { daysLeft: null, overdue: false, remainingMs: null }
  }
  const remainingMs = end - now
  const daysLeft = Math.ceil(remainingMs / DAY_MS)
  return {
    daysLeft: Object.is(daysLeft, -0) ? 0 : daysLeft,
    overdue: remainingMs < 0,
    remainingMs
  }
}

function normalizeEntry(entry, now) {
  const channel = channelOf(entry)
  const expiry = expiryOf(entry, channel)
  const timing = expiryState(expiry, now)
  const autoRenew = autoRenewOf(entry, channel)
  const active = entry.status === 'SUBSCRIPTION_STATUS_ACTIVE'
  return {
    tier: text(entry.tier),
    tierLabel: tierLabel(entry.tier),
    status: text(entry.status),
    statusLabel: STATUS_LABELS[entry.status] || (entry.status ? String(entry.status) : '未知状态'),
    active,
    channel,
    channelLabel: CHANNEL_LABELS[channel] || CHANNEL_LABELS.unknown,
    productId: productIdOf(entry, channel),
    interval: text(entry.billingInterval),
    intervalLabel: INTERVAL_LABELS[entry.billingInterval] || '',
    expiry,
    expiryText: formatBeijing(expiry),
    daysLeft: timing.daysLeft,
    overdue: timing.overdue,
    remainingMs: timing.remainingMs,
    overdueText: overduePhrase(timing.remainingMs),
    autoRenew,
    autoRenewLabel: autoRenew === null ? '没有返回' : (autoRenew ? '自动续费开着' : '自动续费关着'),
    createdText: formatBeijing(entry.createTime)
  }
}

function pickPrimary(items) {
  const dated = items
    .map((item, index) => ({ item, index }))
    .filter((row) => row.item.active && row.item.expiry)
  const future = dated.filter((row) => !row.item.overdue)
  const pool = future.length ? future : dated.filter((row) => row.item.overdue)
  if (!pool.length) return -1
  pool.sort((a, b) => {
    const left = Date.parse(a.item.expiry)
    const right = Date.parse(b.item.expiry)
    return future.length ? left - right : right - left
  })
  return pool[0].index
}

function headlineFor(primary) {
  if (!primary) return '生效订阅没有到期时间'
  if (primary.overdue && primary.daysLeft < 0) return `已过 ${-primary.daysLeft} 天`
  if (primary.overdue) return '已到期，剩余 0 天'
  return `剩余 ${primary.daysLeft} 天`
}

function detailFor(items, primary) {
  const activeUndated = items.filter((item) => item.active && !item.expiry)
  const inactiveDated = items.filter((item) => !item.active && item.expiry)
  const parts = []
  if (primary) {
    parts.push(`${primary.tierLabel} · ${primary.channelLabel}${primary.expiryText ? ` · ${primary.expiryText}（北京时间）` : ''}`)
    if (primary.overdue && primary.autoRenew === true) {
      parts.push('自动续费开着，新的到期时间可能还没写回这份 JSON。')
    }
  }
  if (activeUndated.length) {
    const names = activeUndated.map((item) => item.tierLabel).join('、')
    parts.push(`${names} 在生效，但这条没有到期时间，不算剩余天数。`)
  }
  if (inactiveDated.length) parts.push('未生效记录里的到期日不计入剩余天数。')
  return parts.join(' ')
}

export function parseGrokPayload(raw, now = Date.now()) {
  const source = String(raw || '').trim()
  if (!source) throw new Error('请先粘贴订阅 JSON')
  let data
  try {
    data = JSON.parse(source)
  } catch {
    throw new Error('JSON 无法解析。请复制 grok.com/rest/subscriptions 的整页内容。')
  }
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.subscriptions)
      ? data.subscriptions
      : (record(data) && (data.status || data.tier) ? [data] : null)
  if (!list) throw new Error('没有找到 subscriptions')
  const items = list.filter((entry) => record(entry)).map((entry) => normalizeEntry(entry, now))
  const primaryIndex = pickPrimary(items)
  const primary = primaryIndex >= 0 ? items[primaryIndex] : null
  const dominant = record(data?.dominantPlan)
  return {
    items,
    primaryIndex,
    summary: {
      daysLeft: primary ? primary.daysLeft : null,
      overdue: primary ? primary.overdue : false,
      headline: headlineFor(primary),
      detail: detailFor(items, primary)
    },
    dominant: {
      plan: text(dominant?.plan),
      display: text(dominant?.surfaceNames?.SURFACE_DISPLAY)
    }
  }
}
