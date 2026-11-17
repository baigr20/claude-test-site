let currentActionToken = null;
let currentSubscription = null;
let currentAccountDiagnostics = null;
let currentMobileBilling = { status: 'unavailable', records: [] };
let busy = false;
let lastFocusedElement = null;
let expiryTimer = null;
const RESULT_TRANSFER_KEY = 'checkgpt.result.v2';
const RESULT_LIFETIME_MS = 15 * 60 * 1000;
const WORKER_ORIGIN = 'https://api.aideal.vip/subscription';

document.addEventListener('DOMContentLoaded', initializeResultPage);
document.addEventListener('keydown', handleModalKeydown);
document.addEventListener('click', handleResultAction);

function handleResultAction(event) {
    const target = event.target?.closest?.('[data-result-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.resultAction;
    if (action === 'confirm-cancel') confirmCancelRenewal();
    else if (action === 'cancel-renewal') return cancelRenewal();
    else if (action === 'confirm-renew') confirmRestoreRenewal();
    else if (action === 'restore-renewal') return restoreRenewal();
    else if (action === 'billing-link') requestBillingLink();
}

function initializeResultPage() {
    let transfer = null;
    let serialized = '';
    try {
        serialized = sessionStorage.getItem(RESULT_TRANSFER_KEY) || '';
        sessionStorage.removeItem(RESULT_TRANSFER_KEY);
    } catch {}
    if (!serialized) serialized = window.name || '';
    try { transfer = JSON.parse(serialized || 'null'); }
    catch { transfer = null; }
    window.name = '';

    const fresh = Number.isFinite(transfer?.createdAt) && Date.now() - transfer.createdAt < RESULT_LIFETIME_MS;
    const valid = ['chatgpt-billing-result-v1', 'chatgpt-billing-result-v2'].includes(transfer?.type)
        && fresh
        && typeof transfer.actionToken === 'string'
        && transfer.actionToken.length >= 24
        && transfer.subscription;

    if (!valid) {
        renderUnavailable();
        return;
    }

    currentActionToken = transfer.actionToken;
    currentSubscription = transfer.subscription;
    currentAccountDiagnostics = transfer.accountDiagnostics || null;
    currentMobileBilling = transfer.mobileBilling || { status: 'unavailable', records: [] };
    expiryTimer = window.setTimeout(expireCurrentResult, Math.max(0, transfer.createdAt + RESULT_LIFETIME_MS - Date.now()));
    renderSubscription();
}

function expireCurrentResult() {
    clearSensitiveData();
    renderUnavailable();
}

function renderUnavailable() {
    document.getElementById('result-container').innerHTML = `
        <div class="query-error result-unavailable">
            <span>!</span>
            <strong>查询数据已清除</strong>
            <p>为保护你的会话数据，结果页刷新或重新打开后不会保留上一次结果。</p>
            <button type="button" class="button button--solid" onclick="returnToQuery()">返回重新查询</button>
        </div>`;
}

function renewalPresentation(subscription) {
    if (!['active', 'paused'].includes(subscription.state)) {
        return { label: '不适用', alertClass: 'expired', detail: '当前没有需要续费的生效订阅' };
    }
    if (subscription.payChannelType === 3) {
        return { label: '由 Apple 管理', alertClass: 'unknown', detail: '续费和取消操作由 Apple App Store 管理' };
    }
    if (subscription.payChannelType === 2) {
        return { label: '由 Google Play 管理', alertClass: 'unknown', detail: '续费和取消操作由 Google Play 管理' };
    }
    if (subscription.autoRenewKnown === true && typeof subscription.autoRenew === 'boolean') {
        return subscription.autoRenew
            ? { label: '已开启', alertClass: 'renewing', detail: subscription.state === 'paused' ? '自动续费已开启，会员仍处于暂停状态' : '到期后将自动续费' }
            : { label: '已关闭', alertClass: 'stopping', detail: subscription.state === 'paused' ? '自动续费已关闭，会员仍处于暂停状态' : '自动续费已关闭，到期后将停止服务' };
    }
    return { label: '需要确认', alertClass: 'unknown', detail: '暂时无法确认是否会自动续费，可以进入官方账单页面核对' };
}

function canCancelRenewal(subscription) {
    return ['active', 'paused'].includes(subscription?.state)
        && subscription.payChannelType === 1
        && !(subscription.autoRenewKnown === true && subscription.autoRenew === false);
}

function canRestoreRenewal(subscription) {
    return subscription?.state === 'active'
        && subscription.payChannelType === 1
        && subscription.autoRenewKnown === true
        && subscription.autoRenew === false
        && Number.isFinite(Date.parse(subscription.expireTime))
        && Date.parse(subscription.expireTime) > Date.now();
}

function paymentChannelArt(channel) {
    // Decorative, local vector materials only. No real card details or external assets.
    const artwork = {
        1: { name: 'card', shape: `
            <defs>
                <linearGradient id="payment-card-face" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d7e7df"/><stop offset=".22" stop-color="#b9bce0"/><stop offset=".43" stop-color="#dabacb"/><stop offset=".66" stop-color="#94bacb"/><stop offset=".86" stop-color="#b6dace"/><stop offset="1" stop-color="#d8cfb3"/></linearGradient>
                <linearGradient id="payment-card-edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf0"/><stop offset=".4" stop-color="#f4eaff" stop-opacity=".65"/><stop offset=".78" stop-color="#b0e0e1" stop-opacity=".5"/><stop offset="1" stop-color="#fff2cf"/></linearGradient>
                <linearGradient id="payment-card-sheen" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="#fff" stop-opacity=".45"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".53" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
                <linearGradient id="payment-card-chip" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ecdfbb"/><stop offset=".47" stop-color="#b2a079"/><stop offset="1" stop-color="#eadfc6"/></linearGradient>
                <pattern id="payment-card-brush" width="4" height="3" patternUnits="userSpaceOnUse"><path d="M0 .5H4" stroke="#fff" stroke-opacity=".045" stroke-width=".5"/></pattern>
                <clipPath id="payment-card-crop"><rect x="24" y="28" width="312" height="190" rx="20"/></clipPath>
            </defs>
            <g transform="rotate(-7 180 120)">
                <rect x="25" y="33" width="312" height="190" rx="20" fill="#07151e" fill-opacity=".6"/>
                <rect x="24" y="28" width="312" height="190" rx="20" fill="url(#payment-card-face)" stroke="url(#payment-card-edge)" stroke-width="1.3"/>
                <g clip-path="url(#payment-card-crop)"><path d="M24 28H336V218H24Z" fill="url(#payment-card-brush)"/><path d="M24 28H336V218H24Z" fill="url(#payment-card-sheen)"/></g>
                <path d="M46 29H312" stroke="#fff5d8" stroke-opacity=".35" stroke-width=".7"/>
                <text x="49" y="60" fill="#273c54" font-size="10" font-weight="500" letter-spacing="2.8">CARD / WEB</text>
                <rect x="50" y="88" width="44" height="33" rx="7" fill="url(#payment-card-chip)" stroke="#eadcbd" stroke-opacity=".6" stroke-width=".6"/>
                <path d="M65 88V97L60 102V108L65 113V121M79 88V97L84 102V108L79 113V121M50 99H62M50 110H62M82 99H94M82 110H94M65 97H79M65 113H79" fill="none" stroke="#6c6049" stroke-width=".8"/>
                <path d="M110 93q10 11 0 22m5-27q15 16 0 32m5-37q20 21 0 42" fill="none" stroke="#304963" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M53 156H94m14 0h41m14 0h41" stroke="#33475f" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 10" opacity=".65"/>
                <text x="50" y="192" fill="#344760" font-size="8" letter-spacing="2.1">PAYMENT CHANNEL</text>
                <path d="M282 171h26m-26 5h19m-19 5h26" stroke="#304660" stroke-width="1" stroke-opacity=".65"/>
            </g>` },
        2: { name: 'google', shape: `
            <defs>
                <linearGradient id="payment-google-blue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#94c0ff"/><stop offset="1" stop-color="#4d80d5"/></linearGradient>
                <linearGradient id="payment-google-green" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#90ccb1"/><stop offset="1" stop-color="#509777"/></linearGradient>
                <linearGradient id="payment-google-yellow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f3d88c"/><stop offset="1" stop-color="#d0a550"/></linearGradient>
                <linearGradient id="payment-google-red" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0b7a7"/><stop offset="1" stop-color="#ce7a72"/></linearGradient>
            </defs>
            <g transform="translate(98 22) scale(6.8)">
                <path d="M22.56 12.25c0-.73-.06-1.42-.19-2.09H12v3.96h5.92c-.26 1.28-1.04 2.36-2.21 3.09v2.58h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="url(#payment-google-blue)"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.87 0-5.31-1.94-6.18-4.55H2.16v2.84C3.97 20.53 7.69 23 12 23z" fill="url(#payment-google-green)"/>
                <path d="M5.82 14.08c-.22-.66-.35-1.36-.35-2.08s.13-1.42.35-2.08V7.08H2.16C1.42 8.56 1 10.22 1 12s.42 3.44 1.16 4.92l2.85-2.22.81-.62z" fill="url(#payment-google-yellow)"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.69 1 3.97 3.47 2.16 7.08l3.66 2.84C6.69 7.32 9.13 5.38 12 5.38z" fill="url(#payment-google-red)"/>
            </g>
            <text x="180" y="219" text-anchor="middle" fill="#f0f2ff" fill-opacity=".8" font-size="9" letter-spacing="3.5">GOOGLE PLAY</text>` },
        3: { name: 'apple', shape: `
            <defs>
                <linearGradient id="payment-apple-silver" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fffef8"/><stop offset="1" stop-color="#d2dfef"/></linearGradient>
            </defs>
            <g transform="translate(117 -69) scale(9)">
                <!-- Exact Apple globalnav path, original viewBox 0 0 14 44; uniform transform only. Source: https://www.apple.com/ -->
                <path d="m13.0729 17.6825a3.61 3.61 0 0 0 -1.7248 3.0365 3.5132 3.5132 0 0 0 2.1379 3.2223 8.394 8.394 0 0 1 -1.0948 2.2618c-.6816.9812-1.3943 1.9623-2.4787 1.9623s-1.3633-.63-2.613-.63c-1.2187 0-1.6525.6507-2.644.6507s-1.6834-.9089-2.4787-2.0243a9.7842 9.7842 0 0 1 -1.6628-5.2776c0-3.0984 2.014-4.7405 3.9969-4.7405 1.0535 0 1.9314.6919 2.5924.6919.63 0 1.6112-.7333 2.8092-.7333a3.7579 3.7579 0 0 1 3.1604 1.5802zm-3.7284-2.8918a3.5615 3.5615 0 0 0 .8469-2.22 1.5353 1.5353 0 0 0 -.031-.32 3.5686 3.5686 0 0 0 -2.3445 1.2084 3.4629 3.4629 0 0 0 -.8779 2.1585 1.419 1.419 0 0 0 .031.2892 1.19 1.19 0 0 0 .2169.0207 3.0935 3.0935 0 0 0 2.1586-1.1368z" fill="url(#payment-apple-silver)"/>
            </g>
            <text x="180" y="219" text-anchor="middle" fill="#f0f2ff" fill-opacity=".8" font-size="9" letter-spacing="3.5">APP STORE</text>` }
    };
    const entry = typeof channel === 'number' ? artwork[channel] : null;
    if (!entry) return '';
    return `<div class="summary-payment-art channel-${entry.name}" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" focusable="false" aria-hidden="true" fill="none" font-family="Arial, sans-serif">${entry.shape}</svg></div>`;
}

function renderSubscription() {
    const subscription = currentSubscription;
    if (!subscription) return renderUnavailable();
    const diagnostics = currentAccountDiagnostics || {};
    const profile = diagnostics.profile || {};
    const security = diagnostics.security || {};
    const session = diagnostics.session || {};
    const usage = diagnostics.codexUsage || { status: 'not_returned' };
    const models = diagnostics.models || { status: 'not_returned', available: [] };
    const webFeatures = Array.isArray(diagnostics.webFeatures) ? diagnostics.webFeatures : [];
    const blockedFeatures = Array.isArray(diagnostics.blockedFeatures) ? diagnostics.blockedFeatures : [];
    const channelNames = { 0: '未知', 1: '卡付 / 网页', 2: 'Google Play', 3: 'Apple App Store' };
    const channelLabel = typeof subscription.payChannelType === 'number' ? channelNames[subscription.payChannelType] || '未知' : '未知';
    const renewal = renewalPresentation(subscription);
    const days = remainingDays(subscription.expireTime);
    const mobile = [2, 3].includes(subscription.payChannelType);
    const mobileRecords = Array.isArray(currentMobileBilling?.records) ? currentMobileBilling.records : [];
    const mobileStatus = mobileStatusPresentation(currentMobileBilling);
    const currencyText = billingCurrencyText(subscription);
    const active = subscription.state === 'active';
    const paused = subscription.state === 'paused';
    const previousPlan = planName(subscription.accountType);
    const knownPausedPlan = paused && ['plus', 'prolite', 'pro5x', 'pro', 'pro20x', 'pro500', 'go', 'team', 'business', 'enterprise'].includes(subscription.accountType);
    const currentPlan = active ? previousPlan : paused ? knownPausedPlan ? previousPlan : '会员暂停' : 'Free';
    const currentPlanTheme = paused ? 'paused' : planTheme(active ? subscription.accountType : 'free');
    const displayName = profile.displayName || 'ChatGPT 用户';
    const displayEmail = String(profile.email || subscription.email || '').trim();
    const displayPhone = String(profile.phone || '').trim();
    const securityPresentation = accountSecurityPresentation(security);
    const cancelAction = !active && !paused
            ? '<button class="action-btn cancel" disabled>当前无需取消续费</button>'
        : mobile
            ? ''
        : subscription.payChannelType !== 1
            ? '<button type="button" class="action-btn cancel" disabled>支付渠道需确认</button>'
            : subscription.autoRenewKnown === true && subscription.autoRenew === false
                ? canRestoreRenewal(subscription)
                    ? '<button type="button" data-result-action="confirm-renew" class="action-btn billing">恢复自动续费</button>'
                    : '<button class="action-btn cancel" disabled>自动续费已关闭</button>'
                : '<button type="button" data-result-action="confirm-cancel" class="action-btn cancel">取消自动续费</button>';
    const validity = paused
        ? '<div class="validity-alert paused"><strong>会员暂停</strong><span>当前仅可使用免费功能，请在官方账单页核对支付状态。</span></div>'
        : active
        ? `<div class="validity-alert ${renewal.alertClass}">
            <strong>${days === null ? '订阅当前有效' : `订阅有效期剩余 ${days} 天`}</strong>
            <span>${esc(renewal.detail)}</span>
        </div>`
        : `<div class="validity-alert expired"><strong>${subscription.state === 'expired' ? '订阅已到期' : '当前没有生效订阅'}</strong></div>`;
    const summaryTitle = paused
        ? `${knownPausedPlan ? `${currentPlan} · ` : ''}会员暂停`
        : active
        ? `${currentPlan} 当前有效`
        : subscription.state === 'expired'
            ? `${previousPlan} 已到期`
            : '当前没有生效订阅';
    const summaryText = paused
        ? '会员暂停，当前仅可使用免费功能；请在官方账单页核对支付状态'
        : active
        ? `有效至 ${formatDateTime(subscription.expireTime)}。${renewal.detail}。`
        : previousPlan !== 'Free'
            ? `原 ${previousPlan} 订阅已经结束，当前账号按 Free 使用。`
            : '当前账号按 Free 使用，没有需要取消的自动续费。';
    const billingButtonLabel = mobile ? '管理移动订阅' : paused ? '查看官方账单' : '查看历史账单';
    const quotaContent = paused
        ? `<div class="expired-quota-message paused-quota-message">
            <span aria-hidden="true">Ⅱ</span>
            <div><strong>会员暂停，当前仅可使用免费功能</strong><p>暂停期间不展示会员额度；请在官方账单页核对支付状态。</p></div>
        </div>`
        : subscription.state === 'expired'
        ? `<div class="expired-quota-message">
            <span aria-hidden="true">—</span>
            <div>
                <strong>会员额度已随订阅结束</strong>
                <p>接口可能仍返回上一个使用周期的额度数字，但这些数字不代表当前仍可使用，因此不再展示。</p>
            </div>
        </div>`
        : `<div class="quota-report-grid">
            <article class="codex-balance">
                <div class="plain-panel-heading"><h3>Codex 使用额度</h3></div>
                ${renderUsage(usage)}
            </article>
            <article class="web-balance">
                <div class="plain-panel-heading"><h3>ChatGPT 功能次数</h3><small>${webFeatures.length ? `已查到 ${webFeatures.length} 项` : ''}</small></div>
                ${renderFeatureLimits(webFeatures, blockedFeatures)}
            </article>
        </div>`;
    const mobileSection = mobileRecords.length || mobile
        ? `<section class="report-section mobile-report" aria-labelledby="mobile-title">
            ${reportSectionHeading('03', '移动端账单', '使用 App Store 或 Google Play 订阅时，在这里查看和处理。', 'mobile-title')}
            ${mobileRecords.length
                ? `<div class="mobile-list">${mobileRecords.map(renderMobileRecord).join('')}</div>`
                : `<div class="mobile-empty"><strong>${esc(mobileStatus.emptyTitle)}</strong><p>${esc(mobileStatus.emptyDetail)}</p></div>`}
        </section>`
        : '';

    document.getElementById('result-container').innerHTML = `
        <div class="public-report">
            <section class="customer-summary plan-${currentPlanTheme}" aria-labelledby="summary-title">
                ${paymentChannelArt(subscription.payChannelType)}
                <div class="customer-summary-copy">
                    <p class="summary-account">${esc(displayEmail || displayName)}</p>
                    <h2 id="summary-title">${esc(summaryTitle)}</h2>
                    <p class="summary-sentence">${esc(summaryText)}</p>
                    ${displayPhone ? `<p class="summary-phone">绑定手机号：${esc(displayPhone)}</p>` : ''}
                    <div class="summary-actions">
                        <button type="button" data-result-action="billing-link" class="action-btn billing">${esc(billingButtonLabel)}</button>
                        ${cancelAction}
                    </div>
                </div>
                <dl class="summary-facts">
                    <div><dt>${paused ? knownPausedPlan ? '原会员套餐' : '会员状态' : '当前套餐'}</dt><dd>${esc(currentPlan)}</dd></div>
                    <div><dt>${paused ? '原有效期' : '到期时间'}</dt><dd>${esc(formatDateTime(subscription.expireTime))}</dd></div>
                    <div><dt>自动续费</dt><dd>${esc(renewal.label)}</dd></div>
                    <div><dt>支付渠道</dt><dd>${esc(channelLabel)}</dd></div>
                </dl>
            </section>

            <section class="report-section quota-report" aria-labelledby="quota-title">
                ${reportSectionHeading('01', '剩余额度', paused ? '暂停期间不展示会员额度，以官方当前权益为准。' : '这里显示本次能够确认的剩余比例和功能次数。', 'quota-title')}
                ${quotaContent}
            </section>

            <section class="report-section billing-report" aria-labelledby="details-title">
                ${reportSectionHeading('02', '账单详情', '需要核对订阅时间、续费方式或结算地区时，可以在这里查看。', 'details-title')}
                <dl class="receipt-grid">
                    <div><dt>订阅开始</dt><dd>${esc(formatDateTime(subscription.startTime))}</dd></div>
                    <div><dt>到期时间</dt><dd>${esc(formatDateTime(subscription.expireTime))}</dd></div>
                    ${paused && Number.isFinite(Date.parse(subscription.gracePeriodEndTime)) ? `<div><dt>宽限截止（记录）</dt><dd>${esc(formatDateTime(subscription.gracePeriodEndTime))}</dd></div>` : ''}
                    <div><dt>自动续费</dt><dd>${esc(renewal.label)}</dd></div>
                    <div><dt>付费周期</dt><dd>${subscription.paymentCycle === 'monthly' ? '按月' : subscription.paymentCycle === 'yearly' ? '按年' : '—'}</dd></div>
                    <div><dt>支付渠道</dt><dd>${esc(channelLabel)}</dd></div>
                    <div><dt>账单币种</dt><dd>${esc(currencyText)}</dd></div>
                    <div><dt>结算地区</dt><dd>${esc(subscription.billingRegion || '—')}</dd></div>
                    <div><dt>账单状态</dt><dd class="${subscription.isOverdue ? 'danger-text' : paused ? '' : 'success-text'}">${subscription.isOverdue ? '欠费 / 扣款失败' : paused ? '需核对支付状态' : '正常'}</dd></div>
                </dl>
                ${validity}
            </section>

            ${renderUpgradePrice(subscription.upgradePrice, subscription)}

            ${mobileSection}

            <details class="customer-disclosure">
                <summary><span>查看更多账号信息</span><small>登录保护和可用模型</small></summary>
                <div class="protection-model-grid">
                    <article class="plain-panel">${renderProtection(security, session, securityPresentation)}</article>
                    <article class="plain-panel">${renderModels(models)}</article>
                </div>
            </details>

            <details class="query-notes">
                <summary>查询说明与隐私</summary>
                <div>
                    <p>会话数据只在这台电脑的内存中短暂使用，刷新、返回、关闭页面或超过 15 分钟后自动清除。</p>
                    <p>页面只展示本次能够确认的信息；暂时查不到的项目不会根据套餐名称猜测。</p>
                    <p>Apple App Store 和 Google Play 的具体扣款、退款与发票由原支付平台管理。</p>
                </div>
            </details>
        </div>`;
}

function reportSectionHeading(number, title, detail, id) {
    return `<header class="report-section-heading"><span>${esc(number)}</span><div><h2 id="${esc(id)}">${esc(title)}</h2><p>${esc(detail)}</p></div></header>`;
}

function renderUsage(usage) {
    if (usage?.status !== 'available') {
        return `<div class="diagnostic-empty compact"><strong>暂时没有查到 Codex 额度</strong><p>你仍然可以正常查看订阅和账单。</p></div>`;
    }
    const hasPrimary = usage.usedPercent !== null && usage.usedPercent !== undefined;
    const usedPercent = hasPrimary ? Math.max(0, Math.min(100, Number(usage.usedPercent) || 0)) : null;
    const remainingPercent = hasPrimary ? Math.max(0, 100 - usedPercent) : null;
    const primary = hasPrimary
        ? `<div class="usage-value"><strong>${esc(remainingPercent)}%</strong><span>本周期还可使用</span></div>
            <div class="usage-track" role="progressbar" aria-label="Work / Codex 剩余比例" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(remainingPercent)}"><i style="width:${esc(remainingPercent)}%"></i></div>
            <div class="usage-reset"><span>下一次恢复时间</span><strong>${esc(formatDateTime(usage.resetAt))}</strong></div>`
        : '<div class="usage-missing"><strong>暂时没有查到剩余比例</strong><span>其他能够确认的额度仍会继续展示</span></div>';
    const secondary = usage.secondaryUsedPercent === null || usage.secondaryUsedPercent === undefined
        ? ''
        : `<div class="secondary-window"><span>另一个使用周期</span><strong>还可用 ${esc(Math.max(0, 100 - Number(usage.secondaryUsedPercent || 0)))}%</strong><small>${esc(formatDateTime(usage.secondaryResetAt))} 恢复</small></div>`;
    const resetCredits = usage.resetCreditsAvailable === null || usage.resetCreditsAvailable === undefined
        ? ''
        : `<div class="usage-credit">
            <span>可用重置次数</span><strong>${esc(usage.resetCreditsAvailable)} 次</strong>
            ${renderResetCreditDetail(usage.resetCredits)}
        </div>`;
    const additionalLimits = Array.isArray(usage.additionalLimits) && usage.additionalLimits.length
        ? `<div class="usage-extra-list">${usage.additionalLimits.map(limit => `
            <div>
                <span>${esc(humanizeUsageLimitLabel(limit.label))}</span>
                <strong>还可用 ${esc(Math.max(0, 100 - Number(limit.usedPercent || 0)))}%</strong>
                <small>${esc(formatDateTime(limit.resetAt))} 恢复</small>
            </div>`).join('')}</div>`
        : '';
    return `
        ${primary}
        ${secondary}
        ${resetCredits}
        ${additionalLimits}`;
}

function renderResetCreditDetail(credits) {
    const availableCredits = Array.isArray(credits)
        ? credits.filter(credit => !credit.status || !['consumed', 'expired', 'used'].includes(String(credit.status).toLowerCase()))
        : [];
    if (!availableCredits.length) return '<small>可用次数已经确认</small>';
    const first = availableCredits[0];
    const detail = [first.title || first.description, first.expiresAt ? `${formatDateTime(first.expiresAt)} 到期` : ''].filter(Boolean).join(' · ');
    return `<small>${esc(detail || '已返回重置额度')}</small>`;
}

function renderFeatureLimits(features, blockedFeatures = []) {
    const list = features.length
        ? `<div class="feature-limit-list">${features.map(feature => {
        const value = feature.remaining !== null && feature.remaining !== undefined
            ? `还可使用 ${feature.remaining} 次`
            : feature.limit !== null && feature.limit !== undefined
                ? `本期共 ${feature.limit} 次`
                : feature.used !== null && feature.used !== undefined
                    ? '剩余次数暂不明确'
                    : '已确认可用';
        const resetText = feature.resetAt ? `${formatDateTime(feature.resetAt)} 恢复` : '恢复时间暂不明确';
        return `<div><span><strong>${esc(feature.label)}</strong><small>${esc(resetText)}</small>${feature.detail ? `<small class="feature-detail">${esc(feature.detail)}</small>` : ''}</span><b>${esc(value)}</b></div>`;
    }).join('')}</div>`
        : `<div class="diagnostic-empty compact"><strong>暂时没有查到功能次数</strong><p>这不会影响当前订阅状态。</p></div>`;
    const blocked = blockedFeatures.length
        ? `<p class="blocked-feature-note">暂不可用的功能：${esc(blockedFeatures.map(humanizeUsageLimitLabel).join('、'))}</p>`
        : '';
    const imageNote = features.some(feature => feature.key === 'image_gen')
        ? '<p class="feature-scope-note">图片生成共用一个次数余额，不区分 2K 和 4K。</p>'
        : '';
    return `${list}${blocked}${imageNote}`;
}

function renderModels(models) {
    const available = Array.isArray(models?.available) ? models.available : [];
    if (!available.length) {
        return `<div class="diagnostic-empty compact"><strong>暂时没有查到模型列表</strong><p>实际可用模型以 ChatGPT 页面为准。</p></div>`;
    }
    const defaultEntry = available.find(model => model.id === models.defaultModel || (Array.isArray(model.ids) && model.ids.includes(models.defaultModel)));
    const defaultLabel = defaultEntry?.label || models.defaultModel || '暂未显示';
    return `
        <div class="default-model-row"><span>默认使用</span><strong>${esc(defaultLabel)}</strong></div>
        <div class="model-label">可用模型（${available.length}）</div>
        <div class="model-chips">${available.map(model => {
            const identifiers = Array.isArray(model.ids) && model.ids.length ? model.ids.join(' / ') : model.id;
            return `<span title="${esc(identifiers)}">${esc(model.label)}</span>`;
        }).join('')}</div>`;
}

function renderProtection(security, session, securityPresentation) {
    const loginProtection = security?.mfaEnabled === true
        ? '已开启'
        : security?.mfaEnabled === false
            ? '未开启'
            : '没有查到';
    const codeApp = formatProtectionCount(security?.totpCount, security?.totpConfirmed);
    const deviceKeys = formatProtectionCount(security?.passkeyCount, security?.passkeyConfirmed);
    return `<div class="protection-list">
        <div>
            <span><strong>登录时再确认一次</strong><small>密码之外，再用验证码或其他方式确认本人</small></span>
            <b class="${esc(securityPresentation.valueClass)}">${esc(loginProtection)}</b>
        </div>
        <div>
            <span><strong>验证码软件</strong><small>例如 Google Authenticator、Microsoft Authenticator</small></span>
            <b>${esc(codeApp)}</b>
        </div>
        <div>
            <span><strong>指纹、面容或设备解锁登录</strong><small>用设备本身的解锁方式代替输入密码</small></span>
            <b>${esc(deviceKeys)}</b>
        </div>
        <div>
            <span><strong>查询结果有效期</strong><small>超过这个时间后，需要重新查询</small></span>
            <b>${esc(formatDateTime(session?.expiresAt))}</b>
        </div>
    </div>`;
}

function accountSecurityPresentation(security) {
    if (security?.mfaEnabled === true) {
        return { className: 'secure', icon: '✓', title: '登录保护已开启', detail: '登录时需要额外确认一次本人身份。', value: '登录保护已开启', valueClass: 'success-text' };
    }
    if (security?.mfaEnabled === false) {
        return { className: 'warning', icon: '!', title: '建议开启登录保护', detail: '当前账号登录时没有第二道验证。', value: '登录保护未开启', valueClass: 'danger-text' };
    }
    return { className: 'neutral', icon: 'i', title: '登录保护状态暂不明确', detail: '这次没有查到相关信息，不代表账号一定没有设置。', value: '状态暂不明确', valueClass: '' };
}

function accountInitial(name, email) {
    const value = String(name || email || 'C').trim();
    return [...value][0]?.toUpperCase() || 'C';
}

function formatProtectionCount(value, confirmed = false) {
    if (value !== null && value !== undefined) return Number(value) > 0 ? `已设置 ${value} 个` : '没有设置';
    return confirmed ? '已设置，数量未知' : '没有查到';
}

function humanizeUsageLimitLabel(value) {
    return String(value || '其他用量').trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function mobileStatusPresentation(billing) {
    const status = billing?.status || 'unavailable';
    if (status === 'complete') return { className: 'ok', label: '移动账单已核对', emptyTitle: '没有找到移动端账单', emptyDetail: '该账号目前没有返回 Apple 或 Google Play 订阅记录。' };
    if (status === 'partial') return { className: 'partial', label: '移动账单部分核对', emptyTitle: '暂未找到移动端账单', emptyDetail: '部分支付渠道暂时没有返回记录。' };
    if (status === 'not_configured') return { className: '', label: '请在原支付平台查看', emptyTitle: '请前往原支付平台查看账单', emptyDetail: '移动端订阅的具体扣款、退款和发票由 App Store 或 Google Play 管理。' };
    return { className: 'partial', label: '移动账单暂不可用', emptyTitle: '移动端账单暂时无法核对', emptyDetail: billing?.message || '请稍后重新查询。' };
}

function renderMobileRecord(record) {
    const isApple = record.payChannelType === 3;
    const storeName = isApple ? 'Apple App Store' : record.payChannelType === 2 ? 'Google Play' : '移动端';
    const renewText = record.autoRenewKnown === true ? (record.autoRenew ? '将自动续费' : '已停止续费') : '续费状态暂不明确';
    const billingText = record.refundedTime ? '已退款' : record.isOverdue ? '扣款异常' : record.state === 'active' ? '账单有效' : '已结束';
    const amount = billingAmountText(record);
    return `
        <article class="mobile-record">
            <div class="mobile-record-main">
                <span class="store-mark ${isApple ? 'apple' : 'google'}">${isApple ? 'A' : 'G'}</span>
                <div>
                    <h3>${esc(planName(record.accountType))} · ${esc(storeName)}</h3>
                    <p class="mobile-price">${esc(amount === '—' ? billingText : amount)}</p>
                </div>
            </div>
            <div class="mobile-record-meta">
                <div><small>本期开始</small><strong>${esc(formatDateTime(record.startTime))}</strong></div>
                <div><small>到期时间</small><strong>${esc(formatDateTime(record.expireTime))}</strong></div>
                <div><small>续费状态</small><strong>${esc(renewText)}</strong></div>
                <div><small>结算地区</small><strong>${esc(record.billingRegion || record.currency || '—')}</strong></div>
            </div>
        </article>`;
}

function billingAmountText(subscription) {
    if (subscription.billingAmount !== null && subscription.billingAmount !== undefined && subscription.billingAmount !== '') {
        return subscription.currency
            ? `${subscription.billingAmount} ${subscription.currency}`
            : String(subscription.billingAmount);
    }
    return subscription.formattedPrice || '—';
}

function renderUpgradePrice(price, subscription) {
    const targetPlan = subscription?.accountType === 'plus' ? 'pro5x'
        : ['pro5x', 'prolite'].includes(subscription?.accountType) ? 'pro20x'
        : ['pro20x', 'pro'].includes(subscription?.accountType) ? 'pro500' : null;
    if (subscription?.state !== 'active' || !targetPlan || subscription?.isOverdue === true
        || subscription?.payChannelType !== 1 || price?.status === 'not_applicable') return '';
    const sourceLabel = planName(subscription.accountType);
    const targetLabel = planName(targetPlan);
    const heading = `<div class="upgrade-price-heading"><h2 id="upgrade-price-title">${sourceLabel} 剩余权益抵扣</h2><small>升级 ${targetLabel} 参考</small></div>`;
    const isAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (price?.status !== 'available' || price.targetPlan !== targetPlan || !isAmount(price.amount) || !isAmount(price.creditAmount)
        || !/^[A-Z]{3}$/.test(price.currency || '') || !Number.isFinite(Date.parse(price.quotedAt))) {
        return `<section class="upgrade-price-box" aria-labelledby="upgrade-price-title">
            ${heading}<p>剩余权益抵扣金额暂未查到，请重新查询。</p>
            <p>本页仅展示预览，不会实际升级或扣款。</p>
        </section>`;
    }
    const money = value => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value === 0 ? 0 : value);
    const isCny = price.currency === 'CNY';
    const estimate = price.cnyEstimate;
    const rateDate = typeof estimate?.rateDate === 'string' ? estimate.rateDate : '';
    const rateTime = /^\d{4}-\d{2}-\d{2}$/.test(rateDate) ? Date.parse(`${rateDate}T00:00:00.000Z`) : NaN;
    const validRateDate = Number.isFinite(rateTime) && new Date(rateTime).toISOString().slice(0, 10) === rateDate;
    const hasEstimate = estimate?.status === 'available'
        && typeof estimate.rate === 'number' && Number.isFinite(estimate.rate) && estimate.rate > 0
        && validRateDate
        && typeof estimate.source === 'string' && estimate.source.trim().length > 0;
    // Display only the remaining-entitlement credit, never the upgrade total.
    const creditCny = isCny ? price.creditAmount : hasEstimate ? price.creditAmount * estimate.rate : null;
    const credit = isAmount(creditCny)
        ? `<strong>${isCny ? '' : '约'}¥${esc(money(creditCny))} 人民币</strong>`
        : '<span class="upgrade-fx-unavailable">人民币换算暂不可用</span>';
    const rate = hasEstimate && !isCny
        ? `<p class="upgrade-fx-meta">工作日参考汇率日期：${esc(estimate.rateDate)} · 来源：${esc(estimate.source)}。</p>` : '';
    return `<section class="upgrade-price-box" aria-labelledby="upgrade-price-title">
        ${heading}
        <div class="upgrade-price-credit"><span>可抵扣金额</span>${credit}</div>
        <p>官网当次预览 · 报价时间：${esc(formatDateTime(price.quotedAt))}。</p>
        ${rate}
        <p class="upgrade-price-disclaimer">此金额仅供升级时抵扣参考，以官方结算为准。本页仅展示预览，不会实际升级或扣款。</p>
    </section>`;
}

function billingCurrencyText(subscription) {
    if (!subscription.currency) return '—';
    return subscription.currencyName
        ? `${subscription.currency} · ${subscription.currencyName}`
        : subscription.currency;
}

function applyServerResult(result) {
    if (result.subscription) {
        currentSubscription = result.subscription;
    }
}

function confirmCancelRenewal() {
    if (busy) return;
    if (!currentSubscription || !currentActionToken) {
        showModal('本次查询已失效', '<div class="query-error"><span>!</span><strong>请返回首页重新查询</strong><p>查询凭证只在结果页保留 15 分钟。</p></div><button type="button" onclick="returnToQuery()" class="btn btn-primary">重新查询</button>');
        return;
    }
    if (!canCancelRenewal(currentSubscription)) return;
    const paused = currentSubscription.state === 'paused';
    const unknownRenewal = currentSubscription.autoRenewKnown !== true || typeof currentSubscription.autoRenew !== 'boolean';
    showModal('关闭自动续费', `
        <div class="confirm-action danger">
            <strong>确定关闭该订阅的自动续费？</strong>
            ${unknownRenewal ? '<p>当前自动续费状态需要确认，提交后以官方核验结果为准。</p>' : ''}
            ${paused
                ? '<p>当前会员处于暂停状态，仅可使用免费功能。此操作仅申请关闭自动续费，不会恢复会员权益，也不处理补缴或清除欠费；请在官方账单页核对支付状态。</p>'
                : `<p>关闭后权益仍保留到 ${esc(formatDateTime(currentSubscription.expireTime))}，届时自动停止。</p>`}
        </div>
        <div class="modal-action-row">
            <button type="button" onclick="closeModal()" class="btn btn-secondary">返回</button>
            <button type="button" data-result-action="cancel-renewal" class="btn btn-danger">确认关闭</button>
        </div>`);
}

async function cancelRenewal() {
    if (busy || !currentActionToken || !canCancelRenewal(currentSubscription)) return;
    const actionToken = currentActionToken;
    const wasPaused = currentSubscription.state === 'paused';
    setBusy(true);
    showModal('正在关闭自动续费', '<div class="query-progress"><span class="query-spinner"></span><strong>正在联系 ChatGPT 处理</strong></div>');
    try {
        const response = await fetch(`${WORKER_ORIGIN}/api/subscription/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionToken }),
            cache: 'no-store'
        });
        const result = await response.json().catch(() => ({}));
        if (currentActionToken !== actionToken) {
            closeModal(true);
            return;
        }
        if (!response.ok || !result.ok) throw new Error(result.message || '关闭自动续费失败');
        if (result.requiresPortal && result.url) {
            applyServerResult(result);
            renderSubscription();
            showModal('请在官方页面完成关闭', `
                <div class="link-result">
                    <strong>ChatGPT 暂未直接确认关闭</strong>
                    <p>${wasPaused || currentSubscription.state === 'paused'
                        ? '请在官方账单页面核对并完成关闭自动续费。取消续费不代表会员权益恢复，也不处理补缴或清除欠费。'
                        : '已为你准备好当前账号的官方账单页面。打开后确认关闭自动续费即可，权益仍会保留到本期结束。'}</p>
                    <a class="official-link" href="${esc(result.url)}" target="_self" rel="noreferrer">打开官方账单页面</a>
                </div>
                <button type="button" onclick="closeModal()" class="btn btn-secondary">暂不打开</button>`);
            return;
        }
        if (result.verified !== true || !result.subscription
            || result.subscription.payChannelType !== 1
            || result.subscription.autoRenewKnown !== true || result.subscription.autoRenew !== false) {
            throw new Error('尚未确认自动续费已关闭，请重新查询或在官方账单页核对');
        }
        applyServerResult(result);
        closeModal(true);
        renderSubscription();
        showToast(currentSubscription.state === 'paused' ? '自动续费已关闭；会员仍处于暂停状态' : '自动续费已关闭');
    } catch (error) {
        if (currentActionToken !== actionToken) {
            closeModal(true);
            return;
        }
        showModal('操作未完成', `<div class="query-error"><span>!</span><strong>${esc(error instanceof Error ? error.message : '操作失败')}</strong><p>ChatGPT 未确认本次操作，请稍后重试。</p></div><button onclick="closeModal()" class="btn btn-primary">返回</button>`);
    } finally {
        setBusy(false);
    }
}

function confirmRestoreRenewal() {
    if (busy) return;
    if (!currentSubscription || !currentActionToken) {
        showModal('本次查询已失效', '<div class="query-error"><span>!</span><strong>请返回首页重新查询</strong><p>查询凭证只在结果页保留 15 分钟。</p></div><button type="button" onclick="returnToQuery()" class="btn btn-primary">重新查询</button>');
        return;
    }
    if (!canRestoreRenewal(currentSubscription)) return;
    const accountEmail = currentAccountDiagnostics?.profile?.email || currentSubscription.email || '';
    showModal('恢复自动续费', `
        <div class="confirm-action">
            <strong>确定恢复该订阅的自动续费？</strong>
            ${accountEmail ? `<p>当前账号：${esc(accountEmail)}</p>` : ''}
            <p>当前套餐为 ${esc(planName(currentSubscription.accountType))}。恢复后将按当前套餐、已绑定的支付方式和官方账单设置自动续费并扣款。</p>
            <p>本期有效至 ${esc(formatDateTime(currentSubscription.expireTime))}。</p>
        </div>
        <div class="modal-action-row">
            <button type="button" onclick="closeModal()" class="btn btn-secondary">返回</button>
            <button type="button" data-result-action="restore-renewal" class="btn btn-primary">确认恢复自动续费</button>
        </div>`);
}

async function restoreRenewal() {
    if (busy || !currentActionToken || !canRestoreRenewal(currentSubscription)) return;
    const actionToken = currentActionToken;
    setBusy(true);
    showModal('正在恢复自动续费', '<div class="query-progress"><span class="query-spinner"></span><strong>正在联系 ChatGPT 处理并核对续费状态</strong></div>');
    try {
        const response = await fetch(`${WORKER_ORIGIN}/api/subscription/renew`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionToken }),
            cache: 'no-store'
        });
        const result = await response.json().catch(() => ({}));
        if (currentActionToken !== actionToken) {
            closeModal(true);
            return;
        }
        if (!response.ok || result.ok !== true) throw new Error(result.message || '恢复自动续费失败');
        if (result.verified !== true || result.subscription?.state !== 'active'
            || result.subscription.autoRenewKnown !== true || result.subscription.autoRenew !== true) {
            throw new Error(result.message || '尚未确认自动续费已恢复，请稍后重新查询核对');
        }
        applyServerResult(result);
        closeModal(true);
        renderSubscription();
        showToast('自动续费已恢复');
    } catch (error) {
        if (currentActionToken !== actionToken) {
            closeModal(true);
            return;
        }
        showModal('操作未完成', `<div class="query-error"><span>!</span><strong>${esc(error instanceof Error ? error.message : '恢复自动续费失败')}</strong><p>尚未确认恢复成功，请重新查询续费状态后再操作。</p></div><button type="button" onclick="closeModal()" class="btn btn-primary">返回</button>`);
    } finally {
        setBusy(false);
    }
}

async function requestBillingLink() {
    if (busy || !currentActionToken) return;
    setBusy(true);
    showModal('正在获取账单入口', '<div class="query-progress"><span class="query-spinner"></span><strong>正在创建官方账单链接</strong></div>');
    try {
        const response = await fetch(`${WORKER_ORIGIN}/api/subscription/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionToken: currentActionToken }),
            cache: 'no-store'
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok || !result.url) throw new Error(result.message || '无法获取官方账单链接');
        showModal('专属账单门户链接', `
            <div class="link-result">
                <strong>${result.externalPlatform ? '已获取原支付平台入口' : '已获取官方账单入口'}</strong>
                <p>${result.externalPlatform ? '该订阅由移动端支付平台管理。' : '链接含有临时密钥，请勿分享给他人。'}</p>
                <textarea readonly class="code-block link-block" onclick="this.select()">${esc(result.url)}</textarea>
                <div class="modal-action-row"><button onclick="copyModalCode()" class="btn btn-secondary">复制链接</button><a class="official-link" href="${esc(result.url)}" target="_blank" rel="noreferrer">打开链接</a></div>
            </div>
            <button onclick="closeModal()" class="btn btn-secondary">关闭</button>`);
    } catch (error) {
        showModal('获取账单链接失败', `<div class="query-error"><span>!</span><strong>${esc(error instanceof Error ? error.message : '获取失败')}</strong></div><button onclick="closeModal()" class="btn btn-primary">返回</button>`);
    } finally {
        setBusy(false);
    }
}

