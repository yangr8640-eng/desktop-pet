// chat.js - Sidebar Chat Logic

const messagesArea = document.getElementById('messagesArea');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const searchToggle = document.getElementById('searchToggle');
const searchHeaderBtn = document.getElementById('searchHeaderBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const newChatBtn = document.getElementById('newChatBtn');
const closeBtn = document.getElementById('closeBtn');
const quitBtn = document.getElementById('quitBtn');
const conversationDropdown = document.getElementById('conversationDropdown');
const dropdownToggle = document.getElementById('dropdownToggle');
const dropdownList = document.getElementById('dropdownList');
const importBtn = document.getElementById('importBtn');
const typingDots = document.getElementById('typingDots') || createTypingIndicator();
const personalityInput = document.getElementById('personalityInput');
const savePersonalityBtn = document.getElementById('savePersonalityBtn');
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const themeSelect = document.getElementById('themeSelect');
const headerIcon = document.getElementById('headerIcon');
const headerTitle = document.getElementById('headerTitle');

const modelSelect = document.getElementById('modelSelect');
const modelNameInput = document.getElementById('modelNameInput');
const modelUrlInput = document.getElementById('modelUrlInput');
const modelModelIdInput = document.getElementById('modelModelIdInput');
const modelInfo = document.getElementById('modelInfo');
const keyValidation = document.getElementById('keyValidation');
const addModelBtn = document.getElementById('addModelBtn');
const deleteModelBtn = document.getElementById('deleteModelBtn');
const modelCustomFields = document.getElementById('modelCustomFields');
const apiKeyLabel = document.getElementById('apiKeyLabel');

let isLoading = false;
let isSearchEnabled = false;
let isSwitchingConversation = false;
let currentModelProvider = null;
let modelProviders = [];
let streamCleanup = null;

function createTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'typing-dots';
  el.id = 'typingDots';
  el.innerHTML = '<span></span><span></span><span></span>';
  messagesArea.appendChild(el);
  return el;
}

/* ─── Theme helpers ─── */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '255, 179, 71';
}

let currentWelcomeEmoji = '💠';
let currentWelcomeGreeting = 'Hello! 我是Claude。💠';
let currentWelcomeSubtitle = '有什么我可以帮你的？用代码说话也行，用自然语言聊天也可以~';

function applyTheme(theme) {
  currentWelcomeEmoji = theme.emoji;
  currentWelcomeGreeting = theme.welcomeGreeting;
  currentWelcomeSubtitle = theme.welcomeSubtitle;

  const root = document.documentElement;
  root.style.setProperty('--accent', theme.accentColor);
  root.style.setProperty('--accent-dark', theme.accentColorDark);
  root.style.setProperty('--accent-rgb', hexToRgb(theme.accentColor));

  // Toggle cyber class on body for code-style bubbles
  if (theme.bubbleStyle === 'cyber') {
    document.body.classList.add('cyber');
  } else {
    document.body.classList.remove('cyber');
  }

  headerIcon.textContent = theme.emoji;
  headerTitle.textContent = theme.name;
  chatInput.placeholder = `跟${theme.name}说点什么...`;

  const welcomeIcon = document.getElementById('welcomeIcon');
  const welcomeText = document.getElementById('welcomeText');
  if (welcomeIcon) welcomeIcon.textContent = theme.emoji;
  if (welcomeText) welcomeText.textContent = theme.welcomeGreeting;

  themeSelect.value = theme.id;
}

function renderWelcomeMessage(subtitle) {
  return `
    <div class="welcome-msg">
      <div class="welcome-icon" id="welcomeIcon">${currentWelcomeEmoji}</div>
      <div class="welcome-text">${currentWelcomeGreeting}</div>
      <div class="welcome-sub">${subtitle || currentWelcomeSubtitle}</div>
    </div>`;
}

