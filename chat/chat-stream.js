// chat-stream.js — Streaming, send, regenerate, edit

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  C.startStreamingRequest = function(userText, showUserMessage) {
    if (showUserMessage === undefined) showUserMessage = true;

    if (showUserMessage) {
      C.addMessage('user', userText);
    }
    const typingDots = C.elements.typingDots;
    typingDots.classList.add('show');

    const assistantDiv = C.createAssistantMessageSkeleton();
    let fullContent = '';

    if (C.state.streamCleanup) C.state.streamCleanup();

    C.state.streamCleanup = window.petAPI.onStreamChunk((data) => {
      if (data.done) {
        typingDots.classList.remove('show');
        if (!data.error) {
          C.renderMarkdownInPlace(assistantDiv, fullContent);
        }
        C.elements.sendBtn.disabled = false;
        C.state.isLoading = false;
        C.elements.chatInput.focus();
        C.refreshConversationSelect();
        if (C.state.streamCleanup) { C.state.streamCleanup(); C.state.streamCleanup = null; }
      } else if (data.error) {
        typingDots.classList.remove('show');
        assistantDiv.innerHTML = `<p>哎呀，出错了: ${data.text}</p>
          <button class="retry-btn">🔄 重试</button>`;
        assistantDiv.querySelector('.retry-btn').addEventListener('click', () => {
          assistantDiv.remove();
          C.regenerateLastMessage();
        });
        C.elements.sendBtn.disabled = false;
        C.state.isLoading = false;
        if (C.state.streamCleanup) { C.state.streamCleanup(); C.state.streamCleanup = null; }
      } else {
        typingDots.classList.remove('show');
        fullContent += data.text;
        assistantDiv.textContent = fullContent;
        C.elements.messagesArea.scrollTop = C.elements.messagesArea.scrollHeight;
      }
    });
  };

  C.regenerateLastMessage = async function() {
    if (C.state.isLoading) return;

    const messagesArea = C.elements.messagesArea;
    const assistantMessages = messagesArea.querySelectorAll('.message.assistant');
    if (assistantMessages.length > 0) {
      assistantMessages[assistantMessages.length - 1].remove();
    }

    C.state.isLoading = true;
    C.elements.sendBtn.disabled = true;
    const typingDots = C.elements.typingDots;
    typingDots.classList.add('show');

    const assistantDiv = C.createAssistantMessageSkeleton();
    let fullContent = '';

    if (C.state.streamCleanup) C.state.streamCleanup();

    C.state.streamCleanup = window.petAPI.onStreamChunk((data) => {
      if (data.done) {
        typingDots.classList.remove('show');
        if (!data.error) {
          C.renderMarkdownInPlace(assistantDiv, fullContent);
        }
        C.elements.sendBtn.disabled = false;
        C.state.isLoading = false;
        C.elements.chatInput.focus();
        C.refreshConversationSelect();
        if (C.state.streamCleanup) { C.state.streamCleanup(); C.state.streamCleanup = null; }
      } else if (data.error) {
        typingDots.classList.remove('show');
        assistantDiv.innerHTML = `<p>哎呀，出错了: ${data.text}</p>
          <button class="retry-btn">🔄 重试</button>`;
        assistantDiv.querySelector('.retry-btn').addEventListener('click', () => {
          assistantDiv.remove();
          C.regenerateLastMessage();
        });
        C.elements.sendBtn.disabled = false;
        C.state.isLoading = false;
        if (C.state.streamCleanup) { C.state.streamCleanup(); C.state.streamCleanup = null; }
      } else {
        typingDots.classList.remove('show');
        fullContent += data.text;
        assistantDiv.textContent = fullContent;
        C.elements.messagesArea.scrollTop = C.elements.messagesArea.scrollHeight;
      }
    });

    window.petAPI.regenerateMessage();
  };

  C.editUserMessage = function(messageDiv, originalContent, messageIndex) {
    if (C.state.isLoading) return;

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

      await window.petAPI.trimConversation(messageIndex);

      const messagesArea = C.elements.messagesArea;
      let found = false;
      const allMessages = [...messagesArea.querySelectorAll('.message')];
      for (const msg of allMessages) {
        if (msg === messageDiv) found = true;
        if (found) msg.remove();
      }

      C.elements.chatInput.value = newText;
      await C.sendMessage();
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
  };

  C.sendMessage = async function() {
    const chatInput = C.elements.chatInput;
    const text = chatInput.value.trim();
    if (!text || C.state.isLoading) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    C.elements.sendBtn.disabled = true;
    C.state.isLoading = true;

    C.startStreamingRequest(text, true);
    window.petAPI.sendMessage(text);
  };

  C.initInputHandlers = function() {
    const sendBtn = C.elements.sendBtn;
    const chatInput = C.elements.chatInput;
    const importBtn = C.elements.importBtn;

    sendBtn.addEventListener('click', C.sendMessage);

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        C.sendMessage();
      }
    });

    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });

    importBtn.addEventListener('click', async () => {
      if (C.state.isLoading) return;

      const result = await window.petAPI.importFile();
      if (!result) return;

      if (result.error) {
        C.addMessage('assistant', `哎呀，${result.error}`);
        return;
      }

      C.addMessage('user', `📄 导入文档：${result.fileName}`);

      C.elements.sendBtn.disabled = true;
      C.state.isLoading = true;

      const analysisPrompt = `请帮我分析以下文档内容：\n\n文件名：${result.fileName}\n\n${result.content}`;

      C.startStreamingRequest(analysisPrompt, false);
      window.petAPI.sendMessage(analysisPrompt);
    });
  };
})();
