const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const Store = require('electron-store');
const { themes, getTheme } = require('./themes');
require('dotenv').config();

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const store = new Store({
  defaults: {
    petPosition: null,
    conversations: [],
    activeConversationId: null,
    modelProviders: [],
    activeModelProviderId: 'deepseek',
    searchEnabled: false,
    personalityPrompt: '',
    activeTheme: 'claude'
  }
});

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getConversations() {
  return store.get('conversations') || [];
}

function saveConversations(convs) {
  store.set('conversations', convs);
}

function getActiveConversation() {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  let conv = convs.find(c => c.id === activeId);
  if (!conv) {
    conv = {
      id: generateId(),
      title: '新对话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    convs.push(conv);
    store.set('activeConversationId', conv.id);
    saveConversations(convs);
  }
  return { conv, convs };
}

function getConversationList() {
  const convs = getConversations();
  return convs.map(c => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt
  })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function updateActiveConversation(updater) {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  const idx = convs.findIndex(c => c.id === activeId);
  if (idx >= 0) {
    updater(convs[idx]);
    saveConversations(convs);
  }
}

/* ─── Model Provider helpers ─── */
const PRESET_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/chat/completions',
    modelName: 'deepseek-chat',
    supportsVision: false,
    order: 0
  },
  {
    id: 'openai',
    name: 'OpenAI / ChatGPT',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://api.openai.com/v1/chat/completions',
    modelName: 'gpt-4o',
    supportsVision: true,
    order: 1
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (支持图片)',
    type: 'preset',
    apiKey: process.env.SILICONFLOW_API_KEY || '',
    apiBaseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    modelName: 'Qwen/Qwen2-VL-72B-Instruct',
    supportsVision: true,
    order: 2
  },
  {
    id: 'dashscope',
    name: '通义千问 VL (阿里云)',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    modelName: 'qwen-vl-max',
    supportsVision: true,
    order: 3
  }
];

function getModelProviders() {
  return store.get('modelProviders') || [];
}

function saveModelProviders(providers) {
  store.set('modelProviders', providers);
}

function ensurePresetProviders() {
  let providers = getModelProviders();
  let changed = false;

  for (const preset of PRESET_PROVIDERS) {
    const existing = providers.find(p => p.id === preset.id);
    if (!existing) {
      providers.push({ ...preset });
      changed = true;
    } else {
      // Always sync code-defined fields for presets
      if (existing.apiBaseUrl !== preset.apiBaseUrl) {
        existing.apiBaseUrl = preset.apiBaseUrl;
        changed = true;
      }
      if (existing.modelName !== preset.modelName) {
        existing.modelName = preset.modelName;
        changed = true;
      }
      if (existing.supportsVision !== preset.supportsVision) {
        existing.supportsVision = preset.supportsVision;
        changed = true;
      }
      // Auto-fill SiliconFlow API key from environment if not set
      if (preset.id === 'siliconflow' && !existing.apiKey && preset.apiKey) {
        existing.apiKey = preset.apiKey;
        changed = true;
      }
    }
  }
  if (changed) saveModelProviders(providers);
  return providers;
}

/** Check if a model name suggests vision support */
function modelNameSupportsVision(modelName) {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  return /vl|vision|visual|multimodal|internvl|qwen2-vl|gemini|gpt-4o|gpt-4\.1|claude-3\.5-sonnet|claude-3\.5-haiku|claude-opus/i.test(name);
}

function getActiveModelProvider() {
  ensurePresetProviders();
  const providers = getModelProviders();
  const activeId = store.get('activeModelProviderId') || 'deepseek';
  let provider = providers.find(p => p.id === activeId);
  if (!provider) {
    provider = providers[0] || PRESET_PROVIDERS[0];
    store.set('activeModelProviderId', provider.id);
  }
  // Auto-detect vision support for custom models
  if (provider.supportsVision === undefined) {
    provider.supportsVision = modelNameSupportsVision(provider.modelName);
  }
  return provider;
}

let petWindow = null;
let chatWindow = null;
let isChatVisible = false;
let chatWidth = 360;
let chatHeight = 400; // default, recalculated in createChatWindow
let savedChatBounds = null; // preserved across hide/show cycles
let ignoreBlurUntil = 0; // timestamp to suppress blur after show

/* ─── Pet Window ─── */
function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const savedPos = store.get('petPosition');

  const petWidth = 145;
  const petHeight = 170;
  const x = savedPos != null ? savedPos.x : Math.round((screenWidth - petWidth) * 0.85);
  const y = savedPos != null ? savedPos.y : Math.round((screenHeight - petHeight) * 0.2);

  petWindow = new BrowserWindow({
    width: petWidth,
    height: petHeight,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: false,
    title: '🐱 桌宠',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile('pet/pet.html');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.on('closed', () => { petWindow = null; });
}

/* ─── Chat Window ─── */
function createChatWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  chatWidth = 360;
  chatHeight = Math.round(screenHeight * 0.8);
  const chatY = Math.round((screenHeight - chatHeight) / 2);

  chatWindow = new BrowserWindow({
    width: chatWidth,
    height: chatHeight,
    x: screenWidth,
    y: chatY,
    frame: false,
    resizable: true,
    minWidth: 360,
    minHeight: chatHeight,
    skipTaskbar: false,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#F8F4EE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableInputSystem: true
    }
  });

  chatWindow.loadFile('chat/chat.html');
  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  chatWindow.on('close', (e) => {
    e.preventDefault();
    hideChatWindow();
  });
  chatWindow.on('blur', async () => {
    if (Date.now() < ignoreBlurUntil) return;
    if (!chatWindow || chatWindow.isDestroyed()) return;

    const { x: bx, y: by, width: bw, height: bh } = chatWindow.getBounds();
    const cursor = screen.getCursorScreenPoint();
    // Generous margin — don't hide if cursor could be reaching for the window
    if (cursor.x >= bx - 150 && cursor.x <= bx + bw + 150 &&
        cursor.y >= by - 150 && cursor.y <= by + bh + 150) {
      return;
    }
    // Check if textarea has content (user was typing) — never hide if so
    try {
      const hasText = await chatWindow.webContents.executeJavaScript(
        '(document.getElementById("chatInput")?.value?.length || 0) > 0'
      );
      if (hasText) return;
    } catch (_) { /* ignore */ }
    // Longer delay — only hide if not refocused within 800ms
    const hideTimeout = setTimeout(() => {
      if (isChatVisible && chatWindow && !chatWindow.isDestroyed() && !chatWindow.isFocused()) {
        hideChatWindow();
      }
    }, 800);
    // Cancel hide if window regains focus
    chatWindow.once('focus', () => clearTimeout(hideTimeout));
  });
  chatWindow.on('closed', () => { chatWindow = null; });
}

