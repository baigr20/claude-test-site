# Codex备忘

- 日期：2026-11-15
- 任务目标：弄清线上订阅查询「很多结果没显示」是页面隐藏还是接口没返回，并尽量补齐手机号、历史订单和时间，使结果更接近 checkgpt.plus。

## 结论

线上空白主要是**接口没有返回**，少量是页面以前把空值藏掉。

- 原站 checkgpt.plus 有自己的后端，用 accessToken + session cookie 调 chatgpt.com/backend-api（含 `/me`、账单发票、订阅周期）。
- GitHub Pages 静态站没有同源代理时，浏览器跨域读不到 chatgpt.com，手机号、额度、历史订单、订阅到期时间都到不了前端。
- JWT `exp` / 会话 `expires` 是 token 有效期，不能标成套餐「到期时间」。Free 账号本来也可能没有账单到期时间。
- 本机 Python 复刻能从 `/me` 拿到手机号；invoices/subscriptions 对 Free 账号仍可能失败。

## 修改文件

- `subscription/src/query.js`：先试 `POST /api/subscription/query`；失败再直连 chatgpt.com；记录每个接口来源；`expireTime` 只用账单周期。
- `subscription/src/result.js`：始终显示手机号、历史订单、会话有效期、账号创建；新增「数据来源」区块。
- `subscription/src/styles.css`、`subscription/src/app.js`、`subscription/index.html`、`subscription/result.html`
- `backend/subscription-worker.mjs`、`backend/wrangler.subscription.jsonc`、`backend/subscription-worker.test.mjs`
- `index.html`、`README.md`、`tests/subscription.test.mjs`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node scripts/stamp-assets.mjs
node --test
```

## 测试结果

全量 `node --test`：41 passed, 0 failed。

## Git

本地提交见本次 `git log -1 --format=%h`。本机 GitHub 凭证是 baigr16，仓库属于 baigr20，`git push origin main` 会 403。上线需要 baigr20 或 GrokBot 推送，并把 Worker 绑到 `claude.nx.kg/api/*`。

## 遗留问题

- 未部署 Worker 时，线上仍只有会话 JSON 里的套餐、邮箱、会话有效期、账号创建；手机号和历史订单会显示「本次未从接口取到」，数据来源会写明跨域拦截。
- Free 账号即使走代理，invoices/subscriptions 仍可能没有账单到期时间和订单。
- 取消/恢复续费仍打开官方账单页，本站不代操作。
- 不要提交仓库里未跟踪的 `*.jpg` 和 `GROKBOT-UPLOAD.md`。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```
