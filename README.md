# desktop-pet

> 一只住在你电脑桌面上的AI桌宠，支持 DeepSeek / OpenAI(ChatGPT) / 自定义模型，可以陪你聊天、帮你分析文档、联网搜索信息。**兼容 macOS 和 Windows。**

An AI desktop pet for macOS and Windows, supporting DeepSeek, OpenAI (ChatGPT), and custom model providers. Chat, analyze documents, and search the web — all from a cute floating companion.

## 功能特性 / Features

- 🐱 **多形象切换** — 小橘（原创橘猫SVG）、小奶娃、极限战士（战锤40K Ultramarines）、Claude（💠 代码风格形象），独立名称/性格/UI配色/欢迎词/气泡消息
- 💬 **多模型AI聊天** — 支持 DeepSeek / OpenAI(ChatGPT) / 自定义模型，每个模型独立API Key和端点URL（可配置代理），每个形象有专属性格语气（用户可叠加自定义）
- 📄 **文档分析** — 拖拽到桌宠嘴巴或点击📎导入TXT/PDF/DOCX/MD/JSON/CSV文件，AI自动分析总结
- 🌐 **联网搜索** — 可选开启（设置面板中切换），Bing搜索 + wttr.in天气自动检测
- 🌦️ **天气查询** — 自动识别天气类问题，通过wttr.in获取实时天气数据
- 📝 **多对话管理** — 自定义下拉菜单切换/删除对话，AI自动总结对话标题
- 🎨 **个性化语气** — 自定义AI说话风格（霸道总裁、说英文、更毒舌...），叠加在主题性格之上
- 🪟 **液态玻璃UI** — macOS原生vibrancy毛玻璃效果 + backdrop-filter模糊；Windows深色半透明主题 + 可拖拽调整窗口尺寸
- 🔑 **启动时API Key验证** — 自动检测当前模型Key有效性，失效/未设置时弹出提醒
- ➕ **自定义模型** — 支持添加任意OpenAI兼容API（如代理、第三方服务），自定义名称/端点/模型标识
- 🗣️ **主题对话气泡** — 每个形象有专属的悬停打招呼、闲置话语、投喂文案；Claude主题使用cyber代码风格气泡（深色背景+蓝色代码字体）
- 📋 **消息复制** — 用户和AI消息均可一键复制
- 💾 **本地存储** — API Key和聊天记录完全本地化（electron-store），不上传任何第三方
- 🚀 **开机自启** — 支持 macOS 登录项 / Windows 注册表自动启动

## 系统要求 / Requirements

| | macOS | Windows |
|---|---|---|
| **系统版本** | macOS 10.13+ | Windows 10 / 11 |
| **Node.js** | 18.x 或 20.x LTS | 18.x 或 20.x LTS |
| **Python** | Python 3 + Pillow（仅生成图标时需要） | 不需要 |
| **AI API Key** | DeepSeek / OpenAI / 自定义 | DeepSeek / OpenAI / 自定义 |

> ⚠️ **Node.js v24 有已知兼容性问题**，建议使用 v18 或 v20 LTS。

---

## macOS 用户 / macOS Users

### 安装与运行

```bash
# 1. 克隆仓库（默认 main 分支）
git clone https://github.com/yangr8640-eng/desktop-pet.git
cd desktop-pet

# 2. 安装依赖
npm install

# 3. 生成应用图标（可选，仅打包需要）
python3 generate_icon.py

# 4. 运行
npm start
```

桌宠会出现在屏幕右上角。

### 打包构建

```bash
npm run build
```

生成 `dist/` 目录，包含 `.dmg` 和 `.zip` 安装包。

### 特性说明

- macOS 版本使用原生 `vibrancy` API 实现毛玻璃效果，聊天窗口可透过看到桌面背景
- 桌宠窗口使用 `NSPanel` 类型，点击其他应用时自动隐藏，Alt+Tab 不显示
- 支持 `-webkit-app-region` 拖拽窗口标题栏

---

## Windows 用户 / Windows Users

### 前置条件

