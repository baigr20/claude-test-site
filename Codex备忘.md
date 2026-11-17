# Codex备忘

- 日期：2026-11-17
- 任务目标：确认 cookie-first Worker 上线后仍查不通，并修正拦截提示。

## 结论

- 新查询逻辑已在线上（假 token 会返回带 sessionToken / 完整会话 的新文案）。`/ql/wiki/`、首页、Gmail 仍是 200。
- 根因：Cloudflare Worker 出站 `fetch` 会带 `Cf-Worker`。本机对照：不带该头访问 `chatgpt.com/backend-api/me` 是 401 JSON；带上该头是 403 HTML 拦截页。checkgpt.plus 不在 Cloudflare 上，所以能查。
- Worker 去不掉 `Cf-Worker`。继续改请求顺序也查不通。需要一台普通服务器做查询节点。
- 顺手把无 `cf-mitigated` 的 403 HTML 识别成拦截，避免再写成 token 被拒。

## 修改文件

- `backend/subscription-worker.mjs`
- `backend/subscription-worker.test.mjs`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node --test backend/subscription-worker.test.mjs tests/subscription.test.mjs
```

## 测试结果

相关测试 14 passed。

## Git

本地提交后推送 `main`。Worker 若只为改提示，可再部署一次；查询要通仍需非 Cloudflare 节点。

## 遗留问题

- 查询功能要一台能跑 Node 的 VPS / Fly / Railway。不要重建 `ACTION_TOKEN_SECRET`。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```

- 日期：2026-11-17
- 任务目标：修订阅查询「ChatGPT 拒绝了这份仍在有效期内的 accessToken」。

## 结论

- 页面已经是 checkgpt.plus 复刻。checkgpt.plus 的 `/api/health` 不在 Cloudflare 上；本站查询走 Cloudflare Worker，ChatGPT 会看到 Worker 出口 IP。
- 旧 Worker 先对 10 个接口只带 accessToken 并行请求，401 后再补 `__Secure-next-auth.session-token`。这次改成：有 sessionToken 时先 Cookie 刷新 `/api/auth/session`，再带 Cookie 探测 `/backend-api/me`，成功后才拉其余接口；不要发送 `__Host-next-auth.session-token`。
- 仍有效的 token 被拒时，不再一律写成“已过期”。没有 sessionToken 时提示补完整会话。
- 静态页不用重新发。线上要 grokbot 重新部署 Worker 后才会生效。不要重建 `ACTION_TOKEN_SECRET`。不要用真实 Session 做联调。

## 修改文件

- `backend/subscription-worker.mjs`
- `backend/subscription-worker.test.mjs`
- `tests/subscription.test.mjs`
- `README.md`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node --test backend/subscription-worker.test.mjs tests/subscription.test.mjs
```

## 测试结果

相关测试 14 passed。全量 `node --test` 有 1 个既有失败：`tests/assets.test.mjs` 因本机 CRLF 和已提交的资源哈希不一致，未跑 `stamp-assets.mjs`，避免改脏前端。

## Git

本地提交后推送 `main`。Worker 需要另内部署：

```powershell
npx wrangler deploy --config backend/wrangler.subscription.jsonc
```

不要重建 `ACTION_TOKEN_SECRET`。

## 遗留问题

- 若部署后 ChatGPT 仍 401，多半是 Cloudflare Worker 出口被拦，checkgpt.plus 用的是普通服务器 IP。那时需要非 Cloudflare 的查询节点。
- 不要提交 `_checkgpt_plus_dump/`、未跟踪的 `*.jpg` 和 `GROKBOT-UPLOAD.md`。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```

- 日期：2026-11-17
- 任务目标：把 `/subscription/` 按 https://checkgpt.plus/ 一比一复刻，去掉工具箱顶栏和改写过的文案。

## 结论

- 查询页和结果页改用 checkgpt.plus 的 HTML/CSS（镜花水月），不再套 NX 工具箱 `site-header`、`site.css` 和主题开关。
- 查询、健康检查、取消/恢复续费、账单链接仍走 Worker `https://claude-nx-subscription.bai1517735291.workers.dev`。
- 状态徽章文案固定为「在线会员查询」，只改绿/红点和 aria-label，和源站一致。
- Worker 未改，不需要重新部署。

## 修改文件