/* ─── Init ─── */
async function init() {
  // Load model providers
  await loadModelProviders();

  // Validate active model's API key on startup
  try {
    if (currentModelProvider) {
      const validation = await window.petAPI.validateModelApiKey(currentModelProvider.id);
      if (!validation.valid) {
        showApiKeyWarning(validation.reason);
      }
    }
  } catch {
    // IPC itself fails — don't block
  }

  // Load personality
  const personality = await window.petAPI.getPersonality();
  personalityInput.value = personality;

  // Load and apply current theme (must be before loadConversationMessages
  // so renderWelcomeMessage picks up the correct name/emoji)
  const theme = await window.petAPI.getTheme();
  applyTheme(theme);

  // Load conversations and populate dropdown
  await refreshConversationSelect();

  // Load active conversation messages
  await loadConversationMessages();

  // Search toggle
  await initSearchToggle();

  // Apply Windows platform class for CSS overrides
  const platform = await window.petAPI.getPlatform();
  if (platform === 'win32') {
    document.body.classList.add('win32');
  }

  // Listen for external message updates (e.g., file drop analysis)
  window.petAPI.onMessagesUpdated(async () => {
    await loadConversationMessages();
    await refreshConversationSelect();
  });

  // Listen for theme changes
  window.petAPI.onThemeChanged((theme) => {
    applyTheme(theme);
    // If welcome message is showing, regenerate it with new theme
    if (messagesArea.querySelector('.welcome-msg')) {
      const sub = messagesArea.querySelector('.welcome-sub');
      messagesArea.innerHTML = renderWelcomeMessage(sub ? sub.textContent : '');
      messagesArea.appendChild(typingDots);
    }
  });

  // Focus input listener
  window.petAPI.onFocusInput(() => {
    chatInput.focus();
    setTimeout(() => {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }, 100);
  });

  // Auto-update listeners
  setupUpdateListeners();
}

/* ─── Conversation management ─── */
async function refreshConversationSelect() {
  const conversations = await window.petAPI.getConversations();
  const activeId = await window.petAPI.getActiveConversationId();

  // Update toggle text
  const activeConv = conversations.find(c => c.id === activeId);
  const toggleText = dropdownToggle.querySelector('.dropdown-toggle-text');
  toggleText.textContent = activeConv ? (activeConv.title || '新对话') : '新对话';

  // Render dropdown items
  dropdownList.innerHTML = '';
  if (conversations.length === 0) return;

  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'dropdown-item' + (conv.id === activeId ? ' active' : '');
    item.dataset.id = conv.id;

    const title = document.createElement('span');
    title.className = 'dropdown-item-title';
    title.textContent = conv.title || '新对话';

    const delBtn = document.createElement('button');
    delBtn.className = 'dropdown-item-delete';
    delBtn.textContent = '✕';
    delBtn.title = '删除对话';
    delBtn.dataset.id = conv.id;

    item.appendChild(title);
    item.appendChild(delBtn);
    dropdownList.appendChild(item);
  });
}

// Toggle dropdown open/close
dropdownToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = dropdownList.style.display === 'block';
  if (isOpen) {
    closeDropdown();
  } else {
    dropdownList.style.display = 'block';
    conversationDropdown.classList.add('open');
  }
});

function closeDropdown() {
  dropdownList.style.display = 'none';
  conversationDropdown.classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!conversationDropdown.contains(e.target)) {
    closeDropdown();
  }
  // Close settings panel when clicking outside
  if (!settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
    settingsPanel.classList.remove('open');
  }
});

// Handle item click (switch conversation) and delete button click
dropdownList.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('.dropdown-item-delete');
  const item = e.target.closest('.dropdown-item');

  if (deleteBtn) {
    e.stopPropagation();
    const convId = deleteBtn.dataset.id;
    if (!convId) return;

    const conversations = await window.petAPI.getConversations();
    if (conversations.length <= 1) return; // Keep at least one

    const success = await window.petAPI.deleteConversation(convId);
    if (success) {
      await refreshConversationSelect();
      await loadConversationMessages();
    }
    closeDropdown();
    return;
  }

  if (item) {
    const convId = item.dataset.id;
    if (!convId) return;

    isSwitchingConversation = true;
    await window.petAPI.switchConversation(convId);
    await loadConversationMessages();
    await refreshConversationSelect();
    isSwitchingConversation = false;
    closeDropdown();
  }
});

