# Codex备忘

- 日期：2026-11-16
- 任务目标：把 ChatGPT 订阅查询改成 checkgpt.plus 的接口。页面可以保持镜花水月，但查询和后续操作都走同一套 API。

## 结论

- 首页跨域调用已部署的 Worker `https://claude-nx-subscription.bai1517735291.workers.dev/api/subscription/query`，请求体是 `{ session }`。成功条件是 `ok`、`subscription`，以及长度至少 24 的 `actionToken`。不再在浏览器里直连 chatgpt.com，也不依赖站点同源 `/api/*` 路由。
- 结果页用同一个 `actionToken`，向同一 Worker 地址调用 `POST /api/subscription/cancel`、`/api/subscription/renew`、`/api/subscription/link` 和 `/api/action/release`。
- 订阅字段来自 `accounts/check/v4-2023-04-27`：`will_renew`、`purchase_origin_platform`、账期、欠费和到期时间。网页是 1，Google Play 是 2，Apple 是 3。
- 取消走 `POST /backend-api/subscriptions/cancel`，恢复走 `POST /backend-api/subscriptions/resume`。官方没有确认取消时，返回 `requiresPortal` 和账单地址；不接受的外链会退回 `https://chatgpt.com/account/manage`。
- 凭证默认放在 Worker 内存，15 分钟失效。设置 `ACTION_TOKEN_SECRET` 后，凭证会加密进 `actionToken`，换一台隔离实例也能继续操作。会话不落盘、不写日志。

## 修改文件

- `subscription/src/query.js`、`subscription/src/app.js`、`subscription/src/result.js`
- `subscription/index.html`、`subscription/result.html`、`index.html`、`README.md`
- `backend/subscription-worker.mjs`、`backend/action-token.mjs`、`backend/wrangler.subscription.jsonc`
- `backend/subscription-worker.test.mjs`、`tests/subscription.test.mjs`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node scripts/stamp-assets.mjs
node --test
```

## 测试结果

全量 `node --test`：49 passed, 0 failed。

## Git

本地并已推送的提交是 `42c68a3`。GitHub Pages 会跟着 `main` 更新。Worker 还没在这次会话里重新部署。

## 遗留问题

- 生产环境若要跨 Cloudflare 隔离实例取消或恢复续费，需要执行 `wrangler secret put ACTION_TOKEN_SECRET` 后再部署 `backend/wrangler.subscription.jsonc`。
- 不要提交仓库里未跟踪的 `*.jpg` 和 `GROKBOT-UPLOAD.md`。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```
