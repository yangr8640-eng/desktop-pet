// chat-search.js — Cross-conversation search

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;
  let searchTimeout = null;

  C.initGlobalSearch = function() {
    const overlay = C.elements.globalSearchOverlay;
    const input = C.elements.globalSearchInput;
    const results = C.elements.globalSearchResults;
    if (!overlay || !input) return;

    function openSearch() {
      overlay.classList.add('show');
      input.value = '';
      results.innerHTML = '<div class="global-search-empty">输入关键词搜索所有对话内容</div>';
      input.focus();
    }

    function closeSearch() {
      overlay.classList.remove('show');
      input.value = '';
      results.innerHTML = '';
      if (searchTimeout) { clearTimeout(searchTimeout); searchTimeout = null; }
    }

    // Ctrl+F / Cmd+F to open search
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (overlay.classList.contains('show')) {
          closeSearch();
        } else {
          openSearch();
        }
      }
      if (e.key === 'Escape' && overlay.classList.contains('show')) {
        closeSearch();
      }
    });

    // Search input handler with debounce
    input.addEventListener('input', () => {
      if (searchTimeout) clearTimeout(searchTimeout);
      const query = input.value.trim();

      if (!query) {
        results.innerHTML = '<div class="global-search-empty">输入关键词搜索所有对话内容</div>';
        return;
      }

      searchTimeout = setTimeout(async () => {
        const items = await window.petAPI.searchAllConversations(query);
        if (!input.value.trim()) return; // query changed

        if (items.length === 0) {
          results.innerHTML = '<div class="global-search-empty">没有找到匹配的结果</div>';
          return;
        }

        results.innerHTML = items.map((item) => {
          const roleLabel = item.role === 'user' ? '🧑' : '🤖';
          return `<div class="global-search-result" data-conv-id="${C.escapeHtml(item.conversationId)}" data-msg-idx="${item.messageIndex}">
            <div class="result-title">📝 ${C.escapeHtml(item.conversationTitle)}</div>
            <div class="result-preview"><span class="result-role">${roleLabel}</span>${C.escapeHtml(item.preview)}</div>
          </div>`;
        }).join('');

        // Click handler for each result
        results.querySelectorAll('.global-search-result').forEach(el => {
          el.addEventListener('click', async () => {
            const convId = el.dataset.convId;
            const msgIdx = parseInt(el.dataset.msgIdx, 10);
            closeSearch();

            // Switch to target conversation and reload
            await window.petAPI.switchConversation(convId);
            // Reload messages — the switch triggers activeConversationId change
            const history = await window.petAPI.getHistory();
            C.elements.messagesArea.innerHTML = '';
            C.elements.messagesArea.appendChild(C.elements.typingDots);

            if (!history || history.length === 0) {
              C.elements.messagesArea.innerHTML = C.renderWelcomeMessage();
            } else {
              history.forEach((msg, idx) => {
                C.addMessage(msg.role, msg.content, false, idx);
              });
            }

            C.refreshConversationSelect();

            // Scroll to target message
            setTimeout(() => {
              const targetMsg = C.elements.messagesArea.querySelector(`[data-msg-index="${msgIdx}"]`);
              if (targetMsg) {
                targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetMsg.style.boxShadow = '0 0 0 2px var(--accent)';
                setTimeout(() => { targetMsg.style.boxShadow = ''; }, 2000);
              }
            }, 100);
          });
        });
      }, 300);
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (overlay.classList.contains('show') && !overlay.contains(e.target)) {
        closeSearch();
      }
    });
  };
})();
