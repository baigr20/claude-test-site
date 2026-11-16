# Codex备忘

- 日期：2026-11-16
- 任务目标：在 NX 工具箱上线 Grok 订阅查询，本地解析 `grok.com/rest/subscriptions` JSON，并正确处理同一份 JSON 里的 X 订阅。

## 结论

- 新页面：`/grok/`。打开官方订阅 JSON，粘贴后只在浏览器计算，不上传，也不走本地代理或现有 Worker。
- 剩余天数只统计状态为生效且带到期时间的记录。刚过期按剩余 0 天，并写出已过的分钟或小时。
- X Premium+ 能从同一份 JSON 看出档位和是否生效。`x` 为空对象时没有到期时间，不算剩余天数。X 自己的 GraphQL 要带登录请求头，不能像 Grok 这个地址一样直接打开复制，所以本页不代查 x.com。
- 未生效记录里的未来账期不计入剩余天数。购买凭证、订阅号和用户 ID 不进入解析结果。

## 修改文件

- `grok/index.html`、`grok/src/parse.js`、`grok/src/app.js`、`grok/src/styles.css`
- `index.html`、`README.md`
- `scripts/stamp-assets.mjs`
- `tests/grok.test.mjs`、`tests/visual.test.mjs`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node scripts/stamp-assets.mjs
node --test
```

## 测试结果

全量 `node --test`：45 passed, 0 failed。

## Git

本地提交见本次 `git log -1 --format=%h`。上线需要推到 `baigr20/claude-test-site` 的 `main`，由 GitHub Pages 发布到 `https://claude.nx.kg/grok/`。

## 遗留问题

- X 订阅在这份 Grok JSON 里通常没有到期日。若以后拿到 X 订阅管理接口的一份真实响应，可以再加第二种粘贴解析。
- 不要提交仓库里未跟踪的 `*.jpg` 和 `GROKBOT-UPLOAD.md`。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
```