async function loadConversationMessages() {
  const history = await window.petAPI.getHistory();
  messagesArea.innerHTML = '';
  messagesArea.appendChild(typingDots);

  if (history && history.length > 0) {
    history.forEach((msg, i) => addMessage(msg.role, msg.content, false, i));
    // Only the last assistant message should have the regen button
    const assistantMsgs = messagesArea.querySelectorAll('.message.assistant');
    assistantMsgs.forEach((m, i) => {
      if (i < assistantMsgs.length - 1) {
        const btn = m.querySelector('.regen-btn');
        if (btn) btn.remove();
      }
    });
  } else {
    messagesArea.innerHTML = renderWelcomeMessage('有什么想聊的吗？');
    messagesArea.appendChild(typingDots);
  }

  messagesArea.scrollTop = messagesArea.scrollHeight;
}

/* ─── Add message to UI ─── */
function addMessage(role, content, animate = true, messageIndex = -1) {
  const welcome = messagesArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (messageIndex >= 0) div.dataset.msgIndex = messageIndex;

  let html = content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');

  div.innerHTML = html;
  if (!animate) div.style.animation = 'none';

  // Add action buttons
  if (role === 'user' || role === 'assistant') {
    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = '复制';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(content);
      copyBtn.innerHTML = '✓';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.innerHTML = '📋';
        copyBtn.classList.remove('copied');
      }, 1500);
    });
    div.appendChild(copyBtn);

    // Edit button for user messages
    if (role === 'user' && messageIndex >= 0) {
      const editBtn = document.createElement('button');
      editBtn.className = 'copy-btn edit-btn';
      editBtn.innerHTML = '✏️';
      editBtn.title = '编辑';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editUserMessage(div, content, messageIndex);
      });
      div.appendChild(editBtn);
    }

    // Regenerate button for assistant messages
    if (role === 'assistant') {
      const regenBtn = document.createElement('button');
      regenBtn.className = 'copy-btn regen-btn';
      regenBtn.innerHTML = '🔄';
      regenBtn.title = '重新生成';
      regenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        regenerateLastMessage();
      });
      div.appendChild(regenBtn);
    }
  }

  messagesArea.insertBefore(div, typingDots);
  messagesArea.scrollTop = messagesArea.scrollHeight;
  return div;
}

/* ─── Create empty assistant message skeleton for streaming ─── */
function createAssistantMessageSkeleton() {
  const welcome = messagesArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'message assistant';
  messagesArea.insertBefore(div, typingDots);
  return div;
}

/* ─── Render markdown into a streaming skeleton div ─── */
function renderMarkdownInPlace(div, content) {
  let html = content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');

  div.innerHTML = html;

  // Add copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.innerHTML = '📋';
  copyBtn.title = '复制';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(content);
    copyBtn.innerHTML = '✓';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.innerHTML = '📋';
      copyBtn.classList.remove('copied');
    }, 1500);
  });
  div.appendChild(copyBtn);

  // Remove regen buttons from all other assistant messages
  messagesArea.querySelectorAll('.message.assistant .regen-btn').forEach(b => b.remove());
  // Add regenerate button
  const regenBtn = document.createElement('button');
  regenBtn.className = 'copy-btn regen-btn';
  regenBtn.innerHTML = '🔄';
  regenBtn.title = '重新生成';
  regenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    regenerateLastMessage();
  });
  div.appendChild(regenBtn);
}

