const { ipcMain, screen, app, dialog, Notification, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { store, generateId, getConversations, saveConversations, getActiveConversation, getConversationList, ensurePresetProviders, getModelProviders, saveModelProviders, getActiveModelProvider } = require('./store');
const { callAI, callAIStream, callAIStreamWithRetry, cancelActiveStream, validateModelApiKey, generateConversationTitle, buildSystemPrompt, callAISimple, callAIWithTools, SYSTEM_TOOLS, getOpenAITools, executeToolCall, requestToolConfirmation, pendingToolConfirmations } = require('./ai');
const { performWebSearch, formatSearchContext, isWeatherQuery, fetchWeatherData } = require('./search');
const { readFileContent } = require('./file-reader');
const { getPetWindow, getChatWindow, getChatVisible, showChatWindow, hideChatWindow, setQuitting } = require('./windows');
const { getTheme } = require('../themes');
const { destroyTray } = require('./tray');

function registerIpcHandlers() {

  function sendReplyNotification(fullContent) {
    if (!Notification.isSupported()) return;
    const chatWindow = getChatWindow();
    if (!chatWindow || (getChatVisible() && !chatWindow.isMinimized())) return;

    const preview = fullContent.slice(0, 100) + (fullContent.length > 100 ? '...' : '');
    const theme = getTheme(store.get('activeTheme') || 'claude');

    const notification = new Notification({
      title: `${theme.emoji} ${theme.name} 回复了`,
      body: preview,
      silent: true
    });

    notification.on('click', () => {
      if (!getChatVisible()) showChatWindow();
    });
  }

  /* ─── AI Chat (with Tool Calling) ─── */
  ipcMain.on('send-message', async (event, data) => {
    let provider = getActiveModelProvider();

    // Support both string (legacy) and {text, images} format
    const message = typeof data === 'string' ? data : (data.text || '');
    const images = typeof data === 'object' && Array.isArray(data.images) ? data.images : [];

    // Auto-switch to vision-capable provider when images present
    let visionSwitched = false;
    if (images.length > 0 && !provider.supportsVision) {
      const providers = getModelProviders();
      const visionProvider = providers.find(p => p.supportsVision && p.apiKey);
      if (visionProvider) {
        provider = visionProvider;
        store.set('activeModelProviderId', visionProvider.id);
        visionSwitched = true;
        console.log(`🔄 检测到图片，自动切换到 ${visionProvider.name} (${visionProvider.modelName})`);
      } else {
        event.sender.send('stream-chunk', {
          text: `📷 检测到图片，但当前${provider.name}不支持图片分析，且没有找到配置了API Key的视觉模型。\n\n请在⚙️设置中添加 SiliconFlow 的 API Key 或配置 OpenAI 的 Key。`,
          done: true, error: true
        });
        return;
      }
    }

    if (!provider.apiKey) {
      event.sender.send('stream-chunk', {
        text: `你还没设置${provider.name}的API Key呢！请在右上角⚙️设置中输入API Key~`,
        done: true, error: true
      });
      return;
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

    // Store simplified text version in conversation history
    const displayText = images.length > 0
      ? `📷 ${images.map(i => i.fileName).join(', ')}${message ? '\n\n' + message : ''}`
      : message;

    // Persist user message BEFORE API call — survives failures
    conv.messages.push({ role: 'user', content: displayText });
    conv.updatedAt = new Date().toISOString();
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    saveConversations(convs);

    try {
      // Use tool calling for all messages
      const reply = await callAIWithTools(messages);
      conv.messages.push({ role: 'assistant', content: reply });

      if (conv.title === '新对话') {
        const summary = await generateConversationTitle(displayText, reply);
        conv.title = summary || (displayText ? displayText.slice(0, 20) + (displayText.length > 20 ? '...' : '') : '新对话');
      }

      conv.updatedAt = new Date().toISOString();
      if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
      saveConversations(convs);

      // Send the complete response as a stream-chunk (compatible with existing frontend)
      const result = visionSwitched
        ? `🔀 已自动切换到 ${provider.name}（支持图片分析）\n\n${reply}`
        : reply;
      event.sender.send('stream-chunk', { text: result, done: true });
      sendReplyNotification(result);
    } catch (err) {
      const providerName = visionSwitched ? provider.name : (getActiveModelProvider().name);
      event.sender.send('stream-chunk', {
        text: `出错了 (${providerName}): ${err.message}\n\n请检查：\n1. API Key 是否正确\n2. 模型 "${provider.modelName}" 是否支持图片分析\n3. API 端点是否正确`,
        done: true, error: true
      });
    }
  });

  /* ─── File Analysis ─── */
  ipcMain.on('analyze-file', async (event, filePath) => {
    let provider = getActiveModelProvider();
    const chatWindow = getChatWindow();
    if (!chatWindow) return;

    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

    // Handle images with vision API
    if (IMAGE_EXTS.includes(ext)) {
      // Auto-switch to vision-capable provider if current one doesn't support vision
      if (!provider.supportsVision) {
        const providers = getModelProviders();
        const visionProvider = providers.find(p => p.supportsVision && p.apiKey);
        if (visionProvider) {
          provider = visionProvider;
          store.set('activeModelProviderId', visionProvider.id);
        } else {
          chatWindow.webContents.send('stream-chunk', {
            text: `📷 这是一张图片，但当前${provider.name}不支持图片分析呢~\n\n请在⚙️设置中选择 "OpenAI / ChatGPT" 或 "SiliconFlow (支持图片)" 并配置API Key，就能分析图片啦~`,
            done: true, error: true
          });
          return;
        }
      }

      if (!provider.apiKey) {
        chatWindow.webContents.send('stream-chunk', {
          text: `你还没设置${provider.name}的API Key呢！请先在聊天窗口设置API Key~`,
          done: true, error: true
        });
        return;
      }

      const stat = fs.statSync(filePath);
      if (stat.size > MAX_IMAGE_SIZE) {
        chatWindow.webContents.send('stream-chunk', {
          text: `图片太大啦 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，我吃不下超过5MB的图片~ 压缩一下再给我吧 🥺`,
          done: true, error: true
        });
        return;
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
        chatWindow.webContents.send('messages-updated');
        chatWindow.webContents.send('stream-chunk', { text: reply, done: true });
        sendReplyNotification(reply);
      } catch (err) {
        chatWindow.webContents.send('stream-chunk', {
          text: `分析图片时出错了: ${err.message}`,
          done: true, error: true
        });
      }
      return;
    }

    // Non-image file analysis
    if (!provider.apiKey) {
      chatWindow.webContents.send('stream-chunk', {
        text: `你还没设置${provider.name}的API Key呢！请先在聊天窗口设置API Key~`,
        done: true, error: true
      });
      return;
    }

    const content = await readFileContent(filePath);

    if (content === null) {
      const theme = getTheme(store.get('activeTheme') || 'claude');
      chatWindow.webContents.send('stream-chunk', {
        text: `${theme.name}还不支持"${path.extname(filePath)}"这种文件格式哦，试试 .txt / .pdf / .docx 文件吧~`,
        done: true, error: true
      });
      return;
    }

    if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
      chatWindow.webContents.send('stream-chunk', { text: content, done: true, error: true });
      return;
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

    // Persist file reference before API call
    const { conv: fileConv, convs: fileConvs } = getActiveConversation();
    fileConv.messages.push({ role: 'user', content: `📄 拖入文件: ${fileName}` });
    fileConv.updatedAt = new Date().toISOString();
    if (fileConv.messages.length > 100) fileConv.messages.splice(0, fileConv.messages.length - 100);
    saveConversations(fileConvs);

    try {
      const reply = await callAISimple(messages);
      fileConv.messages.push({ role: 'assistant', content: reply });
      if (fileConv.messages.length > 100) fileConv.messages.splice(0, fileConv.messages.length - 100);
      if (fileConv.title === '新对话') {
        const summary = await generateConversationTitle(
          `用户导入文件: ${fileName}`, reply
        );
        fileConv.title = summary || `文件分析: ${fileName}`;
      }
      fileConv.updatedAt = new Date().toISOString();
      saveConversations(fileConvs);

      chatWindow.webContents.send('messages-updated');
      chatWindow.webContents.send('stream-chunk', { text: reply, done: true });
      sendReplyNotification(reply);
    } catch (err) {
      chatWindow.webContents.send('stream-chunk', { text: `分析文件时出错了: ${err.message}`, done: true, error: true });
    }
  });

  /* ─── History & Conversations ─── */
  ipcMain.handle('get-history', () => {
    const { conv } = getActiveConversation();
    return conv.messages || [];
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

  ipcMain.handle('new-conversation', () => {
    const convs = getConversations();
    const activeId = store.get('activeConversationId');
    const activeConv = convs.find(c => c.id === activeId);

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

  /* ─── File Import & Drag-Drop ─── */
  ipcMain.handle('read-pending-files', async (_event, filePaths) => {
    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB limit for images
    const results = [];
    for (const filePath of filePaths) {
      try {
        const fileName = path.basename(filePath);
        // Skip Office temp files
        if (fileName.startsWith('~$') || fileName.startsWith('.~') || fileName.startsWith('~')) {
          continue;
        }
        const ext = path.extname(filePath).toLowerCase();

        if (IMAGE_EXTS.includes(ext)) {
          // Images — read as base64 for vision API support
          try {
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
          } catch (err) {
            results.push({ fileName, content: null, error: `读取图片失败: ${err.message}` });
          }
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
      // Skip Office temp files
      if (fileName.startsWith('~$') || fileName.startsWith('.~') || fileName.startsWith('~')) {
        return { success: false, error: '临时文件已跳过' };
      }
      const ext = path.extname(filePath).toLowerCase();
      const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

      // Images — just mark as imported, vision analysis will handle them via send-message
      if (IMAGE_EXTS.includes(ext)) {
        const { conv, convs } = getActiveConversation();
        conv.messages.push({ role: 'user', content: `📷 拖入图片: ${fileName}` });
        if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
        conv.updatedAt = new Date().toISOString();
        saveConversations(convs);
        return { success: true, fileName, isImage: true };
      }

      const content = await readFileContent(filePath);

      if (content === null) {
        return { success: false, error: `不支持 ${path.extname(filePath)} 格式` };
      }
      if (typeof content === 'string' && content.startsWith('[读取文件失败')) {
        return { success: false, error: content };
      }

      const maxContent = content.slice(0, 10000);
      const truncated = content.length > 10000 ? '\n\n(文件较长，只截取了前10000字)' : '';

      const { conv, convs } = getActiveConversation();
      conv.messages.push({
        role: 'user',
        content: `[用户导入了文件: ${fileName}]\n\n${maxContent}${truncated}\n\n---\n用户接下来会告诉你如何处理这个文件，请按他的指令操作。`
      });
      if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
      conv.updatedAt = new Date().toISOString();
      saveConversations(convs);

      const chatWindow = getChatWindow();
      if (chatWindow) chatWindow.webContents.send('messages-updated');

      return { success: true, fileName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import-file', async () => {
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

  /* ─── Export conversation ─── */
  ipcMain.handle('export-conversation', async () => {
    const { conv } = getActiveConversation();
    if (!conv || !conv.messages || conv.messages.length === 0) {
      return { error: '当前对话为空' };
    }

    const result = await dialog.showSaveDialog({
      title: '导出对话',
      defaultPath: `${conv.title || '对话'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    let md = `# ${conv.title || '对话记录'}\n\n`;
    md += `> 导出时间: ${new Date().toLocaleString()}\n\n---\n\n`;

    for (const msg of conv.messages) {
      const role = msg.role === 'user' ? '🧑 你' : '🤖 AI';
      md += `### ${role}\n\n${msg.content}\n\n---\n\n`;
    }

    fs.writeFileSync(result.filePath, md, 'utf-8');
    return { success: true, filePath: result.filePath };
  });

  /* ─── Regenerate & Edit ─── */
  ipcMain.on('regenerate-message', async (event) => {
    const { conv, convs } = getActiveConversation();
    const history = conv.messages || [];

    if (history.length > 0 && history[history.length - 1].role === 'assistant') {
      history.pop();
    }
    saveConversations(convs);

    const userMessages = history.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      event.sender.send('stream-chunk', { text: '没有可重新生成的消息', done: true, error: true });
      return;
    }

    let searchContext = null;
    const lastUserMsg = userMessages[userMessages.length - 1].content;
    if (store.get('searchEnabled')) {
      if (isWeatherQuery(lastUserMsg)) {
        const weatherData = await fetchWeatherData();
        if (weatherData) searchContext = weatherData;
      }
      if (!searchContext) {
        const results = await performWebSearch(lastUserMsg);
        if (results) searchContext = formatSearchContext(lastUserMsg, results);
      }
    }

    const messages = [buildSystemPrompt(searchContext), ...history];

    try {
      const reply = await callAIWithTools(messages);
      conv.messages.push({ role: 'assistant', content: reply });
      conv.updatedAt = new Date().toISOString();
      if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
      saveConversations(convs);
      event.sender.send('stream-chunk', { text: reply, done: true });
      sendReplyNotification(reply);
    } catch (err) {
      event.sender.send('stream-chunk', { text: `出错了: ${err.message}`, done: true, error: true });
    }
  });

  ipcMain.handle('trim-conversation', (_event, messageIndex) => {
    const { conv, convs } = getActiveConversation();
    conv.messages = conv.messages.slice(0, messageIndex);
    saveConversations(convs);
    return true;
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

  /* ─── Auto Update ─── */
  const { downloadUpdate, quitAndInstall } = require('./updater');
  ipcMain.handle('download-update', async () => {
    downloadUpdate();
    return true;
  });
  ipcMain.handle('quit-and-install', async () => {
    quitAndInstall();
    return true;
  });

  /* ─── Search ─── */
  ipcMain.handle('toggle-search', () => {
    const current = store.get('searchEnabled');
    store.set('searchEnabled', !current);
    return !current;
  });

  ipcMain.handle('get-search-enabled', () => {
    return store.get('searchEnabled');
  });

  /* ─── Auto-launch ─── */
  ipcMain.handle('get-auto-launch', () => {
    return store.get('autoLaunch', true);
  });

  ipcMain.handle('set-auto-launch', (_event, enabled) => {
    store.set('autoLaunch', enabled);
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  /* ─── Personality ─── */
  ipcMain.handle('save-personality', (_event, text) => {
    store.set('personalityPrompt', text.trim());
    return true;
  });

  ipcMain.handle('get-personality', () => {
    return store.get('personalityPrompt') || '';
  });

  /* ─── Theme ─── */
  ipcMain.handle('get-theme', () => {
    const themeId = store.get('activeTheme') || 'claude';
    return getTheme(themeId);
  });

  ipcMain.handle('set-theme', (_event, themeId) => {
    const theme = getTheme(themeId);
    if (!theme) return false;
    store.set('activeTheme', themeId);
    const petWindow = getPetWindow();
    const chatWindow = getChatWindow();
    if (petWindow) petWindow.webContents.send('theme-changed', theme);
    if (chatWindow) chatWindow.webContents.send('theme-changed', theme);
    return true;
  });

  /* ─── Platform ─── */
  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  /* ─── Window Controls ─── */
  ipcMain.on('open-chat', () => {
    if (getChatVisible()) {
      hideChatWindow();
    } else {
      showChatWindow();
      const chatWindow = getChatWindow();
      if (chatWindow) chatWindow.webContents.send('focus-input');
    }
  });

  ipcMain.on('show-chat', () => {
    if (!getChatVisible()) {
      showChatWindow();
    }
    const chatWindow = getChatWindow();
    if (chatWindow) chatWindow.webContents.send('focus-input');
  });

  ipcMain.on('resize-window', (_event, width, height) => {
    const chatWindow = getChatWindow();
    if (!chatWindow) return;
    const { width: scrW, height: scrH } = screen.getPrimaryDisplay().workAreaSize;
    const minH = Math.round(scrH * 0.7);
    const newW = Math.max(420, Math.round(width));
    const newH = Math.max(minH, Math.round(height));
    chatWindow.setBounds({
      x: scrW - newW,
      y: chatWindow.getBounds().y,
      width: newW,
      height: newH
    });
  });

  ipcMain.on('close-chat', () => {
    hideChatWindow();
  });

  ipcMain.on('save-position', () => {
    const petWindow = getPetWindow();
    if (petWindow) {
      const [x, y] = petWindow.getPosition();
      store.set('petPosition', { x, y });
    }
  });

  ipcMain.on('move-window', (_event, dx, dy) => {
    const petWindow = getPetWindow();
    if (petWindow) {
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(x + dx, y + dy);
    }
  });

  ipcMain.on('resize-pet', (_event, width, height) => {
    const petWindow = getPetWindow();
    if (petWindow) {
      const [x, y] = petWindow.getPosition();
      petWindow.setBounds({ x, y, width, height });
    }
  });

  ipcMain.on('minimize-chat', () => {
    hideChatWindow();
  });

  /* ─── Set Expression ─── */
  ipcMain.on('set-expression', (_event, name) => {
    const petWindow = getPetWindow();
    if (petWindow) {
      petWindow.webContents.executeJavaScript(`setPetExpression('${name}')`);
    }
  });

  /* ─── Cancel active request ─── */
  ipcMain.on('cancel-request', () => {
    cancelActiveStream();
  });

  /* ─── Cross-conversation search ─── */
  ipcMain.handle('search-all-conversations', (_event, query) => {
    if (!query || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();
    const convs = getConversations();
    const results = [];

    for (const conv of convs) {
      if (!conv.messages || conv.messages.length === 0) continue;
      for (let i = 0; i < conv.messages.length; i++) {
        const msg = conv.messages[i];
        if (msg.content && msg.content.toLowerCase().includes(q)) {
          results.push({
            conversationId: conv.id,
            conversationTitle: conv.title || '新对话',
            messageIndex: i,
            role: msg.role,
            preview: msg.content.slice(0, 120) + (msg.content.length > 120 ? '...' : ''),
            timestamp: conv.updatedAt
          });
          if (results.length >= 30) break;
        }
      }
      if (results.length >= 50) break;
    }

    return results;
  });

  /* ─── System Tools / Agent ─── */
  ipcMain.handle('get-system-tools', () => {
    return SYSTEM_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      requiresConfirmation: t.requiresConfirmation,
      parameters: t.parameters
    }));
  });

  ipcMain.handle('confirm-tool-response', (_event, { toolCallId, confirmed }) => {
    const pending = pendingToolConfirmations.get(toolCallId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingToolConfirmations.delete(toolCallId);
      pending.resolve(confirmed);
    }
    return true;
  });

  ipcMain.on('quit-app', () => {
    setQuitting();
    const petWindow = getPetWindow();
    if (petWindow) {
      const pos = petWindow.getPosition();
      store.set('petPosition', { x: pos[0], y: pos[1] });
    }
    destroyTray();
    app.exit(0);
  });
}

module.exports = { registerIpcHandlers };