function returnToQuery() {
    clearSensitiveData();
    window.location.replace('/subscription/');
}

function clearSensitiveData() {
    if (expiryTimer) {
        window.clearTimeout(expiryTimer);
        expiryTimer = null;
    }
    try { sessionStorage.removeItem(RESULT_TRANSFER_KEY); } catch {}
    window.name = '';
    const actionToken = currentActionToken;
    currentActionToken = null;
    currentSubscription = null;
    currentAccountDiagnostics = null;
    currentMobileBilling = { status: 'unavailable', records: [] };
    if (actionToken) {
        fetch(`${WORKER_ORIGIN}/api/action/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionToken }),
            keepalive: true,
            cache: 'no-store'
        }).catch(() => {});
    }
}

function setBusy(value) {
    busy = value;
    document.querySelectorAll('.action-btn, .result-back').forEach(button => {
        if (value && !button.disabled) {
            button.dataset.busyDisabled = 'true';
            button.disabled = true;
        } else if (!value && button.dataset.busyDisabled === 'true') {
            button.disabled = false;
            delete button.dataset.busyDisabled;
        }
    });
}

function planName(value) {
    return ({ free: 'Free', plus: 'Plus', prolite: 'Pro 5X', pro5x: 'Pro 5X', pro: 'Pro 20X', pro20x: 'Pro 20X', pro500: 'Pro 500', go: 'Go', team: 'Team', business: 'Business', enterprise: 'Enterprise' })[value] || value || 'Free';
}

function planTheme(value) {
    const theme = String(value || 'free').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (theme === 'prolite' || theme === 'pro5x') return 'pro5x';
    if (theme === 'pro' || theme === 'pro20x') return 'pro20x';
    return theme === 'plus' ? 'plus' : 'free';
}

function stateName(value) {
    return ({ active: '订阅生效中', paused: '会员暂停', expired: '订阅已到期', none: '当前未订阅' })[value] || '未知';
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
}

function remainingDays(value) {
    if (!value) return null;
    const end = new Date(value).getTime();
    if (!Number.isFinite(end)) return null;
    return Math.max(0, Math.ceil((end - Date.now()) / 86400000));
}

function showModal(title, body) {
    const modal = document.getElementById('modal');
    if (!modal.classList.contains('is-visible')) lastFocusedElement = document.activeElement;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    modal.classList.add('is-visible');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => modal.querySelector('.modal-content')?.focus());
}

function closeModal(force = false) {
    if (busy && !force) return;
    const modal = document.getElementById('modal');
    modal.classList.remove('is-visible');
    modal.setAttribute('aria-hidden', 'true');
    const focusTarget = lastFocusedElement && document.contains(lastFocusedElement) && !lastFocusedElement.disabled
        ? lastFocusedElement
        : document.querySelector('.result-back');
    focusTarget?.focus();
    lastFocusedElement = null;
}

function handleModalKeydown(event) {
    const modal = document.getElementById('modal');
    if (!modal || !modal.classList.contains('is-visible')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
    if (!focusable.length) {
        event.preventDefault();
        modal.querySelector('.modal-content')?.focus();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!focusable.includes(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
    }
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} is-visible`;
    setTimeout(() => { toast.classList.remove('is-visible'); }, 3000);
}

function copyModalCode() {
    const code = document.querySelector('#modal .code-block');
    if (!code) return;
    navigator.clipboard?.writeText(code.value).then(
        () => showToast('已复制'),
        () => fallbackCopy(code.value)
    ) ?? fallbackCopy(code.value);
}

function fallbackCopy(text) {
    const element = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
    document.body.appendChild(element);
    element.select();
    document.execCommand('copy');
    element.remove();
    showToast('已复制');
}

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