/* ─── Common streaming send logic ─── */
function startStreamingRequest(userText, showUserMessage = true) {
  if (showUserMessage) {
    addMessage('user', userText);
  }
  typingDots.classList.add('show');

  const assistantDiv = createAssistantMessageSkeleton();
  let fullContent = '';

  // Clean up previous listener
  if (streamCleanup) streamCleanup();

  streamCleanup = window.petAPI.onStreamChunk((data) => {
    if (data.done) {
      typingDots.classList.remove('show');
      if (!data.error) {
        renderMarkdownInPlace(assistantDiv, fullContent);
      }
      sendBtn.disabled = false;
      isLoading = false;
      chatInput.focus();
      refreshConversationSelect();
      if (streamCleanup) { streamCleanup(); streamCleanup = null; }
    } else if (data.error) {
      typingDots.classList.remove('show');
      assistantDiv.innerHTML = `<p>哎呀，出错了: ${data.text}</p>`;
      sendBtn.disabled = false;
      isLoading = false;
      if (streamCleanup) { streamCleanup(); streamCleanup = null; }
    } else {
      typingDots.classList.remove('show');
      fullContent += data.text;
      assistantDiv.textContent = fullContent;
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  });
}

/* ─── Regenerate last message ─── */
async function regenerateLastMessage() {
  if (isLoading) return;

  // Remove last assistant message from DOM
  const assistantMessages = messagesArea.querySelectorAll('.message.assistant');
  if (assistantMessages.length > 0) {
    assistantMessages[assistantMessages.length - 1].remove();
  }

  isLoading = true;
  sendBtn.disabled = true;
  typingDots.classList.add('show');

  const assistantDiv = createAssistantMessageSkeleton();
  let fullContent = '';

  if (streamCleanup) streamCleanup();

  streamCleanup = window.petAPI.onStreamChunk((data) => {
    if (data.done) {
      typingDots.classList.remove('show');
      if (!data.error) {
        renderMarkdownInPlace(assistantDiv, fullContent);
      }
      sendBtn.disabled = false;
      isLoading = false;
      chatInput.focus();
      refreshConversationSelect();
      if (streamCleanup) { streamCleanup(); streamCleanup = null; }
    } else if (data.error) {
      typingDots.classList.remove('show');
      assistantDiv.innerHTML = `<p>哎呀，出错了: ${data.text}</p>`;
      sendBtn.disabled = false;
      isLoading = false;
      if (streamCleanup) { streamCleanup(); streamCleanup = null; }
    } else {
      typingDots.classList.remove('show');
      fullContent += data.text;
      assistantDiv.textContent = fullContent;
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  });

  window.petAPI.regenerateMessage();
}

/* ─── Edit user message ─── */
function editUserMessage(messageDiv, originalContent, messageIndex) {
  if (isLoading) return;

  const originalHTML = messageDiv.innerHTML;
  const textarea = document.createElement('textarea');
  textarea.className = 'edit-textarea';
  textarea.value = originalContent;
  textarea.rows = Math.min(originalContent.split('\n').length, 6);

  messageDiv.innerHTML = '';
  messageDiv.appendChild(textarea);
  textarea.focus();

  let finished = false;

  const finishEdit = async () => {
    if (finished) return;
    finished = true;

    const newText = textarea.value.trim();
    if (!newText || newText === originalContent) {
      messageDiv.innerHTML = originalHTML;
      return;
    }

    // Trim conversation at this message index
    await window.petAPI.trimConversation(messageIndex);

    // Remove this message and all following from DOM
    let found = false;
    const allMessages = [...messagesArea.querySelectorAll('.message')];
    for (const msg of allMessages) {
      if (msg === messageDiv) found = true;
      if (found) msg.remove();
    }

    // Send the edited message as new
    chatInput.value = newText;
    await sendMessage();
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      finishEdit();
    }
    if (e.key === 'Escape') {
      messageDiv.innerHTML = originalHTML;
      finished = true;
    }
  });

  textarea.addEventListener('blur', () => {
    setTimeout(() => {
      if (!finished) {
        messageDiv.innerHTML = originalHTML;
        finished = true;
      }
    }, 150);
  });
}

