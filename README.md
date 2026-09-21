# 页伴 Pagepal · 七天读书营

页伴是一个本地优先的七天读写网页：导入自己有权使用的电子书，安排七天阅读，每日阅读、与 AI 讨论、写下至少 400 字笔记，再导出为 Word、Markdown 或 Obsidian Markdown。

本仓库公开的是当前的本机体验版源码。它在一台电脑上运行，不是已经部署的网站，也不是可直接暴露到公网的多人服务。

## 已实现

- 导入 EPUB、TXT、Markdown，并按完整阅读单元安排连续 7 天。
- 草稿自动保存、400 字提交校验、逾期补交和已提交笔记编辑。
- 可选的 DeepSeek 全书导读、每日导读、七日拆分建议、讨论话题与自由问答。
- 微信读书书架、书籍信息与目录的只读导入；不获取章节正文，建营前仍需关联自己合法持有的本地正文。
- 笔记导出为 `.docx`、Markdown，或通过 Obsidian URI 准备新建笔记。
- 五个浅色响应式页面，以及原创圆团仓鼠书搭子。

## 本地启动

需要 Node.js 22 或更新版本。

```sh
npm ci --ignore-scripts
npm start
```

保持终端中的服务运行，然后打开 <http://127.0.0.1:4173/reading.html>。不要直接用 `file://` 打开 HTML，也不要把当前服务转发到局域网或公网。

`npm start` 会先在本机生成忽略提交的 `public/` 目录：JSX 由 esbuild 预编译，React 与 ReactDOM 从固定版本的本地 npm 依赖复制。浏览器运行页面时不依赖第三方 CDN，也不在浏览器内编译 JSX。

## 可选配置

不配置外部服务，也能体验本地导入、七日阅读、笔记和导出主链路。

### DeepSeek

1. 复制 `server/.env.example` 为 `server/.env.deepseek.local`。
2. 在这个本地文件中填写 `DEEPSEEK_API_KEY`，必要时调整 `DEEPSEEK_MODEL`。
3. 重启 `npm start`。

密钥仅由本机 Node 服务读取，不会发送到前端。真实密钥文件已被 Git 忽略；不要把密钥写入源码、网页、日志、Issue 或提交记录。

### 微信读书

项目固定使用 `weread-agent-cli@0.1.4`。从微信读书授权页获取自己的 API Key 后，在本地执行：

```sh
WEREAD_CLI_CONFIG_DIR="$PWD/server/.weread-cli" node_modules/.bin/weread config set-key <your-key>
```

授权信息只保存在本机服务端的忽略目录中。此能力只读取书架、书籍元信息和目录，不读取章节正文。

## 数据与 AI 发送范围

书籍、营地、草稿、笔记和讨论记录保存在当前浏览器的 `localStorage`。当前版本没有账号、云同步或服务端备份；清除站点数据会丢失内容，请定期导出。

导入的文件在浏览器中解析。配置 DeepSeek 后，非示例书会发生以下请求：

- **全书导读会自动生成**：应用会先发送最多约 8 万字的正文文本用于压缩，再发送序言/前言、目录和压缩后的正文摘要用于生成导读。它不会把图片或 API Key 放进请求。
- **每日导读会自动生成**：首次打开尚无导读的某日阅读页时，会发送当天阅读范围。内容超过单次导读上限时，会先发送当天文本用于压缩，再把摘要用于生成每日导读。
- **七日 AI 拆分由用户点击触发**：发送单元标题、层级、字数和短摘录，不发送笔记。
- **讨论由用户点击触发**：只有点击“分析今日阅读，生成 3 个话题”或发送自己的问题后，才会发送当天阅读范围；过长内容会先压缩。自由问答还会带上有限条数的最近讨论消息。

上述 AI 功能会把完成当前任务所需的书籍内容发送给 DeepSeek。草稿和笔记不会作为这些阅读 AI 请求的一部分发送。模型可能出错，请自行核对结果；不要导入或发送无权使用、含敏感信息的内容。

其他边界：

- 导入文件限 EPUB、TXT、Markdown，单文件不超过 6 MB；不支持 PDF、扫描件和加密 EPUB。
- 飞书写入、多人账户、云端持久化和公网部署尚未接入。
- 服务默认只监听 `127.0.0.1`。把源码放到 GitHub 不等于部署产品。

## 测试

```sh
npm test
```

测试覆盖日期与提交规则、存储并发、文件导入、文档导出、AI 请求与输出校验、微信读书适配器和本地服务路由。持续集成使用 Node.js 22，执行同一套测试且不读取真实外部服务密钥。

## 主要文件

- `reading-ui.jsx` / `reading.css`：页面、交互与响应式视觉。
- `reading-art.jsx` / `reading-content.js`：原创书搭子与演示内容。
- `reading-model.js`：阅读拆分、日期、字数、提交和编辑规则。
- `reading-store.js`：Web Locks 与 revision 冲突保护下的本地存储。
- `reading-import.js` / `reading-export.js`：安全限额内的导入与导出。
- `reading-api.js` / `server/`：AI 客户端合同、服务端校验与微信读书只读适配。
- `server.mjs`：本地 HTTP 服务、静态资源白名单和 API 路由。
- `scripts/build.mjs`：生成本地浏览器资源，不把构建产物提交到仓库。
- `tests/`：Node.js 内置测试套件。

## 许可与安全

软件代码按 [MIT License](LICENSE) 授权；角色插画表达、原创演示文本以及“Pagepal / 页伴”名称与品牌不在 MIT 授权范围内，详见 [NOTICE.md](NOTICE.md)。第三方依赖仍适用各自的许可证。

请不要在公开 Issue 中披露漏洞、密钥或用户内容。安全问题请按 [SECURITY.md](SECURITY.md) 通过 GitHub Private Vulnerability Reporting 报告。
