# NX 工具箱（claude.nx.kg）

GitHub Pages 站点，域名仍是 `claude.nx.kg`。原先的公共聊天首页已替换为工具箱；第一项工具是浏览器本地的 Sub / CPA 互转。首页和工具页共用一套浅色小清新样式：米白底、薄荷绿点缀、深灰绿文字。

- 首页：`/`
- 转换工具：`/sub-cpa/`，交互和布局沿用原转换页。首次打开就是转换界面；只有点击「Codex 登录」才会打开授权弹窗并前往官方授权页。
- 2FA 动态验证码：`/2fa/`，在浏览器本地根据 Base32 或 otpauth:// 生成 TOTP，密钥不上传、不保存。
- 模型指纹检测：首页入口指向第三方 [Fingerpoint Detector](https://lm.ikale.io/)，新标签打开；本站不嵌入、不代理，也不向该站传递凭据。
- ChatGPT 订阅查询：`/subscription/`，按 [checkgpt.plus](https://checkgpt.plus/) 一比一复刻镜花水月页面，不套工具箱顶栏。粘贴 `chatgpt.com/api/auth/session` JSON，按同一套接口查询。页面跨域调用已部署的 Worker `https://claude-nx-subscription.bai1517735291.workers.dev`：`POST /api/subscription/query`，结果页再用同一个 `actionToken` 调用 `/api/subscription/cancel`、`/api/subscription/renew`、`/api/subscription/link` 和 `/api/action/release`。Worker 先只带 accessToken 和 `oai-device-id` 请求 ChatGPT；accessToken 被拒绝时才附上 `__Secure-next-auth.session-token`。未过期的 accessToken 不会被写成“会话已过期”。不依赖站点同源 `/api/*` 路由。Worker 源码在 `backend/subscription-worker.mjs`。跨隔离实例要能取消或恢复续费，需要给 Worker 设置 `ACTION_TOKEN_SECRET`。
- Grok 订阅查询：`/grok/`。粘贴 `grok.com/rest/subscriptions` 的整页 JSON，在浏览器本地计算剩余天数。生效且带到期时间的记录才计入天数；X 订阅对象为空时只显示档位和生效状态。不代查 x.com，也不上传 JSON。
- 谷歌账号检查：`/gmail/`。按行粘贴 Gmail、Google 企业邮箱或纯用户名，查询是否注册、是否异常。页面跨域调用已部署的 Worker `https://claude-nx-subscription.bai1517735291.workers.dev`：`POST /api/gmail/check`。Worker 把账号列表转给公开检测服务，不落盘、不记日志。拒绝带密码分隔符的行。单次最多 200 个。
- 转换在当前浏览器完成，不把凭证上传到本站。
- Codex 登录使用官方 OAuth / PKCE。授权后若跳到 `localhost:1455`，把地址栏里的回调链接粘贴回本页即可向官方 token 接口换票。
- 未移植已失效或依赖后端的能力：协议登录、测活、工作台。

回退方式：还原替换前的 `main` 提交即可恢复旧聊天首页。

本地 CSS 和 JS 在页面里带内容哈希（`?v=`），更新样式后只要打开页面本身就会拿到新资源，不必再给首页地址加查询参数。