- `subscription/index.html`、`subscription/result.html`
- `subscription/src/styles.css`、`subscription/src/app.js`、`subscription/src/result.js`
- `tests/subscription.test.mjs`、`README.md`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node scripts/stamp-assets.mjs
node --test
```

## 测试结果

全量 `node --test`：58 passed, 0 failed。本地 Playwright 对照 checkgpt.plus 首页/结果空态，桌面和手机布局一致。本机静态预览的徽章可能仍是确认中，因为 localhost 不在 Worker CORS 里；上线 `claude.nx.kg` 后会变成绿色在线。

## Git

本地并已推送的提交是 `8739cd3`。GitHub Pages 会跟着 `main` 更新。Worker 未改，不用重新部署。

## 遗留问题

- 不要提交 `_checkgpt_plus_dump/`、未跟踪的 `*.jpg` 和 `GROKBOT-UPLOAD.md`。
- 从订阅页回工具箱请打开 `https://claude.nx.kg/`。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```

- 日期：2026-11-17
- 任务目标：按 acctcheck.com 复刻谷歌账号检查，放到 claude.nx.kg 工具箱。

## 结论

- 新页面 `/gmail/`，交互对齐 https://www.acctcheck.com/zh-cn/：按行输入、批量查询、正常/异常/未注册/错误、复制和 CSV。
- 浏览器不能直连 acctcheck（无 CORS），所以走现有 Worker：`POST https://claude-nx-subscription.bai1517735291.workers.dev/api/gmail/check`。
- Worker 把账号列表转给 `https://www.acctcheck.com/api/check`，不落盘、不记日志。拒绝 `----`、`|`、`:` 这类带密码分隔符的行。单次最多 200 个。
- 静态页推到 GitHub Pages 后即可打开；查询要重新部署 Worker 后才通。

## 修改文件

- `gmail/index.html`、`gmail/src/app.js`、`gmail/src/parse.js`、`gmail/src/query.js`、`gmail/src/styles.css`
- `backend/gmail-check.mjs`、`backend/subscription-worker.mjs`
- `index.html`、`README.md`、`scripts/stamp-assets.mjs`
- `tests/gmail.test.mjs`、`tests/visual.test.mjs`
- 本机 CRLF 导致资源哈希重盖：`2fa/`、`sub-cpa/`、`subscription/`、`grok/`、`404.html`、`assets/home.js`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node scripts/stamp-assets.mjs
node --test
```

## 测试结果

全量 `node --test`：57 passed, 0 failed。本地用真实上游抽查 `alice.wonderland@gmail.com` 为正常、`thisaddressshouldnotexistxyz99999@gmail.com` 为未注册。

## Git

本地并已推送的提交是 `83b3d9e`。Worker 需要另内部署：

```powershell
npx wrangler deploy --config backend/wrangler.subscription.jsonc
```

不要重建 `ACTION_TOKEN_SECRET`。

## 遗留问题

- 未部署 Worker 前，`/gmail/` 页面能打开，点检查会失败。
- 不要提交仓库里未跟踪的 `*.jpg` 和 `GROKBOT-UPLOAD.md`。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```

- 日期：2026-11-16
- 任务目标：修正 ChatGPT 订阅查询把仍有效的 accessToken 报成“Session 无效或已过期”。

## 结论

- 错在 Worker 的请求，不在会话过期。原先同时发送 `__Secure-next-auth.session-token` 和 `__Host-next-auth.session-token`，ChatGPT 只认前者；多出的 cookie 会让接口返回 401，页面再把所有 401/403 写成会话过期。
- 现在先只带 accessToken、账号 ID 和会话里的 `oai-device-id`。这一步返回 401 或 403 时，才补上 `__Secure-next-auth.session-token` 重试一次。
- accessToken 的 `exp` 尚未到期时，不再显示“已过期”。Cloudflare 挑战页单独提示为查询节点被拦截。
- 这次改的是 Worker。静态页已经指向 `workers.dev`，需要重新部署 `backend/wrangler.subscription.jsonc` 后线上才会生效。不要重建 `ACTION_TOKEN_SECRET`。

## 修改文件

- `backend/subscription-worker.mjs`
- `backend/action-token.mjs`
- `subscription/src/query.js`
- `backend/subscription-worker.test.mjs`
- `tests/subscription.test.mjs`
- `README.md`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node --test
```

## 测试结果

本次相关测试通过，包括 accessToken 优先、cookie 重试，以及未过期 token 不再显示“已过期”。全量 `node --test` 为 49 passed、1 failed。失败的是原有的 `tests/assets.test.mjs`：本机工作副本是 CRLF，页面里已有的资源哈希对不上，这次没有改那些 HTML。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```

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
