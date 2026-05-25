// chat-messages.js — Message rendering functions

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  // Configure marked for safe, GFM-compliant rendering
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });
  }

  function renderContent(text) {
    if (typeof marked !== 'undefined') {
      return marked.parse(text);
    }
    // Fallback: basic regex rendering
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function el(id) { return C.elements[id] || document.getElementById(id); }

  C.renderWelcomeMessage = function(subtitle) {
    return `
      <div class="welcome-msg">
        <div class="welcome-icon" id="welcomeIcon">${C.state.currentWelcomeEmoji}</div>
        <div class="welcome-text">${C.state.currentWelcomeGreeting}</div>
        <div class="welcome-sub">${subtitle || C.state.currentWelcomeSubtitle}</div>
      </div>`;
  };

  C.addMessage = function(role, content, animate, messageIndex) {
    if (animate === undefined) animate = true;
    if (messageIndex === undefined) messageIndex = -1;

    const messagesArea = C.elements.messagesArea;
    const typingDots = C.elements.typingDots;
    const welcome = messagesArea.querySelector('.welcome-msg');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `message ${role}`;
    if (messageIndex >= 0) div.dataset.msgIndex = messageIndex;

    div.innerHTML = renderContent(content);
    if (!animate) div.style.animation = 'none';

    C._addMessageActions(div, role, content, messageIndex);

    messagesArea.insertBefore(div, typingDots);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return div;
  };

  C.createAssistantMessageSkeleton = function() {
    const messagesArea = C.elements.messagesArea;
    const typingDots = C.elements.typingDots;
    const welcome = messagesArea.querySelector('.welcome-msg');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message assistant';
    messagesArea.insertBefore(div, typingDots);
    return div;
  };

  C.renderMarkdownInPlace = function(div, content) {
    div.innerHTML = renderContent(content);
    C._addMessageActions(div, 'assistant', content, -1);
  };

  C._addMessageActions = function(div, role, content, messageIndex) {
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

      if (role === 'user' && messageIndex >= 0) {
        const editBtn = document.createElement('button');
        editBtn.className = 'copy-btn edit-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = '编辑';
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          C.editUserMessage(div, content, messageIndex);
        });
        div.appendChild(editBtn);
      }

      if (role === 'assistant') {
        const regenBtn = document.createElement('button');
        regenBtn.className = 'copy-btn regen-btn';
        regenBtn.innerHTML = '🔄';
        regenBtn.title = '重新生成';
        regenBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          C.regenerateLastMessage();
        });
        div.appendChild(regenBtn);
      }
    }
  };
})();