/* ─── Send message ─── */
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isLoading) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  isLoading = true;

  startStreamingRequest(text, true);
  window.petAPI.sendMessage(text);
}

/* ─── File Import ─── */
importBtn.addEventListener('click', async () => {
  if (isLoading) return;

  const result = await window.petAPI.importFile();

  if (!result) return; // User cancelled

  if (result.error) {
    addMessage('assistant', `哎呀，${result.error}`);
    return;
  }

  // Show file import message
  addMessage('user', `📄 导入文档：${result.fileName}`);

  // Send document content to AI for analysis (streaming)
  sendBtn.disabled = true;
  isLoading = true;

  const analysisPrompt = `请帮我分析以下文档内容：\n\n文件名：${result.fileName}\n\n${result.content}`;

  startStreamingRequest(analysisPrompt, false);
  window.petAPI.sendMessage(analysisPrompt);
});

/* ─── Settings ─── */
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

/* ─── Search Toggle ─── */
async function initSearchToggle() {
  isSearchEnabled = await window.petAPI.getSearchEnabled();
  searchToggle.checked = isSearchEnabled;
  updateSearchHeaderButton();

  searchToggle.addEventListener('change', async () => {
    isSearchEnabled = await window.petAPI.toggleSearch();
    searchToggle.checked = isSearchEnabled;
    updateSearchHeaderButton();
  });

  searchHeaderBtn.addEventListener('click', async () => {
    isSearchEnabled = await window.petAPI.toggleSearch();
    searchToggle.checked = isSearchEnabled;
    updateSearchHeaderButton();
  });
}

/* ─── Auto Update ─── */
const updateBanner = document.getElementById('updateBanner');
const updateBannerText = document.getElementById('updateBannerText');
const updateBannerBtn = document.getElementById('updateBannerBtn');
const updateBannerDismiss = document.getElementById('updateBannerDismiss');

function setupUpdateListeners() {
  const channels = [
    'update-available',
    'update-not-available',
    'update-download-progress',
    'update-downloaded',
    'update-error'
  ];

  channels.forEach(channel => {
    window.petAPI.onUpdateEvent(channel, (data) => {
      switch (channel) {
        case 'update-available':
          updateBannerText.textContent = `新版本 v${data.version} 可用`;
          updateBannerBtn.textContent = '下载更新';
          updateBannerBtn.onclick = () => {
            updateBannerBtn.textContent = '下载中...';
            updateBannerBtn.disabled = true;
            window.petAPI.downloadUpdate();
          };
          updateBannerDismiss.style.display = 'flex';
          updateBanner.style.display = 'flex';
          break;

        case 'update-download-progress':
          updateBannerText.textContent = `正在下载更新... ${data.percent}%`;
          updateBannerBtn.style.display = 'none';
          updateBannerDismiss.style.display = 'none';
          updateBanner.style.display = 'flex';
          break;

        case 'update-downloaded':
          updateBannerText.textContent = `更新已下载，重启以安装`;
          updateBannerBtn.textContent = '立即重启';
          updateBannerBtn.style.display = 'inline-block';
          updateBannerBtn.disabled = false;
          updateBannerBtn.onclick = () => window.petAPI.quitAndInstall();
          updateBannerDismiss.textContent = '稍后';
          updateBannerDismiss.style.display = 'flex';
          updateBanner.style.display = 'flex';
          break;

        case 'update-error':
          updateBannerText.textContent = `更新失败: ${data.message}`;
          updateBannerBtn.textContent = '重试';
          updateBannerBtn.style.display = 'inline-block';
          updateBannerBtn.disabled = false;
          updateBannerBtn.onclick = () => {
            updateBannerBtn.textContent = '下载中...';
            updateBannerBtn.disabled = true;
            window.petAPI.downloadUpdate();
          };
          updateBannerDismiss.style.display = 'flex';
          updateBanner.style.display = 'flex';
          break;
      }
    });
  });

  updateBannerDismiss.addEventListener('click', () => {
    updateBanner.style.display = 'none';
  });
}

