# desktop-pet
This is an AI pet that can be deployed on the desktop and can answer questions and analyze documents.

> 一只住在你Mac电脑桌面上的橘色小奶猫，搭载DeepSeek AI，可以陪你聊天、帮你分析文档、联网搜索信息。

An orange kitten desktop companion for macOS, powered by DeepSeek AI. Chat, analyze documents, and search the web — all from a cute floating pet.

## 功能特性 / Features

- 🐱 **桌宠动画** — 浮动、眨眼、摇尾巴、打招呼，纯CSS+SVG实现
- 💬 **AI聊天** — 基于DeepSeek API的智能对话，带有可爱的猫咪性格
- 📄 **文档分析** — 拖拽或导入TXT/PDF/DOCX/MD/JSON/CSV文件，AI自动分析总结
- 🌐 **联网搜索** — 可选开启，通过Bing搜索获取实时信息
- 📝 **多对话管理** — 保存多条对话历史，随时切换
- 🎨 **个性化语气** — 自定义AI说话风格（霸道总裁、说英文、更毒舌...）
- 💾 **本地存储** — API Key和聊天记录完全本地化，不上传任何第三方
- 🚀 **开机自启** — 支持macOS登录项自动启动

## 系统要求 / Requirements

- **macOS** 10.13+（使用了NSPanel专用API，仅支持macOS）
- **Node.js** 18.x 或 20.x LTS（⚠️ 不支持v24，有已知兼容性问题）
- **Python 3** + Pillow（仅生成图标时需要）
- **DeepSeek API Key**（[免费注册获取](https://platform.deepseek.com/)）

## 安装 / Installation

```bash
# 1. 克隆仓库
git clone https://github.com/yangr8640-eng/desktop-pet.git
cd desktop-pet

# 2. 安装依赖
npm install

# 3. 生成应用图标（可选，用于打包）
python3 generate_icon.py
```

## 运行 / Usage

```bash
npm start
```

桌宠会出现在屏幕右上角。你可以：
- **悬停**猫咪看它打招呼
- **点击**猫咪打开聊天侧边栏
- **拖拽**猫咪移动位置
- **拖拽文件**到猫咪身上，它会张嘴"吃掉"并分析文档
- 聊天窗口设置⚙️中配置API Key和个性化语气

## 打包构建 / Build

```bash
npm run build
```

生成的DMG和ZIP文件在 `dist/` 目录。`prebuild` 钩子会自动调用 `npm run icon` 生成图标。

## 项目结构 / Project Structure

```
desktop-pet/
├── main.js             # Electron主进程
├── preload.js          # IPC桥接（安全隔离）
├── package.json
├── pet/
│   ├── pet.html        # 桌宠SVG+CSS动画
│   └── pet.js          # 桌宠交互逻辑
├── chat/
│   ├── chat.html       # 聊天侧边栏UI
│   ├── chat.css        # 暗色主题样式
│   └── chat.js         # 聊天+AI调用逻辑
├── assets/             # 应用图标
├── generate_icon.py    # 图标生成脚本
├── launcher.swift      # 可选：Swift启动器（后台守护进程）
└── launcher.rb         # 可选：Ruby启动器（后台守护进程）
```

## 常见问题 / FAQ

**Q: 启动后报错 `ELECTRON_RUN_AS_NODE`？**  
A: 在终端中执行 `unset ELECTRON_RUN_AS_NODE` 后再运行 `npm start`。

**Q: DeepSeek API Key怎么获取？**  
A: 访问 [platform.deepseek.com](https://platform.deepseek.com/) 注册账号，在API Keys页面创建Key。费用极低。

**Q: 联网搜索怎么开启？**  
A: 打开聊天侧边栏，点击右上角🌐按钮切换。搜索通过抓取Bing实现，无需额外API Key。

**Q: 支持Windows/Linux吗？**  
A: 目前不支持。桌宠使用了macOS专属的NSPanel窗口类型（`type: 'panel'`），实现透明无边框、全工作区显示等效果需要macOS API。

## 技术栈 / Tech Stack

- [Electron](https://www.electronjs.org/) 33.x
- [DeepSeek API](https://platform.deepseek.com/) (deepseek-chat)
- [electron-store](https://github.com/sindresorhus/electron-store) — 本地持久化
- [mammoth](https://github.com/mwilliamson/mammoth.js) — DOCX解析
- [pdf-parse](https://github.com/nisaacson/pdf-parse) — PDF解析

## License

MIT © yangr8640-eng
