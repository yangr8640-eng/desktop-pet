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

let isLoading = false;
let isSearchEnabled = false;
let isSwitchingConversation = false;

function createTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'typing-dots';
  el.id = 'typingDots';
  el.innerHTML = '<span></span><span></span><span></span>';
  messagesArea.appendChild(el);
  return el;
}

/* ─── Init ─── */
async function init() {
  // Load API key
  const key = await window.petAPI.getApiKey();
  apiKeyInput.value = key;

  // Validate API key on startup
  try {
    const validation = await window.petAPI.validateApiKey();
    if (!validation.valid) {
      showApiKeyWarning(validation.reason);
    }
  } catch {
    // IPC itself fails — don't block
  }

  // Load personality
  const personality = await window.petAPI.getPersonality();
  personalityInput.value = personality;

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
  });

  // Focus input listener
  window.petAPI.onFocusInput(() => {
    chatInput.focus();
    setTimeout(() => {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }, 100);
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
    messagesArea.innerHTML = `
      <div class="welcome-msg">
        <div class="welcome-icon">🐱</div>
        <div class="welcome-text">喵~ 我是小橘！</div>
        <div class="welcome-sub">有什么想聊的吗？</div>
      </div>`;
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
  if (role === 'assistant') {
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
  if (!text || isLoading) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  isLoading = true;

  addMessage('user', text);
  typingDots.classList.add('show');
  messagesArea.scrollTop = messagesArea.scrollHeight;

  try {
    const reply = await window.petAPI.sendMessage(text);
    typingDots.classList.remove('show');
    addMessage('assistant', reply);
    // Refresh dropdown in case title was auto-generated
    await refreshConversationSelect();
  } catch (err) {
    typingDots.classList.remove('show');
    addMessage('assistant', `喵呜... 发送失败了: ${err.message}`);
  }

  sendBtn.disabled = false;
  isLoading = false;
  chatInput.focus();
}

/* ─── File Import ─── */
importBtn.addEventListener('click', async () => {
  if (isLoading) return;

  const result = await window.petAPI.importFile();

  if (!result) return; // User cancelled

  if (result.error) {
    addMessage('assistant', `喵~ ${result.error}`);
    return;
  }

  // Show file import message
  addMessage('user', `📄 导入文档：${result.fileName}`);

  // Send document content to AI for analysis
  typingDots.classList.add('show');
  messagesArea.scrollTop = messagesArea.scrollHeight;
  sendBtn.disabled = true;
  isLoading = true;

  const analysisPrompt = `请帮我分析以下文档内容：\n\n文件名：${result.fileName}\n\n${result.content}`;

  try {
    const reply = await window.petAPI.sendMessage(analysisPrompt);
    typingDots.classList.remove('show');
    addMessage('assistant', reply);
    await refreshConversationSelect();
  } catch (err) {
    typingDots.classList.remove('show');
    addMessage('assistant', `喵呜... 分析文件时出错了: ${err.message}`);
  }

  sendBtn.disabled = false;
  isLoading = false;
  chatInput.focus();
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

  if (reason === 'no-key') {
    textEl.textContent = '还没设置API Key哦，小橘没法和你聊天~ 请在下方输入你的DeepSeek API Key。';
  } else if (reason === 'invalid-key') {
    textEl.textContent = 'API Key好像不对，小橘连不上~ 请检查并重新输入。';
  } else {
    textEl.textContent = 'API Key可能有问题，请检查后重试~';
  }

  banner.style.display = 'flex';
  settingsPanel.classList.add('open');
}

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  await window.petAPI.saveApiKey(key);
  // Hide API key warning on successful save
  const warningBanner = document.getElementById('apiKeyWarning');
  if (warningBanner) warningBanner.style.display = 'none';
  settingsPanel.classList.remove('open');
  saveKeyBtn.textContent = '已保存 ✓';
  saveKeyBtn.style.background = '#4CAF50';
  setTimeout(() => {
    saveKeyBtn.textContent = '保存';
    saveKeyBtn.style.background = '';
  }, 1500);
});

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

/* ─── New chat ─── */
newChatBtn.addEventListener('click', async () => {
  await window.petAPI.newConversation();
  await refreshConversationSelect();
  messagesArea.innerHTML = `
    <div class="welcome-msg">
      <div class="welcome-icon">🐱</div>
      <div class="welcome-text">喵~ 开始新对话！</div>
      <div class="welcome-sub">有什么想聊的吗？</div>
    </div>`;
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

init();