function updateSearchHeaderButton() {
  if (isSearchEnabled) {
    searchHeaderBtn.classList.add('search-active');
    searchHeaderBtn.title = '联网搜索：开';
  } else {
    searchHeaderBtn.classList.remove('search-active');
    searchHeaderBtn.title = '联网搜索：关';
  }
}

function showApiKeyWarning(reason) {
  const banner = document.getElementById('apiKeyWarning');
  const textEl = document.getElementById('warningText');
  if (!banner || !textEl) return;

  const modelName = currentModelProvider ? currentModelProvider.name : 'AI';
  const name = headerTitle.textContent || 'Claude';

  if (reason === 'no-key') {
    textEl.textContent = `还没设置${modelName}的API Key哦，${name}没法和你聊天~ 请在下方输入API Key。`;
  } else if (reason === 'invalid-key') {
    textEl.textContent = `${modelName}的API Key好像不对，${name}连不上~ 请检查并重新输入。`;
  } else {
    textEl.textContent = 'API Key可能有问题，请检查后重试~';
  }

  banner.style.display = 'flex';
  settingsPanel.classList.add('open');
}

/* ─── Model Provider UI ─── */
async function loadModelProviders() {
  modelProviders = await window.petAPI.getModelProviders();
  currentModelProvider = await window.petAPI.getActiveModelProvider();

  // Populate model select
  modelSelect.innerHTML = '';
  modelProviders.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.type === 'preset' ? p.name : `${p.name} (自定义)`;
    if (p.id === currentModelProvider.id) opt.selected = true;
    modelSelect.appendChild(opt);
  });

  renderModelConfig(currentModelProvider);
}

function renderModelConfig(provider) {
  if (!provider) return;
  currentModelProvider = provider;

  apiKeyInput.value = provider.apiKey || '';
  keyValidation.style.display = 'none';
  modelInfo.textContent = '';

  if (provider.type === 'preset') {
    modelCustomFields.style.display = 'none';
    deleteModelBtn.style.display = 'none';
    modelInfo.textContent = `端点: ${provider.apiBaseUrl}  |  模型: ${provider.modelName}`;
  } else {
    modelCustomFields.style.display = 'block';
    deleteModelBtn.style.display = 'block';
    modelNameInput.value = provider.name || '';
    modelUrlInput.value = provider.apiBaseUrl || '';
    modelModelIdInput.value = provider.modelName || '';
  }
}

modelSelect.addEventListener('change', async () => {
  const providerId = modelSelect.value;
  const provider = await window.petAPI.setActiveModelProvider(providerId);
  if (provider) {
    renderModelConfig(provider);
    // Validate key for newly selected model
    const validation = await window.petAPI.validateModelApiKey(providerId);
    showKeyValidation(validation);
  }
});

saveKeyBtn.addEventListener('click', async () => {
  if (!currentModelProvider) return;

  const updated = {
    id: currentModelProvider.id,
    type: currentModelProvider.type,
    apiKey: apiKeyInput.value.trim()
  };

  if (currentModelProvider.type === 'custom') {
    updated.name = modelNameInput.value.trim() || currentModelProvider.name;
    updated.apiBaseUrl = modelUrlInput.value.trim() || currentModelProvider.apiBaseUrl;
    updated.modelName = modelModelIdInput.value.trim() || currentModelProvider.modelName;
  }

  await window.petAPI.saveModelProvider(updated);

  // Hide API key warning on successful save
  const warningBanner = document.getElementById('apiKeyWarning');
  if (warningBanner) warningBanner.style.display = 'none';

  saveKeyBtn.textContent = '已保存 ✓';
  saveKeyBtn.style.background = '#4CAF50';

  // Validate the key
  const validation = await window.petAPI.validateModelApiKey(currentModelProvider.id);
  showKeyValidation(validation);

  // Refresh model providers and current model
  await loadModelProviders();

  setTimeout(() => {
    saveKeyBtn.textContent = '保存';
    saveKeyBtn.style.background = '';
  }, 1500);
});

