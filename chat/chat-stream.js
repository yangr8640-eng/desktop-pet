// chat-stream.js — Streaming, send, regenerate, edit, file drag-drop

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  // Shared stream response handler
  C._handleStreamResponse = function(assistantDiv) {
    const typingDots = C.elements.typingDots;
    let fullContent = '';
    typingDots.classList.add('show');

    if (C.state.streamCleanup) {
      window.petAPI.cancelRequest();
      C.state.streamCleanup();
    }

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

  C.startStreamingRequest = function(userText, showUserMessage) {
    if (showUserMessage === undefined) showUserMessage = true;

    if (showUserMessage) {
      C.addMessage('user', userText);
    }

    const assistantDiv = C.createAssistantMessageSkeleton();
    C._handleStreamResponse(assistantDiv);
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

    const assistantDiv = C.createAssistantMessageSkeleton();
    C._handleStreamResponse(assistantDiv);

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

  /* ─── Pending Files (preview chips above input) ─── */
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
    const list = C.elements.filePreviewList;
    const area = C.elements.filePreviewArea;
    list.innerHTML = '';
    if (C.state.pendingFiles.length === 0) {
      area.style.display = 'none';
      return;
    }
    area.style.display = 'block';

    C.state.pendingFiles.forEach((f, i) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `
        <span class="file-chip-icon">${getFileIcon(f.ext)}</span>
        <span class="file-chip-name">${C.escapeHtml(f.fileName)}</span>
        <button class="file-chip-remove" data-index="${i}">✕</button>
      `;
      chip.querySelector('.file-chip-remove').addEventListener('click', () => {
        C.state.pendingFiles.splice(i, 1);
        renderFilePreviews();
      });
      list.appendChild(chip);
    });
  }

  function addPendingFile(filePath, fileName) {
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    const allowed = ['.pdf', '.docx', '.txt', '.md', '.json', '.csv', '.log', '.xml', '.yaml', '.yml',
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    if (!allowed.includes(ext)) {
      C.addMessage('assistant', `暂不支持 ${ext} 格式的文件~`);
      return false;
    }
    if (C.state.pendingFiles.some(f => f.filePath === filePath)) return false;
    C.state.pendingFiles.push({ filePath, fileName, ext });
    renderFilePreviews();
    return true;
  }

  /* ─── File Import (📎 button) ─── */
  C.initFileImportHandlers = function() {
    const importBtn = C.elements.importBtn;
    const hiddenFileInput = C.elements.hiddenFileInput;
    if (!importBtn || !hiddenFileInput) return;

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
      if (added > 0) C.elements.chatInput.focus();
    });

    // Drag & Drop onto the chat window
    const dropOverlay = C.elements.dropOverlay;
    if (dropOverlay) {
      document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        C.state.dropCounter++;
        if (C.state.dropCounter === 1) {
          dropOverlay.classList.add('show');
        }
      });

      document.addEventListener('dragleave', (e) => {
        C.state.dropCounter--;
        if (C.state.dropCounter === 0) {
          dropOverlay.classList.remove('show');
        }
      });

      document.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      document.addEventListener('drop', (e) => {
        e.preventDefault();
        C.state.dropCounter = 0;
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
          C.elements.chatInput.focus();
          C.elements.chatInput.placeholder = '输入指令，将文件发送给AI...';
          setTimeout(() => {
            C.elements.chatInput.placeholder = `跟${C.elements.headerTitle.textContent || 'Claude'}说点什么...`;
          }, 2000);
        }
      });
    }
  };

  const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

  /* ─── Send Message (with pending files & image support) ─── */
  C.sendMessage = async function() {
    const chatInput = C.elements.chatInput;
    const text = chatInput.value.trim();
    if ((!text && C.state.pendingFiles.length === 0) || C.state.isLoading) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    C.elements.sendBtn.disabled = true;
    C.state.isLoading = true;

    // Separate images from text/files
    const imageFiles = C.state.pendingFiles.filter(f => IMAGE_EXTS.includes(f.ext));
    const textFiles = C.state.pendingFiles.filter(f => !IMAGE_EXTS.includes(f.ext));

    // Build text context from non-image files
    let fullContent = text;
    let imageData = [];

    if (textFiles.length > 0) {
      const filePaths = textFiles.map(f => f.filePath);
      const fileResults = await window.petAPI.readPendingFiles(filePaths);

      const fileContext = fileResults.map(r => {
        if (r.error) return `[文件: ${r.fileName} - 读取失败: ${r.error}]`;
        return `[文件: ${r.fileName}]\n${r.content}\n[${r.fileName} 结束]`;
      }).join('\n\n');

      fullContent = text ? `${fileContext}\n\n---\n用户指令: ${text}` : `${fileContext}\n\n---\n请分析以上文件`;
    }

    // Read image files through the same IPC (returns base64 for images)
    if (imageFiles.length > 0) {
      const imagePaths = imageFiles.map(f => f.filePath);
      const imageResults = await window.petAPI.readPendingFiles(imagePaths);
      imageData = imageResults.filter(r => r.isImage && r.base64).map(r => ({
        base64: r.base64,
        mimeType: r.mimeType,
        fileName: r.fileName
      }));
    }

    // Clear pending files
    C.state.pendingFiles = [];
    renderFilePreviews();

    C.startStreamingRequest(text || `📄 发送了文件`, true);
    // Send with images data as {text, images} format
    window.petAPI.sendMessage(fullContent, imageData);
  };

  C.initInputHandlers = function() {
    const sendBtn = C.elements.sendBtn;
    const chatInput = C.elements.chatInput;

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

    // Initialize file import and drag-drop handlers
    C.initFileImportHandlers();
  };
})();