/* ─── Chat slide animation ─── */
function showChatWindow() {
  if (isChatVisible) return;
  isChatVisible = true;

  // Restore user-resized dimensions from last hide
  if (savedChatBounds) {
    chatWidth = savedChatBounds.width;
    chatHeight = savedChatBounds.height;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const chatY = Math.round((screenHeight - chatHeight) / 2);
  const startX = screenWidth;
  const endX = screenWidth - chatWidth;

  chatWindow.setBounds({ x: startX, y: chatY, width: chatWidth, height: chatHeight });
  chatWindow.show();
  ignoreBlurUntil = Date.now() + 2500; // suppress blur for 2.5s after show — prevents accidental hide

  // Focus the window and then the input
  chatWindow.focus();

  // Focus input after a brief delay to ensure window is ready
  setTimeout(() => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.focus();
      chatWindow.webContents.send('focus-input');
    }
  }, 50);

  const duration = 280;
  const startTime = Date.now();
  const step = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    chatWindow.setBounds({
      x: Math.round(startX + (endX - startX) * eased),
      y: chatY,
      width: chatWidth,
      height: chatHeight
    });
    if (progress < 1) {
      setTimeout(step, 10);
    } else {
      // Re-focus input after animation finishes — macOS sometimes loses focus during rapid bounds changes
      try {
        chatWindow.focus();
        chatWindow.webContents.send('focus-input');
      } catch (_) {}
    }
  };
  step();
}

function hideChatWindow() {
  if (!isChatVisible) return;
  isChatVisible = false;

  // Save current size so we can restore on next show
  savedChatBounds = chatWindow.getBounds();
  chatWidth = savedChatBounds.width;
  chatHeight = savedChatBounds.height;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const chatY = Math.round((screenHeight - chatHeight) / 2);
  const startX = screenWidth - chatWidth;
  const endX = screenWidth;

  const duration = 200;
  const startTime = Date.now();
  const step = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    chatWindow.setBounds({
      x: Math.round(startX + (endX - startX) * eased),
      y: chatY,
      width: chatWidth,
      height: chatHeight
    });
    if (progress < 1) {
      setTimeout(step, 10);
    } else {
      chatWindow.hide();
    }
  };
  step();
}

