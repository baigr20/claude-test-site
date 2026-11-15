# Codex备忘

- 日期：2026-11-15
- 任务目标：把镜花水月 / checkgpt.plus 的订阅查询布局接到 NX 工具箱 https://claude.nx.kg/ ，在网页上使用，会话不上传本站。

## 修改文件

- `index.html`：新增「ChatGPT 订阅查询」卡片和「查询」分类
- `subscription/`：查询页、结果页、镜花水月样式与浏览器解析逻辑
- `scripts/stamp-assets.mjs`、`tests/subscription.test.mjs`、`tests/search.test.mjs`、`tests/visual.test.mjs`、`tests/convert.test.mjs`、`README.md`

## 运行命令

```powershell
Set-Location 'D:\gitdir\claude-test-site'
node scripts/stamp-assets.mjs
node --test
```

## 测试结果

- 订阅解析与页面约束测试通过
- 全量测试除 GrokBot 云端备份路径外均通过；该备份检查在本机无 `/workspace/backups` 时跳过

## Git

本地提交 `2817745`。当前本机 GitHub 凭证是 baigr16，仓库属于 baigr20，`git push origin main` 返回 403。需要用 baigr20 或 GrokBot 推送后才会上线。

线上地址：

- https://claude.nx.kg/
- https://claude.nx.kg/subscription/

## 遗留问题

- 静态 GitHub Pages 不能代发 ChatGPT 网页接口。额度/模型在浏览器跨域被拦时，只展示会话 JSON / JWT 里能确认的套餐、邮箱和登录保护。
- 取消/恢复续费打开官方账单页，本站不代操作。

## 回退方法

```powershell
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' revert HEAD
& 'D:\Downloads\cmder\vendor\git-for-windows\cmd\git.exe' -C 'D:\gitdir\claude-test-site' push origin main
```
