# 贡献指南 / Contributing Guide

欢迎优化桌宠！无论是修 bug、加功能、改进 UI，都可以通过 Pull Request 提交。

## 快速导航

| 你想做什么 | 去哪里 |
|-----------|--------|
| 改进 AI 回复质量 | [`src/ai.js`](src/ai.js) — prompt 构建、模型调用 |
| 优化聊天 UI/样式 | [`chat/chat.css`](chat/chat.css)、[`chat/chat.html`](chat/chat.html) |
| 消息渲染（Markdown/代码高亮） | [`chat/chat-messages.js`](chat/chat-messages.js) |
| 对话管理/存储 | [`src/store.js`](src/store.js) |
| 新增桌宠形象 | [`pet/themes/`](pet/themes/) + [`themes.js`](themes.js) |
| 修改窗口行为 | [`src/windows.js`](src/windows.js) — 窗口创建/显隐/动画 |
| IPC 通信 | [`preload.js`](preload.js) + [`src/ipc-handlers.js`](src/ipc-handlers.js) |
| 联网搜索 | [`src/search.js`](src/search.js) |
| 文件导入解析 | [`src/file-reader.js`](src/file-reader.js) |
| 自动更新 | [`src/updater.js`](src/updater.js) |
| 系统托盘 | [`src/tray.js`](src/tray.js) |

## 环境搭建

```bash
# 1. Fork + Clone
git clone https://github.com/<你的用户名>/desktop-pet.git
cd desktop-pet
git checkout windows   # Windows 开发分支

# 2. 安装依赖（Node.js 18/20，不要用 v24）
npm install

# 3. 运行
npm start
```

## 项目架构

```
main.js (Electron 主进程入口)
  ├── 窗口管理 → src/windows.js
  ├── IPC 处理 → src/ipc-handlers.js
  ├── AI 引擎   → src/ai.js
  ├── 数据持久 → src/store.js
  ├── 文件解析 → src/file-reader.js
  ├── 联网搜索 → src/search.js
  ├── 自动更新 → src/updater.js
  └── 系统托盘 → src/tray.js

preload.js (安全桥接层)
  └── 暴露 petAPI 给渲染进程

渲染进程
  ├── pet/   (桌宠窗口 — SVG 动画 + 气泡)
  └── chat/  (聊天窗口 — 对话界面 + 设置面板)
```

**关键原则：**
- 渲染进程**不直接访问** Node.js API，全部通过 `preload.js` → IPC → 主进程
- AI 调用、文件读写、命令执行都在主进程完成
- 跨平台兼容：macOS 使用原生 vibrancy/vibrancy，Windows 使用深色主题

## 代码风格

- **缩进**: 2 空格
- **引号**: 单引号（JS 字符串）、模板字符串（含变量时）
- **分号**: 有
- **命名**: camelCase（变量/函数）、PascalCase（类/构造函数）
- **注释**: 关键逻辑加中文注释，复杂函数加 JSDoc
- **模块**: CommonJS（`require` / `module.exports`），不使用 ES Module
- **中文**: UI 文案用中文，日志用英文，console.log 保留用于调试

参考现有代码风格即可，不需要 Prettier/ESLint。

## 测试

```bash
npm test   # 运行全部测试
```

| 测试文件 | 覆盖模块 |
|---------|---------|
| [`test/store.test.js`](test/store.test.js) | 数据 CRUD |
| [`test/ai.test.js`](test/ai.test.js) | AI 调用逻辑 |
| [`test/search.test.js`](test/search.test.js) | 搜索/天气 |
| [`test/file-reader.test.js`](test/file-reader.test.js) | 文件解析 |
| [`test/ipc-handlers.test.js`](test/ipc-handlers.test.js) | IPC 处理 |

新增功能**建议**添加对应测试，已有测试**必须**全部通过才能合并。

## Pull Request 流程

```
1. 从 windows 分支创建功能分支
   git checkout windows
   git pull origin windows
   git checkout -b feat/你的功能名

2. 开发 + 测试
   npm test   # 确保全绿

3. 提交（使用中文或英文都可以）
   git commit -m "feat: xxx功能描述"

4. 推送到自己的 Fork
   git push origin feat/你的功能名

5. 在 GitHub 上发起 Pull Request
   目标分支: windows
```

### Commit 规范

建议使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新功能
fix:  修复 bug
docs: 文档变更
refactor: 重构（不改变功能）
test: 测试相关
chore: 构建/工具链
```

示例：`feat: 添加语音消息支持` / `fix: 修复聊天窗口最小尺寸限制失效`

### PR 标题示例

- `feat: 添加新桌宠主题`
- `fix: 聊天窗口最小尺寸限制失效`
- `refactor: 提取公共的消息格式化函数`

## 用 Claude Code 提交贡献

如果你也在用 Claude Code，可以直接让它帮你完成从改代码到提 PR 的全流程。

### 准备工作

首先把 Claude Code 的授权和能力告诉它：

```
你现在在帮我优化一个开源桌宠项目 desktop-pet，
仓库在 https://github.com/yangr8640-eng/desktop-pet，
我先 Fork 并 Clone 到了本地。

请先阅读 CONTRIBUTING.md 了解项目规范和代码风格。
```

### 日常贡献的话术

直接把需求描述清楚就行，跟聊天一样：

```
帮我给桌宠加一个功能：当用户输入特定关键词时，
自动更换桌宠形象。

改动完成后跑 npm test 确保不破坏现有功能，
然后用 Conventional Commits 格式提交，
最后帮我提 PR 到 yangr8640-eng/desktop-pet 的 windows 分支。
```

### PR 话术

```
把当前分支的改动推到我 Fork 的仓库，
然后用 gh 命令给 yangr8640-eng/desktop-pet 的 windows 分支提一个 PR，
标题写 "feat: xxx"，描述写清楚改了什么。
```

Claude Code 会自动完成：读代码 → 改文件 → 跑测试 → commit → push → `gh pr create`。

## 常见贡献方向

- 🎨 **新桌宠形象** — 在 `pet/themes/` 下新建设计目录 + `themes.js` 注册
- 💬 **聊天体验优化** — 改进消息渲染、流式输出动画
- 🎛️ **设置面板改进** — 改 `chat/chat.html` + `chat/chat-settings.js`
- 🌐 **新搜索源** — 在 `src/search.js` 添加搜索 provider
- 📄 **新文件格式支持** — 在 `src/file-reader.js` 添加解析器
- 🪟 **Windows 体验优化** — 改进 Windows 下的 UI 细节
- 🐛 **Bug 修复** — 任何模块，先提 Issue 描述问题

## 行为准则

- 对新手友好 — PR 描述写清楚改了什么、为什么这样改
- Review 意见是讨论而非命令 — 保持友善
- MIT 协议 — 贡献代码即同意在此协议下发布

---

有问题先在 [Issues](https://github.com/yangr8640-eng/desktop-pet/issues) 讨论，避免做了大量工作后发现方向不对。