addModelBtn.addEventListener('click', async () => {
  const customId = 'custom_' + Date.now().toString(36);
  const newProvider = {
    id: customId,
    name: '自定义模型',
    type: 'custom',
    apiKey: '',
    apiBaseUrl: '',
    modelName: '',
    order: modelProviders.length
  };

  await window.petAPI.saveModelProvider(newProvider);
  await window.petAPI.setActiveModelProvider(customId);
  await loadModelProviders();
});

deleteModelBtn.addEventListener('click', async () => {
  if (!currentModelProvider || currentModelProvider.type === 'preset') return;

  const success = await window.petAPI.deleteModelProvider(currentModelProvider.id);
  if (success) {
    await loadModelProviders();
  }
});

function showKeyValidation(validation) {
  keyValidation.style.display = 'block';
  if (validation.valid) {
    keyValidation.textContent = 'API Key 有效 ✓';
    keyValidation.className = 'settings-validation valid';
  } else if (validation.reason === 'no-key') {
    keyValidation.textContent = '尚未设置 API Key';
    keyValidation.className = 'settings-validation invalid';
  } else if (validation.reason === 'invalid-key') {
    keyValidation.textContent = 'API Key 无效，请检查';
    keyValidation.className = 'settings-validation invalid';
  } else {
    keyValidation.style.display = 'none';
  }
}

savePersonalityBtn.addEventListener('click', async () => {
  const text = personalityInput.value.trim();
  await window.petAPI.savePersonality(text);
  savePersonalityBtn.textContent = '已保存 ✓';
  savePersonalityBtn.style.background = '#4CAF50';
  setTimeout(() => {
    savePersonalityBtn.textContent = '保存';
    savePersonalityBtn.style.background = '';
  }, 1500);
});

exportSettingsBtn.addEventListener('click', async () => {
  await window.petAPI.exportConversation();
});

/* ─── Theme select ─── */
themeSelect.addEventListener('change', async () => {
  await window.petAPI.setTheme(themeSelect.value);
  const theme = await window.petAPI.getTheme();
  applyTheme(theme);
});

/* ─── New chat ─── */
newChatBtn.addEventListener('click', async () => {
  await window.petAPI.newConversation();
  await refreshConversationSelect();
  messagesArea.innerHTML = renderWelcomeMessage('有什么想聊的吗？');
  messagesArea.appendChild(typingDots);
});

/* ─── Close ─── */
closeBtn.addEventListener('click', () => {
  window.petAPI.minimizeChat();
});

/* ─── Quit ─── */
quitBtn.addEventListener('click', () => {
  window.petAPI.quitApp();
});

/* ─── Events ─── */
sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
});

/* ─── Resize handles ─── */
let isResizing = false;
let resizeDir = null;
let resizeStart = {};

const MIN_WIDTH = 420;
function getMinHeight() {
  return Math.round(screen.availHeight * 0.7);
}

document.querySelectorAll('.resize-handle').forEach(handle => {
  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeDir = handle.dataset.resize;
    resizeStart = {
      x: e.screenX,
      y: e.screenY,
      width: window.innerWidth,
      height: window.innerHeight
    };
    e.preventDefault();
    e.stopPropagation();
  });
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const dx = e.screenX - resizeStart.x;
  const dy = e.screenY - resizeStart.y;
  const minH = getMinHeight();

  let newWidth = resizeStart.width;
  let newHeight = resizeStart.height;

  if (resizeDir.includes('e')) newWidth = Math.max(MIN_WIDTH, resizeStart.width + dx);
  if (resizeDir.includes('w')) newWidth = Math.max(MIN_WIDTH, resizeStart.width - dx);
  if (resizeDir.includes('s')) newHeight = Math.max(minH, resizeStart.height + dy);

  window.petAPI.resizeWindow(newWidth, newHeight);
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  resizeDir = null;
});

init();