/* ─── AI API (with Tool Calling) ─── */
/** Simple AI call without tools (for title generation, validation, etc.) */
async function callAISimple(messages) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key哦！请在聊天窗口的设置里输入API Key~`;
  }

  const resp = await fetch(provider.apiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.modelName,
      messages,
      temperature: 0.8,
      max_tokens: 2000
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API错误(${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

/** Pending tool confirmations: toolCallId -> { resolve, reject, timeout } */
const pendingToolConfirmations = new Map();

/** Send a confirmation request to the chat window and wait for user response */
function requestToolConfirmation(toolName, args) {
  return new Promise((resolve, reject) => {
    const toolCallId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const timeout = setTimeout(() => {
      pendingToolConfirmations.delete(toolCallId);
      resolve(false); // Timeout = reject
    }, 60000);

    pendingToolConfirmations.set(toolCallId, { resolve, reject, timeout });

    if (chatWindow && chatWindow.webContents) {
      chatWindow.webContents.send('request-tool-confirm', {
        toolCallId,
        toolName,
        args
      });
    } else {
      clearTimeout(timeout);
      pendingToolConfirmations.delete(toolCallId);
      resolve(false);
    }
  });
}

/** Full AI call with tool calling support */
async function callAIWithTools(messages, onUpdate) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key哦！请在聊天窗口的设置里输入API Key~`;
  }

  const maxToolRounds = 10;
  // Always include tools parameter for the AI to use
  const tools = getOpenAITools();
  let currentMessages = [...messages];

  for (let round = 0; round < maxToolRounds; round++) {
    const body = {
      model: provider.modelName,
      messages: currentMessages,
      temperature: 0.8,
      max_tokens: 4000,
      tools
    };

    if (onUpdate) onUpdate({ type: 'api-call', round: round + 1 });

    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`API错误(${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const message = data.choices[0].message;

    // No tool calls → return text
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || '';
    }

    // Add assistant message with tool calls
    currentMessages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls
    });

    // Process each tool call
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      // Notify UI: tool call started
      if (onUpdate) onUpdate({ type: 'tool-start', toolName, args, toolCallId: toolCall.id });
      if (chatWindow && chatWindow.webContents) {
        chatWindow.webContents.send('tool-execution-status', {
          toolCallId: toolCall.id,
          toolName,
          args,
          status: 'pending'
        });
      }

      // Check if confirmation needed
      if (toolRequiresConfirmation(toolName)) {
        if (onUpdate) onUpdate({ type: 'tool-confirm', toolName, args, toolCallId: toolCall.id });
        const confirmed = await requestToolConfirmation(toolName, args);
        if (!confirmed) {
          const deniedMsg = '用户拒绝了该操作';
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: deniedMsg
          });
          if (onUpdate) onUpdate({ type: 'tool-denied', toolName, toolCallId: toolCall.id });
          if (chatWindow && chatWindow.webContents) {
            chatWindow.webContents.send('tool-execution-status', {
              toolCallId: toolCall.id,
              toolName,
              status: 'denied'
            });
          }
          continue;
        }
      }

      // Execute the tool
      if (onUpdate) onUpdate({ type: 'tool-executing', toolName, toolCallId: toolCall.id });
      const result = await executeToolCall(toolName, args);

      if (onUpdate) onUpdate({ type: 'tool-done', toolName, toolCallId: toolCall.id, result });
      if (chatWindow && chatWindow.webContents) {
        chatWindow.webContents.send('tool-execution-status', {
          toolCallId: toolCall.id,
          toolName,
          status: 'completed',
          result: result.length > 200 ? result.slice(0, 200) + '...' : result
        });
      }

      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result
      });
    }

    // Continue loop to send tool results back to API
  }

  return '任务步骤已全部完成。还有什么需要帮忙的吗？';
}

/* ─── API Key Validation ─── */
async function validateModelApiKey(providerId) {
  const id = providerId || store.get('activeModelProviderId') || 'deepseek';
  const providers = getModelProviders();
  const provider = providers.find(p => p.id === id);
  if (!provider || !provider.apiKey || !provider.apiKey.trim()) {
    return { valid: false, reason: 'no-key' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (resp.ok || resp.status === 429) {
      return { valid: true };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { valid: false, reason: 'invalid-key' };
    }
    return { valid: true };
  } catch {
    return { valid: true, reason: 'network-error' };
  }
}

async function generateConversationTitle(userMessage, aiResponse) {
  const summaryPrompt = [
    { role: 'system', content: '你是一个标题生成器。根据对话内容生成一个简短的标题（10个字以内，不要引号，不要句号）。只输出标题本身，不要任何其他文字。' },
    { role: 'user', content: `用户: ${userMessage.slice(0, 200)}\n\nAI: ${aiResponse.slice(0, 200)}\n\n请为以上对话生成一个简短标题。` }
  ];
  try {
    return await callAISimple(summaryPrompt);
  } catch {
    return null;
  }
}

function buildSystemPrompt(searchContext) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const theme = getTheme(store.get('activeTheme') || 'claude');

  let content = `今天是${todayStr}。

你叫"${theme.name}"，是一个可爱的桌面宠物。你的性格：
${theme.personality}`;

  if (searchContext) {
    content += searchContext;
  }

  const personality = store.get('personalityPrompt');
  if (personality) {
    content += `\n\n【用户偏好】\n${personality}`;
  }

  // Agent capabilities
  content += `\n\n【系统操作能力】
你有直接操作电脑的能力，可以使用以下工具完成任务：

可用工具：
- desktop_write_file(filename, content) — 写文件到桌面（不需要用户确认）
- write_file(path, content) — 写文件到任意路径（需要用户确认）
- read_file(path) — 读取文件内容
- list_directory(path) — 列出目录内容
- run_command(command) — 执行终端命令（需要用户确认）
- get_system_info(detail) — 获取系统信息
- open_url(url) — 在浏览器中打开网页
- get_desktop_path() — 获取桌面路径
- generate_docx(filename, title, content) — 生成 Word 文档 (.docx) 并保存到桌面
- generate_pdf(filename, title, content) — 生成 PDF 文档并保存到桌面

使用说明：
1. 当用户让你做操作电脑的事情时（写文档、读文件、查目录、运行命令等），使用对应的工具完成
2. 对于需要确认的工具，系统会先询问用户，得到同意后再执行
3. 如果用户拒绝，请理解并尝试用其他方式帮助用户
4. 一次任务可能需要多个工具配合使用，请规划好步骤
5. 执行完工具后，用自然语言告诉用户结果
6. 桌面路径是: ${DESKTOP_PATH}`;

  return {
    role: 'system',
    content
  };
}

/* ─── Web Search ─── */
async function performWebSearch(query) {
  try {
    const resp = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!resp.ok) return null;
    const html = await resp.text();

    // Extract result blocks: each result has an h2>a title and a b_caption>p snippet
    const results = [];
    const titleRegex = /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
    const captionRegex = /class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;

    const titles = [];
    const captions = [];
    let m;
    while ((m = titleRegex.exec(html)) !== null && titles.length < 5) {
      titles.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
    }
    while ((m = captionRegex.exec(html)) !== null && captions.length < 5) {
      captions.push(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&ensp;/g, ' ').replace(/&#0?\d+;/g, '').trim());
    }

    for (let i = 0; i < Math.min(titles.length, captions.length); i++) {
      results.push({
        title: titles[i].title,
        snippet: captions[i],
        url: titles[i].url
      });
    }

    return results.length > 0 ? results : null;
  } catch (err) {
    console.error('Web search error:', err.message);
    return null;
  }
}

function formatSearchContext(query, results) {
  if (!results || results.length === 0) return null;

  let text = '\n\n【联网搜索结果】\n';
  text += `用户查询："${query}"\n`;
  text += `共找到 ${results.length} 条相关结果：\n\n`;

  results.forEach((r, i) => {
    text += `${i + 1}. ${r.title}\n`;
    if (r.snippet) text += `   ${r.snippet}\n`;
    text += `   来源: ${r.url}\n\n`;
  });

  text += '请根据以上搜索结果回答用户的问题。如果搜索结果与问题不相关或不充分，请如实告诉用户，并尽量用你自己的知识补充回答。记住保持你可爱的性格~\n';
  return text;
}

/* ─── Weather ─── */
function isWeatherQuery(query) {
  return /天气|气温|温度|下雨|下雪|刮风|台风|雾霾|晴天|阴天|多云|湿度|风力|穿什么|热不热|冷不冷|weather|temperature|rain|snow|wind|forecast/i.test(query);
}

async function fetchWeatherData() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://wttr.in?format=j1', {
      signal: controller.signal,
      headers: { 'User-Agent': 'curl/8.0' }
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    return formatWeatherData(data);
  } catch { return null; }
}

function formatWeatherData(data) {
  const current = data.current_condition?.[0];
  const today = data.weather?.[0];
  if (!current) return null;

  let text = '\n\n【实时天气数据 - wttr.in】\n';
  text += `当前温度: ${current.temp_C}°C (体感 ${current.FeelsLikeC}°C)\n`;
  text += `天气状况: ${current.weatherDesc?.[0]?.value || '未知'}\n`;
  text += `湿度: ${current.humidity}%\n`;
  text += `风速: ${current.windspeedKmph} km/h\n`;
  if (today) {
    text += `今日最高: ${today.maxtempC}°C / 最低: ${today.mintempC}°C\n`;
  }
  text += '\n请根据以上实时天气数据回答用户。记住保持你可爱的性格~\n';
  return text;
}

/* ─── File reading ─── */
async function readFileContent(filePath) {
  const fileName = path.basename(filePath);
  // Skip Office temp files
  if (fileName.startsWith('~$') || fileName.startsWith('.~') || fileName.startsWith('~')) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  try {
    switch (ext) {
      case '.txt':
      case '.md':
      case '.json':
      case '.csv':
      case '.log':
      case '.xml':
      case '.yaml':
      case '.yml':
        return fs.readFileSync(filePath, 'utf-8');
      case '.pdf': {
        const { PDFParse } = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const parser = new PDFParse({ data: buffer });
        const data = await parser.getText();
        return data.text || '(PDF内容为空)';
      }
      case '.docx': {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value || '(文档内容为空)';
      }
      default:
        return null;
    }
  } catch (err) {
    console.error('File read error:', err.message);
    return `[读取文件失败: ${err.message}]`;
  }
}

/* ─── System Tools / AI Agent ─── */
const DESKTOP_PATH = path.join(os.homedir(), 'Desktop');

const SYSTEM_TOOLS = [
  {
    name: 'desktop_write_file',
    description: 'Write content to a file on the desktop. Use this when the user wants to save a file to their desktop.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The filename (e.g., "document.txt", "note.md")' },
        content: { type: 'string', description: 'The file content to write' }
      },
      required: ['filename', 'content']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file at an arbitrary path on the filesystem.',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute file path' },
        content: { type: 'string', description: 'The file content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'read_file',
    description: 'Read the content of a file from the filesystem.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute file path to read' }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a specified path.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to list' }
      },
      required: ['path']
    }
  },
  {
    name: 'run_command',
    description: 'Execute a shell command on the system. Use this when the user wants to run terminal commands, scripts, or interact with the system via CLI.',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'get_system_info',
    description: 'Get information about the system: OS, hostname, CPU, memory, uptime, etc.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        detail: { type: 'string', description: 'Optional: what detail to get (basic/all)', enum: ['basic', 'all'] }
      }
    }
  },
  {
    name: 'open_url',
    description: 'Open a URL in the default web browser.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to open' }
      },
      required: ['url']
    }
  },
  {
    name: 'get_desktop_path',
    description: 'Get the absolute path to the user\'s desktop directory.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'generate_docx',
    description: 'Generate a Word document (.docx) and save it to the desktop. Use this when the user wants a formatted Word document.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The filename (e.g., "简历.docx", "报告.docx")' },
        title: { type: 'string', description: 'Document title (heading)' },
        content: { type: 'string', description: 'Document content in Markdown format. Use # for headings, - for lists, **bold** for emphasis.' }
      },
      required: ['filename', 'title', 'content']
    }
  },
  {
    name: 'generate_pdf',
    description: 'Generate a PDF document and save it to the desktop. Use this when the user wants a PDF file.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The filename (e.g., "文档.pdf")' },
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Document content in plain text with simple formatting.' }
      },
      required: ['filename', 'title', 'content']
    }
  }
];

/** Convert tools array to OpenAI-compatible format */
function getOpenAITools() {
  return SYSTEM_TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}

/** Check if a tool requires user confirmation */
function toolRequiresConfirmation(toolName) {
  const tool = SYSTEM_TOOLS.find(t => t.name === toolName);
  return tool ? tool.requiresConfirmation : true;
}

/** Execute a tool call and return the result string */
async function executeToolCall(toolName, args) {
  try {
    switch (toolName) {
      case 'desktop_write_file': {
        const { filename, content } = args;
        const filePath = path.join(DESKTOP_PATH, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        return `文件已保存到桌面: ${filePath}`;
      }

      case 'write_file': {
        const { path: filePath, content } = args;
        // Create parent directories if they don't exist
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        return `文件已保存: ${filePath}`;
      }

      case 'read_file': {
        const { path: filePath } = args;
        if (!fs.existsSync(filePath)) {
          return `文件不存在: ${filePath}`;
        }
        const maxSize = 100 * 1024; // 100KB limit
        const stat = fs.statSync(filePath);
        if (stat.size > maxSize) {
          return `文件过大 (${(stat.size / 1024).toFixed(0)}KB)，只读取了前 100KB:\n\n` + fs.readFileSync(filePath, 'utf-8').slice(0, maxSize);
        }
        return fs.readFileSync(filePath, 'utf-8');
      }

      case 'list_directory': {
        const { path: dirPath } = args;
        if (!fs.existsSync(dirPath)) {
          return `目录不存在: ${dirPath}`;
        }
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines = items.map(item => {
          const type = item.isDirectory() ? '📁' : (item.isFile() ? '📄' : '🔗');
          return `${type} ${item.name}`;
        });
        return `目录: ${dirPath}\n共 ${items.length} 项:\n` + lines.join('\n');
      }

      case 'run_command': {
        const { command } = args;
        const output = execSync(command, {
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 5000
        });
        const truncated = output.length > 5000 ? output.slice(0, 5000) + '\n... (输出已截断)' : output;
        return truncated || '(命令执行成功，无输出)';
      }

      case 'get_system_info': {
        const { detail = 'basic' } = args;
        const info = {
          platform: os.platform(),
          hostname: os.hostname(),
          arch: os.arch(),
          release: os.release(),
          homedir: os.homedir(),
          desktopPath: DESKTOP_PATH,
          cpus: os.cpus().length,
          totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
          freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
          uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`
        };
        if (detail === 'all') {
          info.loadavg = os.loadavg();
          info.userInfo = os.userInfo();
          info.networkInterfaces = Object.keys(os.networkInterfaces()).length;
        }
        return JSON.stringify(info, null, 2);
      }

      case 'open_url': {
        const { url } = args;
        execSync(`open "${url.replace(/"/g, '\\"')}"`, { timeout: 5000 });
        return `已在浏览器中打开: ${url}`;
      }

      case 'get_desktop_path': {
        return DESKTOP_PATH;
      }

      case 'generate_docx': {
        const { filename: docxFilename, title: docxTitle, content: docxContent } = args;
        const { Document: DocxDocument, Packer: DocxPacker, Paragraph: DocxParagraph, TextRun: DocxTextRun, HeadingLevel, AlignmentType } = require('docx');

        const lines = docxContent.split('\n');
        const children = [];

        // Title
        children.push(new DocxParagraph({
          children: [new DocxTextRun({ text: docxTitle, size: 36, bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }));

        for (const line of lines) {
          if (!line.trim()) {
            children.push(new DocxParagraph({ spacing: { after: 60 } }));
            continue;
          }
          const h1 = line.match(/^#\s+(.+)/);
          if (h1) {
            children.push(new DocxParagraph({
              children: [new DocxTextRun({ text: h1[1], size: 28, bold: true })],
              spacing: { before: 200, after: 100 },
            }));
            continue;
          }
          const h2 = line.match(/^##\s+(.+)/);
          if (h2) {
            children.push(new DocxParagraph({
              children: [new DocxTextRun({ text: h2[1], size: 24, bold: true })],
              spacing: { before: 160, after: 80 },
            }));
            continue;
          }
          const bullet = line.match(/^[-*+]\s+(.+)/);
          if (bullet) {
            children.push(new DocxParagraph({
              children: [new DocxTextRun({ text: '• ' + bullet[1], size: 22 })],
              spacing: { after: 60 },
              indent: { left: 400 },
            }));
            continue;
          }
          children.push(new DocxParagraph({
            children: [new DocxTextRun({ text: line, size: 22 })],
            spacing: { after: 80 },
          }));
        }

        const doc = new DocxDocument({
          sections: [{
            properties: {
              page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
            },
            children,
          }],
        });

        const buffer = await DocxPacker.toBuffer(doc);
        const filePath = path.join(DESKTOP_PATH, docxFilename);
        fs.writeFileSync(filePath, buffer);
        return `Word 文档已生成并保存到桌面: ${filePath}`;
      }

      case 'generate_pdf': {
        const { filename: pdfFilename, title: pdfTitle, content: pdfContent } = args;
        const PDFDocument = require('pdfkit');

        const filePath = path.join(DESKTOP_PATH, pdfFilename);
        const doc = new PDFDocument({ size: 'A4', margin: 72 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Title
        doc.font('Helvetica-Bold').fontSize(24).text(pdfTitle, { align: 'center' });
        doc.moveDown(1.5);

        // Content - simple Markdown parsing
        const lines2 = pdfContent.split('\n');
        for (const line2 of lines2) {
          if (!line2.trim()) { doc.moveDown(0.5); continue; }
          const h1m = line2.match(/^#\s+(.+)/);
          if (h1m) {
            doc.font('Helvetica-Bold').fontSize(18).text(h1m[1]);
            doc.moveDown(0.5);
            continue;
          }
          const h2m = line2.match(/^##\s+(.+)/);
          if (h2m) {
            doc.font('Helvetica-Bold').fontSize(15).text(h2m[1]);
            doc.moveDown(0.3);
            continue;
          }
          const bm = line2.match(/^[-*+]\s+(.+)/);
          if (bm) {
            doc.font('Helvetica').fontSize(11).text('  •  ' + bm[1]);
            doc.moveDown(0.2);
            continue;
          }
          doc.font('Helvetica').fontSize(11).text(line2);
          doc.moveDown(0.3);
        }

        doc.end();

        await new Promise((resolve) => stream.on('finish', resolve));
        return `PDF 文档已生成并保存到桌面: ${filePath}`;
      }

      default:
        return `未知工具: ${toolName}`;
    }
  } catch (err) {
    return `工具执行出错 (${toolName}): ${err.message}`;
  }
}

/* ─── IPC handlers ─── */
ipcMain.handle('send-message', async (_event, data) => {
  let provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key呢！请在右上角⚙️设置中输入API Key~`;
  }

  // Support both string (legacy) and {text, images} format
  const message = typeof data === 'string' ? data : (data.text || '');
  const images = typeof data === 'object' && Array.isArray(data.images) ? data.images : [];

  // Auto-switch to vision-capable provider when images present
  let visionSwitched = false;
  if (images.length > 0 && !provider.supportsVision) {
    const providers = getModelProviders();
    const visionProvider = providers.find(p => p.supportsVision && p.apiKey);
    if (visionProvider) {
      const oldName = provider.name;
      provider = visionProvider;
      store.set('activeModelProviderId', visionProvider.id);
      visionSwitched = true;
      console.log(`🔄 检测到图片，自动切换到 ${visionProvider.name} (${visionProvider.modelName})`);
    } else {
      return `📷 检测到图片，但当前${provider.name}不支持图片分析，且没有找到配置了API Key的视觉模型。\n\n请在⚙️设置中添加 SiliconFlow 的 API Key（你已有 sk-b03a... 开头的 Key）或配置 OpenAI 的 Key。`;
    }
  }

  const { conv, convs } = getActiveConversation();
  const history = conv.messages || [];

  let searchContext = null;
  if (store.get('searchEnabled')) {
    if (isWeatherQuery(message)) {
      const weatherData = await fetchWeatherData();
      if (weatherData) {
        searchContext = weatherData;
      }
    }
    if (!searchContext) {
      const results = await performWebSearch(message);
      if (results) {
        searchContext = formatSearchContext(message, results);
      }
    }
  }

  // Build user message content — simple string or vision array
  const userContent = images.length > 0
    ? [
        { type: 'text', text: message || '请分析以上图片' },
        ...images.map(img => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
        }))
      ]
    : message;

  const messages = [buildSystemPrompt(searchContext), ...history, { role: 'user', content: userContent }];
  const recentHistory = messages.slice(-30);

  try {
    const reply = await callAIWithTools(recentHistory);
    // Store simplified text version in conversation history
    const displayText = images.length > 0
      ? `📷 ${images.map(i => i.fileName).join(', ')}${message ? '\n\n' + message : ''}`
      : message;
    conv.messages.push({ role: 'user', content: displayText });
    conv.messages.push({ role: 'assistant', content: reply });

    if (conv.title === '新对话') {
      const summary = await generateConversationTitle(displayText, reply);
      conv.title = summary || (displayText ? displayText.slice(0, 20) + (displayText.length > 20 ? '...' : '') : '新对话');
    }

    conv.updatedAt = new Date().toISOString();
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    saveConversations(convs);
    return visionSwitched
      ? `🔀 已自动切换到 ${provider.name}（支持图片分析）\n\n${reply}`
      : reply;
  } catch (err) {
    const providerName = visionSwitched ? provider.name : (getActiveModelProvider().name);
    return `出错了 (${providerName}): ${err.message}\n\n请检查：\n1. API Key 是否正确\n2. 模型 "${provider.modelName}" 是否支持图片分析\n3. API 端点是否正确`;
  }
});

ipcMain.handle('analyze-file', async (_event, filePath) => {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

  // Handle images with vision API
  if (IMAGE_EXTS.includes(ext)) {
    let provider = getActiveModelProvider();

    // Auto-switch to vision-capable provider if current one doesn't support vision
    if (!provider.supportsVision) {
      const providers = getModelProviders();
      const visionProvider = providers.find(p => p.supportsVision && p.apiKey);
      if (visionProvider) {
        provider = visionProvider;
        store.set('activeModelProviderId', visionProvider.id);
      } else {
        return `📷 这是一张图片，但当前${provider.name}不支持图片分析呢~\n\n请在⚙️设置中选择 "OpenAI / ChatGPT" 或 "SiliconFlow (支持图片)" 并配置API Key，就能分析图片啦~`;
      }
    }

    if (!provider.apiKey) {
      return `你还没设置${provider.name}的API Key呢！请先在聊天窗口设置API Key~`;
    }

    const stat = fs.statSync(filePath);
    if (stat.size > MAX_IMAGE_SIZE) {
      return `图片太大啦 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，我吃不下超过5MB的图片~ 压缩一下再给我吧 🥺`;
    }
    const imageBuffer = fs.readFileSync(filePath);
    const mimeType = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;

    const messages = [
      buildSystemPrompt(),
      {
        role: 'user',
        content: [
          { type: 'text', text: `主人给你丢了一张图片"${fileName}"！请分析这张图片的内容，告诉主人这张图片是什么~` },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } }
        ]
      }
    ];

    try {
      const reply = await callAIWithTools(messages);
      const { conv, convs } = getActiveConversation();
      conv.messages.push({ role: 'user', content: `📷 拖入图片: ${fileName}` });
      conv.messages.push({ role: 'assistant', content: reply });
      if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
      if (conv.title === '新对话') {
        const summary = await generateConversationTitle(`用户导入图片: ${fileName}`, reply);
        conv.title = summary || `图片分析: ${fileName}`;
      }
      conv.updatedAt = new Date().toISOString();
      saveConversations(convs);
      if (chatWindow) chatWindow.webContents.send('messages-updated');
      return reply;
    } catch (err) {
      return `分析图片时出错了: ${err.message}`;
    }
  }

  const content = await readFileContent(filePath);

  if (content === null) {
    const theme = getTheme(store.get('activeTheme') || 'claude');
    return `${theme.name}还不支持"${path.extname(filePath)}"这种文件格式哦，试试 .txt / .pdf / .docx 文件吧~`;
  }

  if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
    return content;
  }

  const maxContent = content.slice(0, 20000);
  const truncated = content.length > 20000 ? '\n\n(文件太长了，只读取了前20000字哦)' : '';

  const messages = [
    buildSystemPrompt(),
    {
      role: 'user',
      content: `主人给你丢了一个文件过来！文件名是"${fileName}"。\n\n请帮主人分析总结这个文件的内容:\n\n${maxContent}${truncated}\n\n请回复: 先用可爱的语气告诉主人文件是什么类型的，然后用清晰的结构总结文档的核心内容。`
    }
  ];

  try {
    const reply = await callAISimple(messages);
    const { conv, convs } = getActiveConversation();
    conv.messages.push({ role: 'user', content: `📄 拖入文件: ${fileName}` });
    conv.messages.push({ role: 'assistant', content: reply });
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    if (conv.title === '新对话') {
      const summary = await generateConversationTitle(
        `用户导入文件: ${fileName}`, reply
      );
      conv.title = summary || `文件分析: ${fileName}`;
    }
    conv.updatedAt = new Date().toISOString();
    saveConversations(convs);

    if (chatWindow) chatWindow.webContents.send('messages-updated');

    return reply;
  } catch (err) {
    return `分析文件时出错了: ${err.message}`;
  }
});

ipcMain.handle('get-history', () => {
  const { conv } = getActiveConversation();
  return conv.messages || [];
});

ipcMain.handle('new-conversation', () => {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  const activeConv = convs.find(c => c.id === activeId);

  // If current conversation is empty, just reuse it — don't create a new one
  if (activeConv && (!activeConv.messages || activeConv.messages.length === 0)) {
    return getConversationList();
  }

  const newConv = {
    id: generateId(),
    title: '新对话',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  convs.push(newConv);
  saveConversations(convs);
  store.set('activeConversationId', newConv.id);
  return getConversationList();
});

ipcMain.handle('clear-history', () => {
  // Backward compat: same logic as new-conversation
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  const activeConv = convs.find(c => c.id === activeId);

  if (activeConv && (!activeConv.messages || activeConv.messages.length === 0)) {
    return true;
  }

  const newConv = {
    id: generateId(),
    title: '新对话',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  convs.push(newConv);
  saveConversations(convs);
  store.set('activeConversationId', newConv.id);
  return true;
});

ipcMain.handle('get-conversations', () => {
  return getConversationList();
});

ipcMain.handle('get-all-conversations', () => {
  const convs = getConversations();
  return convs.map(c => ({
    id: c.id,
    title: c.title || '新对话',
    messages: (c.messages || []).slice(-100),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
});

ipcMain.handle('get-active-conversation-id', () => {
  return store.get('activeConversationId');
});

ipcMain.handle('switch-conversation', (_event, id) => {
  const convs = getConversations();
  if (convs.some(c => c.id === id)) {
    store.set('activeConversationId', id);
    return true;
  }
  return false;
});

ipcMain.handle('delete-conversation', (_event, id) => {
  const convs = getConversations();
  if (convs.length <= 1) return false;
  const idx = convs.findIndex(c => c.id === id);
  if (idx >= 0) {
    convs.splice(idx, 1);
    saveConversations(convs);
    if (store.get('activeConversationId') === id) {
      store.set('activeConversationId', convs[0].id);
    }
    return true;
  }
  return false;
});

ipcMain.handle('read-pending-files', async (_event, filePaths) => {
  const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB limit for images
  const results = [];
  for (const filePath of filePaths) {
    try {
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      // Images — read as base64 for vision API support
      if (IMAGE_EXTS.includes(ext)) {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_IMAGE_SIZE) {
          results.push({ fileName, content: `[图片过大: ${fileName} (${(stat.size / 1024 / 1024).toFixed(1)}MB，限制5MB)]`, error: '图片过大', isImage: true });
          continue;
        }
        const imageBuffer = fs.readFileSync(filePath);
        const mimeType = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;
        results.push({
          fileName,
          content: `[这是一张图片: ${fileName}]`,
          error: null,
          isImage: true,
          base64: imageBuffer.toString('base64'),
          mimeType
        });
        continue;
      }

      const content = await readFileContent(filePath);
      if (content === null) {
        results.push({ fileName, content: null, error: `不支持 ${ext} 格式` });
      } else if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
        results.push({ fileName, content: null, error: content });
      } else {
        const maxContent = content.slice(0, 10000);
        const truncated = content.length > 10000 ? '\n\n(文件较长，只展示了前10000字)' : '';
        results.push({ fileName, content: maxContent + truncated, error: null });
      }
    } catch (err) {
      results.push({ fileName: path.basename(filePath), content: null, error: err.message });
    }
  }
  return results;
});

ipcMain.handle('import-dropped-file', async (_event, filePath) => {
  try {
    const fileName = path.basename(filePath);
    const content = await readFileContent(filePath);

    if (content === null) {
      return { success: false, error: `不支持 ${path.extname(filePath)} 格式` };
    }
    if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
      return { success: false, error: content };
    }

    const maxContent = content.slice(0, 10000);
    const truncated = content.length > 10000 ? '\n\n(文件较长，只截取了前10000字)' : '';

    // Add file as context to the active conversation
    const { conv, convs } = getActiveConversation();
    conv.messages.push({
      role: 'user',
      content: `[用户导入了文件: ${fileName}]\n\n${maxContent}${truncated}\n\n---\n用户接下来会告诉你如何处理这个文件，请按他的指令操作。`
    });
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    conv.updatedAt = new Date().toISOString();
    saveConversations(convs);

    if (chatWindow) chatWindow.webContents.send('messages-updated');

    return { success: true, fileName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('import-file', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: '导入文档',
    filters: [
      { name: '文档文件', extensions: ['txt', 'md', 'pdf', 'docx', 'json', 'csv', 'xml', 'yaml', 'yml', 'log'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const content = await readFileContent(filePath);

  if (content === null) {
    return { fileName, content: null, error: `不支持的文件格式: ${path.extname(filePath)}` };
  }

  if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
    return { fileName, content: null, error: content };
  }

  const truncated = content.slice(0, 20000);
  return { fileName, content: truncated };
});

/* ─── Model Provider IPC ─── */
ipcMain.handle('get-model-providers', () => {
  ensurePresetProviders();
  return getModelProviders();
});

ipcMain.handle('save-model-provider', (_event, provider) => {
  const providers = getModelProviders();
  const idx = providers.findIndex(p => p.id === provider.id);
  if (idx >= 0) {
    providers[idx] = { ...providers[idx], ...provider };
  } else {
    providers.push(provider);
  }
  saveModelProviders(providers);
  return true;
});

ipcMain.handle('delete-model-provider', (_event, id) => {
  const providers = getModelProviders();
  const provider = providers.find(p => p.id === id);
  if (!provider || provider.type === 'preset') return false;
  const idx = providers.findIndex(p => p.id === id);
  if (idx >= 0) {
    providers.splice(idx, 1);
    saveModelProviders(providers);
    if (store.get('activeModelProviderId') === id) {
      store.set('activeModelProviderId', providers[0]?.id || 'deepseek');
    }
    return true;
  }
  return false;
});

ipcMain.handle('get-active-model-provider', () => {
  return getActiveModelProvider();
});

ipcMain.handle('set-active-model-provider', (_event, id) => {
  const providers = getModelProviders();
  if (providers.some(p => p.id === id)) {
    store.set('activeModelProviderId', id);
    return getActiveModelProvider();
  }
  return null;
});

ipcMain.handle('validate-model-api-key', async (_event, providerId) => {
  return await validateModelApiKey(providerId);
});

ipcMain.handle('toggle-search', () => {
  const current = store.get('searchEnabled');
  store.set('searchEnabled', !current);
  return !current;
});

ipcMain.handle('get-search-enabled', () => {
  return store.get('searchEnabled');
});

ipcMain.handle('save-personality', (_event, text) => {
  store.set('personalityPrompt', text.trim());
  return true;
});

ipcMain.handle('get-personality', () => {
  return store.get('personalityPrompt') || '';
});

ipcMain.handle('get-theme', () => {
  const themeId = store.get('activeTheme') || 'claude';
  return getTheme(themeId);
});

ipcMain.handle('set-theme', (_event, themeId) => {
  const theme = getTheme(themeId);
  if (!theme) return false;
  store.set('activeTheme', themeId);
  if (petWindow) petWindow.webContents.send('theme-changed', theme);
  if (chatWindow) chatWindow.webContents.send('theme-changed', theme);
  return true;
});

ipcMain.on('open-chat', () => {
  if (isChatVisible) {
    hideChatWindow();
  } else {
    showChatWindow();
    if (chatWindow) chatWindow.webContents.send('focus-input');
  }
});

ipcMain.on('show-chat', () => {
  if (!isChatVisible) {
    showChatWindow();
  }
  if (chatWindow) chatWindow.webContents.send('focus-input');
});

ipcMain.on('resize-window', (_event, width, height) => {
  if (!chatWindow) return;
  const { width: scrW, height: scrH } = screen.getPrimaryDisplay().workAreaSize;
  const minH = Math.round(scrH * 0.7);
  chatWidth = Math.max(360, Math.round(width));
  chatHeight = Math.max(minH, Math.round(height));
  chatWindow.setBounds({
    x: scrW - chatWidth,
    y: chatWindow.getBounds().y,
    width: chatWidth,
    height: chatHeight
  });
});

ipcMain.on('close-chat', () => {
  hideChatWindow();
});

ipcMain.on('save-position', () => {
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    store.set('petPosition', { x, y });
  }
});

ipcMain.on('move-window', (_event, dx, dy) => {
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    petWindow.setPosition(x + dx, y + dy);
  }
});

ipcMain.on('resize-pet', (_event, width, height) => {
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    petWindow.setBounds({ x, y, width, height });
  }
});

ipcMain.on('minimize-chat', () => {
  hideChatWindow();
});

ipcMain.on('set-expression', (_event, name) => {
  if (petWindow) {
    petWindow.webContents.executeJavaScript(`setPetExpression('${name}')`);
  }
});

ipcMain.on('quit-app', () => {
  if (petWindow) {
    const pos = petWindow.getPosition();
    store.set('petPosition', { x: pos[0], y: pos[1] });
  }
  app.quit();
});

/* ─── Tool Confirmation IPC ─── */
ipcMain.handle('confirm-tool-response', (_event, { toolCallId, confirmed }) => {
  const pending = pendingToolConfirmations.get(toolCallId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingToolConfirmations.delete(toolCallId);
    pending.resolve(confirmed);
  }
  return true;
});

ipcMain.handle('get-system-tools', () => {
  return SYSTEM_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    requiresConfirmation: t.requiresConfirmation,
    parameters: t.parameters
  }));
});

/* ─── App lifecycle ─── */
app.whenReady().then(() => {
  // Migrate old single apiKey to modelProviders array
  const oldApiKey = store.get('apiKey');
  if (oldApiKey !== undefined) {
    const providers = store.get('modelProviders');
    if (!providers || providers.length === 0) {
      store.set('modelProviders', [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          type: 'preset',
          apiKey: oldApiKey || '',
          apiBaseUrl: 'https://api.deepseek.com/chat/completions',
          modelName: 'deepseek-chat',
          order: 0
        }
      ]);
      store.set('activeModelProviderId', 'deepseek');
    }
    store.delete('apiKey');
  }

  // Migrate old chatHistory to new conversations model
  const conversations = store.get('conversations');
  if (!conversations || conversations.length === 0) {
    const oldHistory = store.get('chatHistory');
    if (oldHistory && oldHistory.length > 0) {
      const migratedConv = {
        id: generateId(),
        title: '历史对话',
        messages: oldHistory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.set('conversations', [migratedConv]);
      store.set('activeConversationId', migratedConv.id);
      store.delete('chatHistory');
    }
  }
  // Clean up any leftover chatHistory key from old data model
  if (store.get('chatHistory') !== undefined) {
    store.delete('chatHistory');
  }

  createPetWindow();
  createChatWindow();

  // Auto-show chat after a brief delay
  setTimeout(() => {
    showChatWindow();
    // Focus the input when chat appears
    if (chatWindow && chatWindow.webContents) {
      chatWindow.webContents.focus();
    }
  }, 500);

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  });
});

app.on('window-all-closed', () => {
  // Keep app running in background
});

app.on('activate', () => {
  if (petWindow === null) createPetWindow();
});

app.on('before-quit', () => {
  // Save position before quitting
  if (petWindow) {
    const pos = petWindow.getPosition();
    store.set('petPosition', { x: pos[0], y: pos[1] });
  }
});
