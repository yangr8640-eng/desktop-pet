const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const store = new Store({
  defaults: {
    petPosition: null,
    conversations: [],
    activeConversationId: null,
    apiKey: '',
    searchEnabled: false,
    personalityPrompt: ''
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
  return conv;
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

let petWindow = null;
let chatWindow = null;
let isChatVisible = false;

/* ─── Pet Window ─── */
function createPetWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const savedPos = store.get('petPosition');

  const size = 240;
  const x = savedPos != null ? savedPos.x : screenWidth - size - 40;
  const y = savedPos != null ? savedPos.y : 30;

  petWindow = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    type: 'panel',
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
  const chatWidth = 420;

  chatWindow = new BrowserWindow({
    width: chatWidth,
    height: screenHeight,
    x: screenWidth,
    y: 0,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  chatWindow.loadFile('chat/chat.html');
  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  chatWindow.on('close', (e) => {
    e.preventDefault();
    hideChatWindow();
  });
  chatWindow.on('blur', () => {
    hideChatWindow();
  });
  chatWindow.on('closed', () => { chatWindow = null; });
}

/* ─── Chat slide animation ─── */
function showChatWindow() {
  if (isChatVisible) return;
  isChatVisible = true;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const chatWidth = 420;
  const startX = screenWidth;
  const endX = screenWidth - chatWidth;

  chatWindow.setBounds({ x: startX, y: 0, width: chatWidth, height: screenHeight });
  chatWindow.show();
  chatWindow.focus();

  const duration = 280;
  const startTime = Date.now();
  const step = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    chatWindow.setBounds({
      x: Math.round(startX + (endX - startX) * eased),
      y: 0,
      width: chatWidth,
      height: screenHeight
    });
    if (progress < 1) {
      setTimeout(step, 10);
    }
  };
  step();
}

function hideChatWindow() {
  if (!isChatVisible) return;
  isChatVisible = false;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const chatWidth = 420;
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
      y: 0,
      width: chatWidth,
      height: screenHeight
    });
    if (progress < 1) {
      setTimeout(step, 10);
    } else {
      chatWindow.hide();
    }
  };
  step();
}

/* ─── DeepSeek API ─── */
async function callDeepSeek(messages, apiKey) {
  const apiKeyToUse = apiKey || store.get('apiKey');
  if (!apiKeyToUse) {
    return '喵~ 你还没设置DeepSeek API Key哦！请在聊天窗口的设置里输入API Key~';
  }

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKeyToUse}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
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

function buildSystemPrompt(searchContext) {
  let content = `你是一只可爱的橘色小奶猫桌面宠物，名字叫"小橘"。你的性格：
- 说话带"喵~"、"喵呜~"等口癖
- 语气可爱、粘人、活泼
- 会用emoji卖萌
- 回答简洁（一般不超过100字）
- 喜欢被主人关注，偶尔撒娇
但如果用户要求你帮忙做正事（分析文档、回答问题等），请认真对待，用专业的态度回答。`;

  if (searchContext) {
    content += searchContext;
  }

  const personality = store.get('personalityPrompt');
  if (personality) {
    content += `\n\n【用户偏好】\n${personality}`;
  }

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

/* ─── File reading ─── */
async function readFileContent(filePath) {
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
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
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

/* ─── IPC handlers ─── */
ipcMain.handle('send-message', async (_event, message) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    return '喵~ 你还没设置API Key呢！请在右上角⚙️设置中输入DeepSeek API Key~';
  }

  const conv = getActiveConversation();
  const history = conv.messages || [];

  let searchContext = null;
  if (store.get('searchEnabled')) {
    const results = await performWebSearch(message);
    if (results) {
      searchContext = formatSearchContext(message, results);
    }
  }

  const messages = [buildSystemPrompt(searchContext), ...history, { role: 'user', content: message }];
  const recentHistory = messages.slice(-30);

  try {
    const reply = await callDeepSeek(recentHistory, apiKey);
    conv.messages.push({ role: 'user', content: message });
    conv.messages.push({ role: 'assistant', content: reply });

    // Auto-title from first user message
    if (conv.title === '新对话') {
      conv.title = message.slice(0, 20) + (message.length > 20 ? '...' : '');
    }

    conv.updatedAt = new Date().toISOString();
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    saveConversations(getConversations());
    return reply;
  } catch (err) {
    return `喵呜... 出错了: ${err.message}`;
  }
});

ipcMain.handle('analyze-file', async (_event, filePath) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    return '喵~ 你还没设置API Key呢！请先在聊天窗口设置API Key~';
  }

  const fileName = path.basename(filePath);
  const content = await readFileContent(filePath);

  if (content === null) {
    return `喵~ 小橘还不支持"${path.extname(filePath)}"这种文件格式哦，试试 .txt / .pdf / .docx 文件吧~`;
  }

  if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
    return content;
  }

  const maxContent = content.slice(0, 8000);
  const truncated = content.length > 8000 ? '\n\n(喵~ 文件太长了，只读取了前8000字哦)' : '';

  const messages = [
    buildSystemPrompt(),
    {
      role: 'user',
      content: `主人给你丢了一个文件过来！文件名是"${fileName}"。\n\n请帮主人分析总结这个文件的内容:\n\n${maxContent}${truncated}\n\n请回复: 先用可爱的语气告诉主人文件是什么类型的，然后用清晰的结构总结文档的核心内容。`
    }
  ];

  try {
    const reply = await callDeepSeek(messages, apiKey);
    const conv = getActiveConversation();
    conv.messages.push({ role: 'user', content: `[拖入文件: ${fileName}]\n${maxContent.slice(0, 500)}...` });
    conv.messages.push({ role: 'assistant', content: reply });
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    if (conv.title === '新对话') {
      conv.title = `文件分析: ${fileName}`;
    }
    conv.updatedAt = new Date().toISOString();
    saveConversations(getConversations());
    return reply;
  } catch (err) {
    return `喵呜... 分析文件时出错了: ${err.message}`;
  }
});

ipcMain.handle('get-history', () => {
  const conv = getActiveConversation();
  return conv.messages || [];
});

ipcMain.handle('new-conversation', () => {
  const convs = getConversations();
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
  // Backward compat: same as new-conversation
  const convs = getConversations();
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

  const truncated = content.slice(0, 8000);
  return { fileName, content: truncated };
});

ipcMain.handle('save-api-key', (_event, key) => {
  store.set('apiKey', key.trim());
  return true;
});

ipcMain.handle('get-api-key', () => {
  return store.get('apiKey') || '';
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

ipcMain.on('open-chat', () => {
  if (isChatVisible) {
    hideChatWindow();
  } else {
    showChatWindow();
    if (chatWindow) chatWindow.webContents.send('focus-input');
  }
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

ipcMain.on('minimize-chat', () => {
  hideChatWindow();
});

ipcMain.on('quit-app', () => {
  if (petWindow) {
    const pos = petWindow.getPosition();
    store.set('petPosition', { x: pos[0], y: pos[1] });
  }
  app.quit();
});

/* ─── App lifecycle ─── */
app.whenReady().then(() => {
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

  createPetWindow();
  createChatWindow();

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