1. 安装 [Node.js](https://nodejs.org/) 18.x 或 20.x LTS（⚠️ 不要安装 v24）
2. 安装 [Git for Windows](https://git-scm.com/download/win)（或直接在 GitHub 下载 ZIP）

### 安装与运行

```bash
# 1. 克隆仓库并切换到 windows 分支
git clone https://github.com/yangr8640-eng/desktop-pet.git
cd desktop-pet
git checkout windows

# 2. 安装依赖
npm install

# 3. 运行
npm start
```

桌宠会出现在屏幕右上角。

### 打包构建

```bash
npm run build -- --win
```

生成 `dist/` 目录，包含 `.exe` NSIS 安装器和 `win-unpacked` 便携版。

### 特性说明

- Windows 版本使用深色半透明主题（无原生毛玻璃效果，用 CSS `backdrop-filter` 模拟层次感）
- 桌宠窗口透明区域可正常穿透（点击透过到桌面）
- 聊天窗口可拖拽调整尺寸（右下角/边缘拖拽手柄）
- 中文字体使用 Microsoft YaHei（微软雅黑），确保正常渲染

### macOS 与 Windows 版本差异

| 特性 | macOS | Windows |
|------|-------|---------|
| 毛玻璃效果 | 原生 vibrancy（实时桌面模糊） | CSS backdrop-filter（深色半透明） |
| 窗口类型 | NSPanel（浮动面板） | 普通无边框窗口 + alwaysOnTop |
| 设置面板 | 浅色半透明主题 | 深色主题 |
| 文件拖放 | webUtils.getPathForFile | webUtils.getPathForFile |
| 打包格式 | .dmg / .zip | .exe (NSIS) / 便携版 |

## 项目结构 / Project Structure

```
desktop-pet/
├── main.js              # Electron主进程
├── preload.js           # IPC桥接（安全隔离）
├── themes.js            # 主题数据模块（形象/性格/配色/欢迎词）
├── package.json
├── pet/
│   ├── pet.html         # 桌宠窗口（CSS动画）
│   ├── pet.js           # 桌宠交互逻辑
│   └── themes/
│       ├── orange/      # 🧡 小橘 — 原创橘猫SVG
│       │   ├── normal.svg
│       │   └── mouthopen.svg
│       ├── yellow/      # 💛 小奶娃 — 原始角色SVG
│       │   ├── normal.svg
│       │   └── mouthopen.svg
│       ├── warrior/     # ⚔️ 极限战士 — Ultramarines战锤形象
│       │   ├── normal.svg
│       │   └── mouthopen.svg
│       └── claude/       # 💠 Claude — 代码风格AI形象（默认）
│           ├── normal.svg
│           └── mouthopen.svg
├── chat/
│   ├── chat.html        # 聊天侧边栏UI
│   ├── chat.css         # 液态玻璃暗色主题
│   └── chat.js          # 聊天+AI调用逻辑
├── assets/              # 应用图标
├── generate_icon.py     # 图标生成脚本
├── launcher.swift       # 可选：Swift启动器
└── launcher.rb          # 可选：Ruby启动器
```

## 常见问题 / FAQ

**Q: 启动后报错 `ELECTRON_RUN_AS_NODE`？**  
A: 在终端中执行 `unset ELECTRON_RUN_AS_NODE` 后再运行 `npm start`。

**Q: DeepSeek API Key怎么获取？**  
A: 访问 [platform.deepseek.com](https://platform.deepseek.com/) 注册账号，在API Keys页面创建Key。费用极低。

**Q: 可以使用OpenAI/ChatGPT吗？**  
A: 支持。打开设置⚙️，在"AI 模型"下拉菜单中切换到"OpenAI / ChatGPT"，输入你的OpenAI API Key即可。如果遇到网络问题（中国大陆），可通过"+ 添加自定义模型"配置代理端点。

**Q: 怎么添加自定义模型/代理？**  
A: 打开设置⚙️ → 点击"+ 添加自定义模型" → 填写模型名称、API端点URL（如代理地址）、模型标识（如gpt-4o）、API Key。适合使用第三方API代理或兼容OpenAI格式的其他模型。

**Q: 联网搜索怎么开启？**  
A: 打开聊天侧边栏，点击右上角🌐按钮切换。搜索通过抓取Bing实现，无需额外API Key。

**Q: 怎么切换桌宠形象？**  
A: 打开聊天侧边栏 → 点击⚙️设置 → "宠物外观"下拉菜单切换。切换后桌宠形象、名称、性格语气、UI配色全部即时变化，重启保持。

**Q: 支持Windows吗？**  
A: 支持！Clone 仓库后切换到 `windows` 分支：`git checkout windows`，然后 `npm install && npm start`。详见上方「Windows 用户」章节。Windows 版本使用深色半透明主题替代 macOS 原生毛玻璃效果，功能与 macOS 版本一致。

**Q: 支持Linux吗？**  
A: 暂未适配。欢迎社区贡献 Linux 分支。

## 技术栈 / Tech Stack

- [Electron](https://www.electronjs.org/) 33.x
- [DeepSeek API](https://platform.deepseek.com/) / [OpenAI API](https://platform.openai.com/) / 自定义兼容API — 多模型支持
- [electron-store](https://github.com/sindresorhus/electron-store) — 本地持久化
- [mammoth](https://github.com/mwilliamson/mammoth.js) — DOCX解析
- [pdf-parse](https://github.com/nisaacson/pdf-parse) — PDF解析

## License

MIT © yangr8640-eng
