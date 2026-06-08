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
const themeSelect = document.getElementById('themeSelect');
const headerIcon = document.getElementById('headerIcon');
const headerTitle = document.getElementById('headerTitle');

const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historyCloseBtn = document.getElementById('historyCloseBtn');
const historyList = document.getElementById('historyList');
const historySearchInput = document.getElementById('historySearchInput');

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

  // Show/hide expression bar (only for themes with expressions)
  const exprBar = document.getElementById('expressionBar');
  if (exprBar) {
    const hasExpr = theme.expressions && Object.keys(theme.expressions).length > 1;
    exprBar.style.display = hasExpr ? 'flex' : 'none';
  }
}

function setupExpressionButtons() {
  const exprBar = document.getElementById('expressionBar');
  if (!exprBar) return;
  exprBar.querySelectorAll('.expr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const expr = btn.dataset.expr;
      if (window.petAPI && window.petAPI.setPetExpression) {
        window.petAPI.setPetExpression(expr);
      }
      // Highlight active button
      exprBar.querySelectorAll('.expr-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function renderWelcomeMessage(subtitle) {
  return `
    <div class="welcome-msg">
      <div class="welcome-icon" id="welcomeIcon">${currentWelcomeEmoji}</div>
      <div class="welcome-text">${currentWelcomeGreeting}</div>
      <div class="welcome-sub">${subtitle || currentWelcomeSubtitle}</div>
    </div>`;
}

/* ─── History Panel ─── */
let allConversations = [];

async function loadHistory() {
  allConversations = await window.petAPI.getAllConversations();
  renderHistory();
}

function renderHistory(filterText) {
  const q = (filterText || historySearchInput.value || '').trim().toLowerCase();
  historyList.innerHTML = '';

  let items = allConversations;
  if (q) {
    items = items.filter(c =>
      (c.title && c.title.toLowerCase().includes(q)) ||
      (c.messages && c.messages.some(m => m.content && m.content.toLowerCase().includes(q)))
    );
  }

  if (items.length === 0) {
    historyList.innerHTML = `<div class="history-empty">${q ? '没有找到匹配的对话' : '还没有聊天记录'}</div>`;
    return;
  }

  items.forEach(conv => {
    const lastMsg = conv.messages && conv.messages.length > 0
      ? conv.messages[conv.messages.length - 1].content
      : '';
    const preview = lastMsg.length > 80 ? lastMsg.slice(0, 80) + '...' : lastMsg;
    const msgCount = conv.messages ? Math.floor(conv.messages.length / 2) : 0;
    const date = conv.updatedAt
      ? new Date(conv.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
      : '';

    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.id = conv.id;

    const msgPreview = preview
      ? `<div class="history-item-preview">${escapeHtml(preview)}</div>`
      : '';

    item.innerHTML = `
      <div class="history-item-top">
        <span class="history-item-title">${escapeHtml(conv.title || '新对话')}</span>
        <span class="history-item-meta">${msgCount}条 · ${date}</span>
      </div>
      ${msgPreview}
    `;

    item.addEventListener('click', async () => {
      // Close history panel
      historyPanel.classList.remove('open');
      // Switch to this conversation
      isSwitchingConversation = true;
      await window.petAPI.switchConversation(conv.id);
      await loadConversationMessages();
      await refreshConversationSelect();
      isSwitchingConversation = false;
    });

    historyList.appendChild(item);
  });
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

  // Listen for external message updates (e.g., file drop analysis)
  window.petAPI.onMessagesUpdated(async () => {
    await loadConversationMessages();
    await refreshConversationSelect();
    // Refresh history data in background
    allConversations = await window.petAPI.getAllConversations();
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

  // Tool confirmation listener
  window.petAPI.onToolConfirm((data) => {
    showToolConfirmation(data);
  });

  // Tool execution status listener
  window.petAPI.onToolExecutionStatus((data) => {
    updateToolStatus(data);
  });
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
    history.forEach(msg => addMessage(msg.role, msg.content, false));
  } else {
    messagesArea.innerHTML = renderWelcomeMessage('有什么想聊的吗？');
    messagesArea.appendChild(typingDots);
  }

  messagesArea.scrollTop = messagesArea.scrollHeight;
}

/* ─── Add message to UI ─── */
function addMessage(role, content, animate = true) {
  const welcome = messagesArea.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;

  let html = content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');

  div.innerHTML = html;
  if (!animate) div.style.animation = 'none';

  // Add copy button for assistant messages
  if (role === 'user' || role === 'assistant') {
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
  }

  messagesArea.insertBefore(div, typingDots);
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

/* ─── Send message ─── */
async function sendMessage() {
  const text = chatInput.value.trim();
  if ((!text && pendingFiles.length === 0) || isLoading) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  isLoading = true;

  // If there are pending files, read their content and prepend to message
  let fullContent = text;
  if (pendingFiles.length > 0) {
    const filePaths = pendingFiles.map(f => f.filePath);
    const fileResults = await window.petAPI.readPendingFiles(filePaths);

    const fileContext = fileResults.map(r => {
      if (r.error) return `[文件: ${r.fileName} - 读取失败: ${r.error}]`;
      return `[文件: ${r.fileName}]\n${r.content}\n[${r.fileName} 结束]`;
    }).join('\n\n');

    fullContent = `${fileContext}\n\n---\n用户指令: ${text}`;

    // Clear pending files (they're now sent with the message)
    clearPendingFiles();
  }

  addMessage('user', text || `📄 发送了 ${pendingFiles.length > 0 ? pendingFiles.length + ' 个文件' : ''}`);
  typingDots.classList.add('show');
  messagesArea.scrollTop = messagesArea.scrollHeight;

  // Safety timeout: auto-reset loading after 120s
  const safetyTimer = setTimeout(() => {
    if (isLoading) {
      isLoading = false;
      sendBtn.disabled = false;
      typingDots.classList.remove('show');
      addMessage('assistant', '⏱️ 请求超时，请重试');
      chatInput.focus();
    }
  }, 120000);

  try {
    const reply = await window.petAPI.sendMessage(fullContent);
    clearTimeout(safetyTimer);
    typingDots.classList.remove('show');
    addMessage('assistant', reply);
    await refreshConversationSelect();
  } catch (err) {
    clearTimeout(safetyTimer);
    typingDots.classList.remove('show');
    addMessage('assistant', `哎呀，发送失败了: ${err.message}`);
  }

  sendBtn.disabled = false;
  isLoading = false;
  chatInput.focus();
}

/* ─── Pending Files (preview chips above input) ─── */
let pendingFiles = []; // [{ filePath, fileName, ext }]

const filePreviewArea = document.getElementById('filePreviewArea');
const filePreviewList = document.getElementById('filePreviewList');

function getFileIcon(ext) {
  const icons = {
    '.pdf': '📕', '.docx': '📘', '.txt': '📄', '.md': '📝',
    '.json': '📋', '.csv': '📊', '.log': '📋', '.xml': '📋',
    '.yaml': '📋', '.yml': '📋',
    '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🎨',
    '.bmp': '🖼️', '.webp': '🖼️', '.svg': '🎨'
  };
  return icons[ext] || '📄';
}

function renderFilePreviews() {
  filePreviewList.innerHTML = '';
  if (pendingFiles.length === 0) {
    filePreviewArea.style.display = 'none';
    return;
  }
  filePreviewArea.style.display = 'block';

  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `
      <span class="file-chip-icon">${getFileIcon(f.ext)}</span>
      <span class="file-chip-name">${escapeHtml(f.fileName)}</span>
      <button class="file-chip-remove" data-index="${i}">✕</button>
    `;
    chip.querySelector('.file-chip-remove').addEventListener('click', () => {
      removePendingFile(i);
    });
    filePreviewList.appendChild(chip);
  });
}

function addPendingFile(filePath, fileName) {
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  const allowed = ['.pdf', '.docx', '.txt', '.md', '.json', '.csv', '.log', '.xml', '.yaml', '.yml',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  if (!allowed.includes(ext)) {
    addMessage('assistant', `暂不支持 ${ext} 格式的文件~`);
    return false;
  }
  // Avoid duplicates
  if (pendingFiles.some(f => f.filePath === filePath)) return false;
  pendingFiles.push({ filePath, fileName, ext });
  renderFilePreviews();
  return true;
}

function removePendingFile(index) {
  pendingFiles.splice(index, 1);
  renderFilePreviews();
}

function clearPendingFiles() {
  pendingFiles = [];
  renderFilePreviews();
}

/* ─── File Import (📎 button) ─── */
const hiddenFileInput = document.getElementById('hiddenFileInput');

importBtn.addEventListener('click', () => {
  hiddenFileInput.click();
});

hiddenFileInput.addEventListener('change', () => {
  const files = hiddenFileInput.files;
  if (!files || files.length === 0) return;

  let added = 0;
  for (const file of files) {
    const filePath = window.petAPI.getFilePath(file);
    if (filePath && addPendingFile(filePath, file.name)) {
      added++;
    }
  }
  hiddenFileInput.value = '';
  if (added > 0) chatInput.focus();
});

/* ─── Drag & Drop files as pending chips ─── */
const dropOverlay = document.getElementById('dropOverlay');
let dropCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dropCounter++;
  if (dropCounter === 1) {
    dropOverlay.classList.add('show');
  }
});

document.addEventListener('dragleave', (e) => {
  dropCounter--;
  if (dropCounter === 0) {
    dropOverlay.classList.remove('show');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropCounter = 0;
  dropOverlay.classList.remove('show');

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  let added = 0;
  for (const file of files) {
    const filePath = window.petAPI.getFilePath(file);
    if (filePath && addPendingFile(filePath, file.name)) {
      added++;
    }
  }
  if (added > 0) {
    chatInput.focus();
    chatInput.placeholder = '输入指令，将文件发送给AI...';
    setTimeout(() => {
      chatInput.placeholder = `跟${headerTitle.textContent || 'Claude'}说点什么...`;
    }, 2000);
  }
});

/* ─── Settings ─── */
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  historyPanel.classList.remove('open');
});

/* ─── History Panel ─── */
historyBtn.addEventListener('click', async () => {
  const isOpen = historyPanel.classList.contains('open');
  if (isOpen) {
    historyPanel.classList.remove('open');
  } else {
    settingsPanel.classList.remove('open');
    await loadHistory();
    historyPanel.classList.add('open');
  }
});

historyCloseBtn.addEventListener('click', () => {
  historyPanel.classList.remove('open');
});

historySearchInput.addEventListener('input', () => {
  renderHistory();
});

// Close history when clicking outside
document.addEventListener('click', (e) => {
  if (!historyPanel.contains(e.target) && e.target !== historyBtn && !historyBtn.contains(e.target)) {
    historyPanel.classList.remove('open');
  }
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

/* ─── Theme select ─── */
themeSelect.addEventListener('change', async () => {
  await window.petAPI.setTheme(themeSelect.value);
  const theme = await window.petAPI.getTheme();
  applyTheme(theme);
});

/* ─── New chat ─── */
newChatBtn.addEventListener('click', async () => {
  historyPanel.classList.remove('open');
  settingsPanel.classList.remove('open');
  await window.petAPI.newConversation();
  await refreshConversationSelect();
  messagesArea.innerHTML = renderWelcomeMessage('有什么想聊的吗？');
  messagesArea.appendChild(typingDots);
  // Refresh history data
  allConversations = await window.petAPI.getAllConversations();
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

// IME composition handling for Chinese input
let isComposing = false;
chatInput.addEventListener('compositionstart', () => {
  isComposing = true;
});
chatInput.addEventListener('compositionend', () => {
  isComposing = false;
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
});

/* ─── Tool Confirmation ─── */
let pendingToolConfirm = null;

/** Show the tool confirmation dialog */
function showToolConfirmation(data) {
  const overlay = document.getElementById('toolConfirmOverlay');
  const nameEl = document.getElementById('confirmToolName');
  const paramsEl = document.getElementById('confirmToolParams');

  if (!overlay || !nameEl || !paramsEl) return;

  pendingToolConfirm = data;

  // Map tool names to readable labels
  const toolLabels = {
    write_file: '📝 写文件',
    run_command: '💻 运行命令'
  };

  nameEl.textContent = toolLabels[data.toolName] || `🔧 ${data.toolName}`;

  // Format parameters
  const paramLines = Object.entries(data.args).map(([key, val]) => {
    const label = key === 'command' ? '命令' :
                  key === 'path' ? '路径' :
                  key === 'content' ? '内容' :
                  key === 'filename' ? '文件名' : key;
    // Truncate long values for display
    const displayVal = typeof val === 'string' && val.length > 100
      ? val.slice(0, 100) + '...'
      : val;
    return `<div class="tool-confirm-param-line"><span class="tool-confirm-param-key">${label}:</span> <span class="tool-confirm-param-val">${escapeHtml(displayVal)}</span></div>`;
  }).join('');
  paramsEl.innerHTML = paramLines;

  overlay.style.display = 'flex';
}

/** Escape HTML for safe display */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Handle confirm button clicks */
document.getElementById('confirmAllowBtn').addEventListener('click', async () => {
  if (pendingToolConfirm) {
    const data = { toolCallId: pendingToolConfirm.toolCallId, confirmed: true };
    await window.petAPI.confirmToolResponse(data);
    document.getElementById('toolConfirmOverlay').style.display = 'none';
    pendingToolConfirm = null;
  }
});

document.getElementById('confirmDenyBtn').addEventListener('click', async () => {
  if (pendingToolConfirm) {
    const data = { toolCallId: pendingToolConfirm.toolCallId, confirmed: false };
    await window.petAPI.confirmToolResponse(data);
    document.getElementById('toolConfirmOverlay').style.display = 'none';
    pendingToolConfirm = null;
  }
});

/** Show tool execution status inline in messages */
function updateToolStatus(data) {
  // Find or create a status element for this tool call
  let statusEl = document.getElementById(`tool-status-${data.toolCallId}`);

  if (data.status === 'pending') {
    // Create new status element
    statusEl = document.createElement('div');
    statusEl.id = `tool-status-${data.toolCallId}`;
    statusEl.className = 'tool-call-status';
    messagesArea.insertBefore(statusEl, typingDots);
  }

  if (statusEl) {
    const toolLabels = {
      write_file: '📝 写文件',
      desktop_write_file: '📝 保存到桌面',
      read_file: '📖 读文件',
      list_directory: '📂 浏览目录',
      run_command: '💻 运行命令',
      get_system_info: 'ℹ️ 系统信息',
      open_url: '🔗 打开链接',
      get_desktop_path: '📁 桌面路径'
    };
    const label = toolLabels[data.toolName] || `🔧 ${data.toolName}`;

    if (data.status === 'pending') {
      statusEl.innerHTML = `<span class="tool-status-spinner">⟳</span> ${label}...`;
    } else if (data.status === 'completed') {
      statusEl.innerHTML = `<span class="tool-status-done">✓</span> ${label} 完成`;
      statusEl.classList.add('done');
      // Auto-remove after 3 seconds
      setTimeout(() => { statusEl.remove(); }, 3000);
    } else if (data.status === 'denied') {
      statusEl.innerHTML = `<span class="tool-status-denied">✕</span> ${label} 已拒绝`;
      statusEl.classList.add('denied');
      setTimeout(() => { statusEl.remove(); }, 2000);
    }
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }
}

/* ─── Resize handles ─── */
let isResizing = false;
let resizeDir = null;
let resizeStart = {};

const MIN_WIDTH = 360;
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
setupExpressionButtons();
