# NX 工具箱（claude.nx.kg）

GitHub Pages 站点，域名仍是 `claude.nx.kg`。原先的公共聊天首页已替换为工具箱；第一项工具是浏览器本地的 Sub / CPA 互转。首页和工具页共用一套浅色小清新样式：米白底、薄荷绿点缀、深灰绿文字。

- 首页：`/`
- 转换工具：`/sub-cpa/`，交互和布局沿用原转换页。首次打开就是转换界面；只有点击「Codex 登录」才会打开授权弹窗并前往官方授权页。
- 2FA 动态验证码：`/2fa/`，在浏览器本地根据 Base32 或 otpauth:// 生成 TOTP，密钥不上传、不保存。
- 模型指纹检测：首页入口指向第三方 [Fingerpoint Detector](https://lm.ikale.io/)，新标签打开；本站不嵌入、不代理，也不向该站传递凭据。
- ChatGPT 订阅查询：`/subscription/`，镜花水月布局。粘贴 `chatgpt.com/api/auth/session` JSON。若部署了同源 Cloudflare Worker，会向 ChatGPT 拉取手机号、额度和历史订单；否则只在浏览器解析会话，跨域拦截的字段会标明「没有返回」。取消续费跳转官方账单页。 Worker 源码在 `backend/subscription-worker.mjs`。
- Grok 订阅查询：`/grok/`。粘贴 `grok.com/rest/subscriptions` 的整页 JSON，在浏览器本地计算剩余天数。生效且带到期时间的记录才计入天数；X 订阅对象为空时只显示档位和生效状态。不代查 x.com，也不上传 JSON。
- 转换在当前浏览器完成，不把凭证上传到本站。
- Codex 登录使用官方 OAuth / PKCE。授权后若跳到 `localhost:1455`，把地址栏里的回调链接粘贴回本页即可向官方 token 接口换票。
- 未移植已失效或依赖后端的能力：协议登录、测活、工作台。

回退方式：还原替换前的 `main` 提交即可恢复旧聊天首页。

本地 CSS 和 JS 在页面里带内容哈希（`?v=`），更新样式后只要打开页面本身就会拿到新资源，不必再给首页地址加查询参数。
