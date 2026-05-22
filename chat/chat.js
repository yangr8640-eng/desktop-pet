// chat.js - Sidebar Chat Logic

const messagesArea = document.getElementById('messagesArea');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const searchBtn = document.getElementById('searchBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const newChatBtn = document.getElementById('newChatBtn');
const closeBtn = document.getElementById('closeBtn');
const quitBtn = document.getElementById('quitBtn');
const conversationSelect = document.getElementById('conversationSelect');
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

  // Load personality
  const personality = await window.petAPI.getPersonality();
  personalityInput.value = personality;

  // Load conversations and populate dropdown
  await refreshConversationSelect();

  // Load active conversation messages
  await loadConversationMessages();

  // Search toggle
  await initSearchToggle();

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

  conversationSelect.innerHTML = '';
  if (conversations.length === 0) {
    const option = document.createElement('option');
    option.textContent = '新对话';
    conversationSelect.appendChild(option);
    return;
  }

  conversations.forEach(conv => {
    const option = document.createElement('option');
    option.value = conv.id;
    option.textContent = conv.title || '新对话';
    if (conv.id === activeId) option.selected = true;
    conversationSelect.appendChild(option);
  });
}

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

conversationSelect.addEventListener('change', async () => {
  if (isSwitchingConversation) return;
  const newId = conversationSelect.value;
  if (!newId) return;

  isSwitchingConversation = true;
  await window.petAPI.switchConversation(newId);
  await loadConversationMessages();
  isSwitchingConversation = false;
});

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
  updateSearchButton();

  searchBtn.addEventListener('click', async () => {
    isSearchEnabled = await window.petAPI.toggleSearch();
    updateSearchButton();
  });
}

function updateSearchButton() {
  if (isSearchEnabled) {
    searchBtn.classList.add('search-active');
    searchBtn.title = '联网搜索：开';
  } else {
    searchBtn.classList.remove('search-active');
    searchBtn.title = '联网搜索：关';
  }
}

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  await window.petAPI.saveApiKey(key);
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
