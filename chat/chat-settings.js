// chat-settings.js — Theme, model providers, API key, personality, export

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  C.applyTheme = function(theme) {
    C.state.currentWelcomeEmoji = theme.emoji;
    C.state.currentWelcomeGreeting = theme.welcomeGreeting;
    C.state.currentWelcomeSubtitle = theme.welcomeSubtitle;

    const root = document.documentElement;
    root.style.setProperty('--accent', theme.accentColor);
    root.style.setProperty('--accent-dark', theme.accentColorDark);
    root.style.setProperty('--accent-rgb', C.hexToRgb(theme.accentColor));

    if (theme.bubbleStyle === 'cyber') {
      document.body.classList.add('cyber');
    } else {
      document.body.classList.remove('cyber');
    }

    C.elements.headerIcon.textContent = theme.emoji;
    C.elements.headerTitle.textContent = theme.name;
    C.elements.chatInput.placeholder = `跟${theme.name}说点什么...`;

    const welcomeIcon = document.getElementById('welcomeIcon');
    const welcomeText = document.getElementById('welcomeText');
    if (welcomeIcon) welcomeIcon.textContent = theme.emoji;
    if (welcomeText) welcomeText.textContent = theme.welcomeGreeting;

    C.elements.themeSelect.value = theme.id;
  };

  C.loadModelProviders = async function() {
    C.state.modelProviders = await window.petAPI.getModelProviders();
    C.state.currentModelProvider = await window.petAPI.getActiveModelProvider();

    const modelSelect = C.elements.modelSelect;
    modelSelect.innerHTML = '';
    C.state.modelProviders.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.type === 'preset' ? p.name : `${p.name} (自定义)`;
      if (p.id === C.state.currentModelProvider.id) opt.selected = true;
      modelSelect.appendChild(opt);
    });

    C.renderModelConfig(C.state.currentModelProvider);
  };

  C.renderModelConfig = function(provider) {
    if (!provider) return;
    C.state.currentModelProvider = provider;

    C.elements.apiKeyInput.value = provider.apiKey || '';
    C.elements.keyValidation.style.display = 'none';
    C.elements.modelInfo.textContent = '';

    if (provider.type === 'preset') {
      C.elements.modelCustomFields.style.display = 'none';
      C.elements.deleteModelBtn.style.display = 'none';
      C.elements.modelInfo.textContent = `端点: ${provider.apiBaseUrl}  |  模型: ${provider.modelName}`;
    } else {
      C.elements.modelCustomFields.style.display = 'block';
      C.elements.deleteModelBtn.style.display = 'block';
      C.elements.modelNameInput.value = provider.name || '';
      C.elements.modelUrlInput.value = provider.apiBaseUrl || '';
      C.elements.modelModelIdInput.value = provider.modelName || '';
    }
  };

  C.showKeyValidation = function(validation) {
    const kv = C.elements.keyValidation;
    kv.style.display = 'block';
    if (validation.valid) {
      kv.textContent = 'API Key 有效 ✓';
      kv.className = 'settings-validation valid';
    } else if (validation.reason === 'no-key') {
      kv.textContent = '尚未设置 API Key';
      kv.className = 'settings-validation invalid';
    } else if (validation.reason === 'invalid-key') {
      kv.textContent = 'API Key 无效，请检查';
      kv.className = 'settings-validation invalid';
    } else {
      kv.style.display = 'none';
    }
  };

  C.showApiKeyWarning = function(reason) {
    const banner = document.getElementById('apiKeyWarning');
    const textEl = document.getElementById('warningText');
    if (!banner || !textEl) return;

    const modelName = C.state.currentModelProvider ? C.state.currentModelProvider.name : 'AI';
    const name = C.elements.headerTitle.textContent || 'Claude';

    if (reason === 'no-key') {
      textEl.textContent = `还没设置${modelName}的API Key哦，${name}没法和你聊天~ 请在下方输入API Key。`;
    } else if (reason === 'invalid-key') {
      textEl.textContent = `${modelName}的API Key好像不对，${name}连不上~ 请检查并重新输入。`;
    } else {
      textEl.textContent = 'API Key可能有问题，请检查后重试~';
    }

    banner.style.display = 'flex';
    C.elements.settingsPanel.classList.add('open');
  };

  C.initSettingsHandlers = function() {
    const settingsBtn = C.elements.settingsBtn;
    const settingsPanel = C.elements.settingsPanel;
    const modelSelect = C.elements.modelSelect;
    const saveKeyBtn = C.elements.saveKeyBtn;
    const apiKeyInput = C.elements.apiKeyInput;
    const addModelBtn = C.elements.addModelBtn;
    const deleteModelBtn = C.elements.deleteModelBtn;
    const savePersonalityBtn = C.elements.savePersonalityBtn;
    const personalityInput = C.elements.personalityInput;
    const exportSettingsBtn = C.elements.exportSettingsBtn;
    const themeSelect = C.elements.themeSelect;

    settingsBtn.addEventListener('click', () => {
      settingsPanel.classList.toggle('open');
    });

    modelSelect.addEventListener('change', async () => {
      const providerId = modelSelect.value;
      const provider = await window.petAPI.setActiveModelProvider(providerId);
      if (provider) {
        C.renderModelConfig(provider);
        const validation = await window.petAPI.validateModelApiKey(providerId);
        C.showKeyValidation(validation);
      }
    });

    saveKeyBtn.addEventListener('click', async () => {
      if (!C.state.currentModelProvider) return;

      const updated = {
        id: C.state.currentModelProvider.id,
        type: C.state.currentModelProvider.type,
        apiKey: apiKeyInput.value.trim()
      };

      if (C.state.currentModelProvider.type === 'custom') {
        updated.name = C.elements.modelNameInput.value.trim() || C.state.currentModelProvider.name;
        updated.apiBaseUrl = C.elements.modelUrlInput.value.trim() || C.state.currentModelProvider.apiBaseUrl;
        updated.modelName = C.elements.modelModelIdInput.value.trim() || C.state.currentModelProvider.modelName;
      }

      await window.petAPI.saveModelProvider(updated);

      const warningBanner = document.getElementById('apiKeyWarning');
      if (warningBanner) warningBanner.style.display = 'none';

      saveKeyBtn.textContent = '已保存 ✓';
      saveKeyBtn.style.background = '#4CAF50';

      const validation = await window.petAPI.validateModelApiKey(C.state.currentModelProvider.id);
      C.showKeyValidation(validation);

      await C.loadModelProviders();

      setTimeout(() => {
        saveKeyBtn.textContent = '保存';
        saveKeyBtn.style.background = '';
      }, 1500);
    });

    addModelBtn.addEventListener('click', async () => {
      const customId = 'custom_' + Date.now().toString(36);
      const newProvider = {
        id: customId,
        name: '自定义模型',
        type: 'custom',
        apiKey: '',
        apiBaseUrl: '',
        modelName: '',
        order: C.state.modelProviders.length
      };

      await window.petAPI.saveModelProvider(newProvider);
      await window.petAPI.setActiveModelProvider(customId);
      await C.loadModelProviders();
    });

    deleteModelBtn.addEventListener('click', async () => {
      if (!C.state.currentModelProvider || C.state.currentModelProvider.type === 'preset') return;

      const success = await window.petAPI.deleteModelProvider(C.state.currentModelProvider.id);
      if (success) {
        await C.loadModelProviders();
      }
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

    exportSettingsBtn.addEventListener('click', async () => {
      await window.petAPI.exportConversation();
    });

    themeSelect.addEventListener('change', async () => {
      await window.petAPI.setTheme(themeSelect.value);
      const theme = await window.petAPI.getTheme();
      C.applyTheme(theme);
    });

    // Auto-launch toggle
    const autoLaunchToggle = C.elements.autoLaunchToggle;
    if (autoLaunchToggle) {
      window.petAPI.getAutoLaunch().then(enabled => {
        autoLaunchToggle.checked = enabled;
      });
      autoLaunchToggle.addEventListener('change', async () => {
        await window.petAPI.setAutoLaunch(autoLaunchToggle.checked);
      });
    }
  };
})();
