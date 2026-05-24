// chat-conversations.js — Conversation dropdown management

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

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

    // Clear all dynamic items but keep search container
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

    // Re-apply any active search filter
    C.filterConversationDropdown();
  };

  C.closeDropdown = function() {
    const dropdownList = C.elements.dropdownList;
    const conversationDropdown = C.elements.conversationDropdown;
    dropdownList.style.display = 'none';
    conversationDropdown.classList.remove('open');
    // Clear search on close
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
        // Clear and focus search input
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
      if (!settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
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

    // Search input filter
    const searchInput = document.getElementById('dropdownSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        e.stopPropagation();
        C.filterConversationDropdown();
      });
    }
  };
})();
