// chat.js — Bootstrap init, global event handlers, resize, tool confirm

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  /* ─── Tool Confirmation ─── */
  function showToolConfirmation(data) {
    const overlay = C.elements.toolConfirmOverlay;
    const nameEl = C.elements.confirmToolName;
    const paramsEl = C.elements.confirmToolParams;
    if (!overlay || !nameEl || !paramsEl) return;

    C.state.pendingToolConfirm = data;

    const toolLabels = {
      write_file: '📝 写文件',
      run_command: '💻 运行命令'
    };
    nameEl.textContent = toolLabels[data.toolName] || `🔧 ${data.toolName}`;

    const paramLines = Object.entries(data.args).map(([key, val]) => {
      const label = key === 'command' ? '命令' :
                    key === 'path' ? '路径' :
                    key === 'content' ? '内容' :
                    key === 'filename' ? '文件名' : key;
      const displayVal = typeof val === 'string' && val.length > 100
        ? val.slice(0, 100) + '...'
        : val;
      return `<div class="tool-confirm-param-line"><span class="tool-confirm-param-key">${label}:</span> <span class="tool-confirm-param-val">${C.escapeHtml(String(displayVal))}</span></div>`;
    }).join('');
    paramsEl.innerHTML = paramLines;

    overlay.style.display = 'flex';
  }

  function updateToolStatus(data) {
    let statusEl = document.getElementById(`tool-status-${data.toolCallId}`);
    const typingDots = C.elements.typingDots;

    if (data.status === 'pending') {
      statusEl = document.createElement('div');
      statusEl.id = `tool-status-${data.toolCallId}`;
      statusEl.className = 'tool-call-status';
      C.elements.messagesArea.insertBefore(statusEl, typingDots);
    }

    if (statusEl) {
      const toolLabels = {
        write_file: '📝 写文件', desktop_write_file: '📝 保存到桌面',
        read_file: '📖 读文件', list_directory: '📂 浏览目录',
        run_command: '💻 运行命令', get_system_info: 'ℹ️ 系统信息',
        open_url: '🔗 打开链接', get_desktop_path: '📁 桌面路径'
      };
      const label = toolLabels[data.toolName] || `🔧 ${data.toolName}`;

      if (data.status === 'pending') {
        statusEl.innerHTML = `<span class="tool-status-spinner">⟳</span> ${label}...`;
      } else if (data.status === 'completed') {
        statusEl.innerHTML = `<span class="tool-status-done">✓</span> ${label} 完成`;
        statusEl.classList.add('done');
        setTimeout(() => { statusEl.remove(); }, 3000);
      } else if (data.status === 'denied') {
        statusEl.innerHTML = `<span class="tool-status-denied">✕</span> ${label} 已拒绝`;
        statusEl.classList.add('denied');
        setTimeout(() => { statusEl.remove(); }, 2000);
      }
      C.elements.messagesArea.scrollTop = C.elements.messagesArea.scrollHeight;
    }
  }

  /* ─── Init ─── */
  C.init = async function() {
    await C.loadModelProviders();

    try {
      if (C.state.currentModelProvider) {
        const validation = await window.petAPI.validateModelApiKey(C.state.currentModelProvider.id);
        if (!validation.valid) {
          C.showApiKeyWarning(validation.reason);
        }
      }
    } catch {}

    const personality = await window.petAPI.getPersonality();
    C.elements.personalityInput.value = personality;

    const theme = await window.petAPI.getTheme();
    C.applyTheme(theme);

    await C.refreshConversationSelect();
    await C.loadConversationMessages();

    await C.initSearchToggle();

    const platform = await window.petAPI.getPlatform();
    if (platform === 'win32') {
      document.body.classList.add('win32');
    }

    window.petAPI.onMessagesUpdated(async () => {
      await C.loadConversationMessages();
      await C.refreshConversationSelect();
      C.loadHistory(); // background refresh
    });

    window.petAPI.onThemeChanged((theme) => {
      C.applyTheme(theme);
      const messagesArea = C.elements.messagesArea;
      const typingDots = C.elements.typingDots;
      if (messagesArea.querySelector('.welcome-msg')) {
        const sub = messagesArea.querySelector('.welcome-sub');
        messagesArea.innerHTML = C.renderWelcomeMessage(sub ? sub.textContent : '');
        messagesArea.appendChild(typingDots);
      }
    });

    window.petAPI.onFocusInput(() => {
      // Focus input listener — with retry for reliability
      const tryFocus = (attempt = 0) => {
        if (attempt > 5) return;
        C.elements.chatInput.focus({ preventScroll: false });
        // Check if focus actually landed — retry if not
        setTimeout(() => {
          if (document.activeElement !== C.elements.chatInput) {
            tryFocus(attempt + 1);
          } else {
            C.elements.messagesArea.scrollTop = C.elements.messagesArea.scrollHeight;
          }
        }, attempt * 50 + 50);
      };
      tryFocus();
    });

    // Tool confirmation listener
    if (window.petAPI.onToolConfirm) {
      window.petAPI.onToolConfirm((data) => {
        showToolConfirmation(data);
      });
    }

    // Tool execution status listener
    if (window.petAPI.onToolExecutionStatus) {
      window.petAPI.onToolExecutionStatus((data) => {
        updateToolStatus(data);
      });
    }

    C.setupUpdateListeners();
  };

  /* ─── Tool Confirm Buttons ─── */
  function initToolConfirmHandlers() {
    const allowBtn = C.elements.confirmAllowBtn;
    const denyBtn = C.elements.confirmDenyBtn;
    const overlay = C.elements.toolConfirmOverlay;
    if (!allowBtn || !denyBtn || !overlay) return;

    allowBtn.addEventListener('click', async () => {
      if (C.state.pendingToolConfirm) {
        const data = { toolCallId: C.state.pendingToolConfirm.toolCallId, confirmed: true };
        await window.petAPI.confirmToolResponse(data);
        overlay.style.display = 'none';
        C.state.pendingToolConfirm = null;
      }
    });

    denyBtn.addEventListener('click', async () => {
      if (C.state.pendingToolConfirm) {
        const data = { toolCallId: C.state.pendingToolConfirm.toolCallId, confirmed: false };
        await window.petAPI.confirmToolResponse(data);
        overlay.style.display = 'none';
        C.state.pendingToolConfirm = null;
      }
    });
  }

  /* ─── New chat, close, quit ─── */
  function initGlobalHandlers() {
    C.elements.newChatBtn.addEventListener('click', async () => {
      const historyPanel = C.elements.historyPanel;
      const settingsPanel = C.elements.settingsPanel;
      if (historyPanel) historyPanel.classList.remove('open');
      if (settingsPanel) settingsPanel.classList.remove('open');
      await window.petAPI.newConversation();
      await C.refreshConversationSelect();
      const messagesArea = C.elements.messagesArea;
      const typingDots = C.elements.typingDots;
      messagesArea.innerHTML = C.renderWelcomeMessage('有什么想聊的吗？');
      messagesArea.appendChild(typingDots);
      C.loadHistory(); // background refresh
    });

    C.elements.closeBtn.addEventListener('click', () => {
      window.petAPI.minimizeChat();
    });

    C.elements.quitBtn.addEventListener('click', () => {
      window.petAPI.quitApp();
    });
  }

  /* ─── Resize handles ─── */
  function initResizeHandlers() {
    const rs = C.state.resize;
    const MIN_WIDTH = 420;

    function getMinHeight() {
      return Math.round(screen.availHeight * 0.7);
    }

    document.querySelectorAll('.resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        rs.isResizing = true;
        rs.dir = handle.dataset.resize;
        rs.start = {
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
      if (!rs.isResizing) return;

      const dx = e.screenX - rs.start.x;
      const dy = e.screenY - rs.start.y;
      const minH = getMinHeight();

      let newWidth = rs.start.width;
      let newHeight = rs.start.height;

      if (rs.dir.includes('e')) newWidth = Math.max(MIN_WIDTH, rs.start.width + dx);
      if (rs.dir.includes('w')) newWidth = Math.max(MIN_WIDTH, rs.start.width - dx);
      if (rs.dir.includes('s')) newHeight = Math.max(minH, rs.start.height + dy);

      window.petAPI.resizeWindow(newWidth, newHeight);
    });

    document.addEventListener('mouseup', () => {
      rs.isResizing = false;
      rs.dir = null;
    });
  }

  // Wire everything up
  initGlobalHandlers();
  C.initConversationDropdown();
  C.initHistoryPanel();
  C.initInputHandlers();
  C.initSettingsHandlers();
  C.initGlobalSearch();
  initToolConfirmHandlers();
  initResizeHandlers();

  // Bootstrap
  C.init();
})();
