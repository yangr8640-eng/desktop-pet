// chat-conversations.js — Conversation dropdown & history panel management

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  /* ─── Dropdown ─── */
  C.filterConversationDropdown = function() {
    const searchInput = document.getElementById('dropdownSearch');
    if (!searchInput) return;
    const query = searchInput.value.trim().toLowerCase();
    const items = C.elements.dropdownList.querySelectorAll('.dropdown-item');
    items.forEach(item => {
      const title = item.querySelector('.dropdown-item-title');
      if (title) {
        const text = title.textContent.toLowerCase();
        item.style.display = (!query || text.includes(query)) ? '' : 'none';
      }
    });
  };

  C.refreshConversationSelect = async function() {
    const conversations = await window.petAPI.getConversations();
    const activeId = await window.petAPI.getActiveConversationId();

    const dropdownToggle = C.elements.dropdownToggle;
    const dropdownList = C.elements.dropdownList;
    const toggleText = dropdownToggle.querySelector('.dropdown-toggle-text');
    const activeConv = conversations.find(c => c.id === activeId);
    toggleText.textContent = activeConv ? (activeConv.title || '新对话') : '新对话';

    dropdownList.querySelectorAll('.dropdown-item').forEach(el => el.remove());
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

    C.filterConversationDropdown();
  };

  C.closeDropdown = function() {
    const dropdownList = C.elements.dropdownList;
    const conversationDropdown = C.elements.conversationDropdown;
    dropdownList.style.display = 'none';
    conversationDropdown.classList.remove('open');
    const searchInput = document.getElementById('dropdownSearch');
    if (searchInput) searchInput.value = '';
  };

  C.loadConversationMessages = async function() {
    const messagesArea = C.elements.messagesArea;
    const typingDots = C.elements.typingDots;
    const history = await window.petAPI.getHistory();
    messagesArea.innerHTML = '';
    messagesArea.appendChild(typingDots);

    if (history && history.length > 0) {
      history.forEach((msg, i) => C.addMessage(msg.role, msg.content, false, i));
      const assistantMsgs = messagesArea.querySelectorAll('.message.assistant');
      assistantMsgs.forEach((m, i) => {
        if (i < assistantMsgs.length - 1) {
          const btn = m.querySelector('.regen-btn');
          if (btn) btn.remove();
        }
      });
    } else {
      messagesArea.innerHTML = C.renderWelcomeMessage('有什么想聊的吗？');
      messagesArea.appendChild(typingDots);
    }

    messagesArea.scrollTop = messagesArea.scrollHeight;
  };

  /* ─── History Panel ─── */
  let allConversations = [];

  C.loadHistory = async function() {
    allConversations = await window.petAPI.getAllConversations();
    C.renderHistory();
  };

  C.renderHistory = function(filterText) {
    const q = (filterText || (C.elements.historySearchInput ? C.elements.historySearchInput.value : '') || '').trim().toLowerCase();
    const historyList = C.elements.historyList;
    if (!historyList) return;
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
        ? `<div class="history-item-preview">${C.escapeHtml(preview)}</div>`
        : '';

      item.innerHTML = `
        <div class="history-item-top">
          <span class="history-item-title">${C.escapeHtml(conv.title || '新对话')}</span>
          <span class="history-item-meta">${msgCount}条 · ${date}</span>
        </div>
        ${msgPreview}
      `;

      item.addEventListener('click', async () => {
        const historyPanel = C.elements.historyPanel;
        if (historyPanel) historyPanel.classList.remove('open');
        C.state.isSwitchingConversation = true;
        await window.petAPI.switchConversation(conv.id);
        await C.loadConversationMessages();
        await C.refreshConversationSelect();
        C.state.isSwitchingConversation = false;
      });

      historyList.appendChild(item);
    });
  };

  C.initHistoryPanel = function() {
    const historyBtn = C.elements.historyBtn;
    const historyPanel = C.elements.historyPanel;
    const historyCloseBtn = C.elements.historyCloseBtn;
    const historySearchInput = C.elements.historySearchInput;

    if (!historyBtn || !historyPanel) return;

    historyBtn.addEventListener('click', async () => {
      const isOpen = historyPanel.classList.contains('open');
      if (isOpen) {
        historyPanel.classList.remove('open');
      } else {
        if (C.elements.settingsPanel) C.elements.settingsPanel.classList.remove('open');
        await C.loadHistory();
        historyPanel.classList.add('open');
      }
    });

    if (historyCloseBtn) {
      historyCloseBtn.addEventListener('click', () => {
        historyPanel.classList.remove('open');
      });
    }

    if (historySearchInput) {
      historySearchInput.addEventListener('input', () => {
        C.renderHistory();
      });
    }

    // Close history when clicking outside
    document.addEventListener('click', (e) => {
      if (historyPanel && !historyPanel.contains(e.target) &&
          historyBtn && e.target !== historyBtn && !historyBtn.contains(e.target)) {
        historyPanel.classList.remove('open');
      }
    });
  };

  /* ─── Dropdown init ─── */
  C.initConversationDropdown = function() {
    const dropdownToggle = C.elements.dropdownToggle;
    const dropdownList = C.elements.dropdownList;
    const conversationDropdown = C.elements.conversationDropdown;
    const settingsPanel = C.elements.settingsPanel;
    const settingsBtn = C.elements.settingsBtn;

    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdownList.style.display === 'block';
      if (isOpen) {
        C.closeDropdown();
      } else {
        dropdownList.style.display = 'block';
        conversationDropdown.classList.add('open');
        const searchInput = document.getElementById('dropdownSearch');
        if (searchInput) {
          searchInput.value = '';
          C.filterConversationDropdown();
          setTimeout(() => searchInput.focus(), 50);
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!conversationDropdown.contains(e.target)) {
        C.closeDropdown();
      }
      if (settingsPanel && !settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
        settingsPanel.classList.remove('open');
      }
    });

    dropdownList.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('.dropdown-item-delete');
      const item = e.target.closest('.dropdown-item');

      if (deleteBtn) {
        e.stopPropagation();
        const convId = deleteBtn.dataset.id;
        if (!convId) return;

        const conversations = await window.petAPI.getConversations();
        if (conversations.length <= 1) return;

        const success = await window.petAPI.deleteConversation(convId);
        if (success) {
          await C.refreshConversationSelect();
          await C.loadConversationMessages();
        }
        C.closeDropdown();
        return;
      }

      if (item) {
        const convId = item.dataset.id;
        if (!convId) return;

        C.state.isSwitchingConversation = true;
        await window.petAPI.switchConversation(convId);
        await C.loadConversationMessages();
        await C.refreshConversationSelect();
        C.state.isSwitchingConversation = false;
        C.closeDropdown();
      }
    });

    const searchInput = document.getElementById('dropdownSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        e.stopPropagation();
        C.filterConversationDropdown();
      });
    }
  };
})();
