// chat-messages.js — Message rendering functions

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

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

    let html = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

    div.innerHTML = html;
    if (!animate) div.style.animation = 'none';

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
    const messagesArea = C.elements.messagesArea;

    let html = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

    div.innerHTML = html;

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

    messagesArea.querySelectorAll('.message.assistant .regen-btn').forEach(b => b.remove());
    const regenBtn = document.createElement('button');
    regenBtn.className = 'copy-btn regen-btn';
    regenBtn.innerHTML = '🔄';
    regenBtn.title = '重新生成';
    regenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      C.regenerateLastMessage();
    });
    div.appendChild(regenBtn);
  };
})();
