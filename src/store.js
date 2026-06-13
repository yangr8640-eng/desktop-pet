const Store = require('electron-store');

const store = new Store({
  defaults: {
    petPosition: null,
    conversations: [],
    activeConversationId: null,
    modelProviders: [],
    activeModelProviderId: 'deepseek',
    searchEnabled: false,
    personalityPrompt: '',
    activeTheme: 'claude'
  }
});

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getConversations() {
  return store.get('conversations') || [];
}

function saveConversations(convs) {
  store.set('conversations', convs);
}

function getActiveConversation() {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  let conv = convs.find(c => c.id === activeId);
  if (!conv) {
    conv = {
      id: generateId(),
      title: '新对话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    convs.push(conv);
    store.set('activeConversationId', conv.id);
    saveConversations(convs);
  }
  return { conv, convs };
}

function getConversationList() {
  const convs = getConversations();
  return convs.map(c => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt
  })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function updateActiveConversation(updater) {
  const convs = getConversations();
  const activeId = store.get('activeConversationId');
  const idx = convs.findIndex(c => c.id === activeId);
  if (idx >= 0) {
    updater(convs[idx]);
    saveConversations(convs);
  }
}

/* ─── Model Provider helpers ─── */
const PRESET_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/chat/completions',
    modelName: 'deepseek-chat',
    order: 0
  },
  {
    id: 'openai',
    name: 'OpenAI / ChatGPT',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://api.openai.com/v1/chat/completions',
    modelName: 'gpt-4o',
    supportsVision: true,
    order: 1
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (支持图片)',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    modelName: 'Qwen/Qwen2-VL-72B-Instruct',
    supportsVision: true,
    order: 2
  },
  {
    id: 'dashscope',
    name: '通义千问 VL (阿里云)',
    type: 'preset',
    apiKey: '',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    modelName: 'qwen-vl-max',
    supportsVision: true,
    order: 3
  }
];

function getModelProviders() {
  return store.get('modelProviders') || [];
}

function saveModelProviders(providers) {
  store.set('modelProviders', providers);
}

function ensurePresetProviders() {
  let providers = getModelProviders();
  let changed = false;
  for (const preset of PRESET_PROVIDERS) {
    const existing = providers.find(p => p.id === preset.id);
    if (!existing) {
      providers.push({ ...preset });
      changed = true;
    } else if (existing.type === 'preset') {
      // Sync code-defined fields for presets (e.g., supportsVision)
      if (existing.supportsVision !== preset.supportsVision) {
        existing.supportsVision = preset.supportsVision;
        changed = true;
      }
    }
  }
  if (changed) saveModelProviders(providers);
  return providers;
}

/** Check if a model name suggests vision support */
function modelNameSupportsVision(modelName) {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  return /vl|vision|visual|multimodal|internvl|qwen2-vl|gemini|gpt-4o|gpt-4\.1|claude-3\.5-sonnet|claude-3\.5-haiku|claude-opus/i.test(name);
}

function getActiveModelProvider() {
  ensurePresetProviders();
  const providers = getModelProviders();
  const activeId = store.get('activeModelProviderId') || 'deepseek';
  let provider = providers.find(p => p.id === activeId);
  if (!provider) {
    provider = providers[0] || PRESET_PROVIDERS[0];
    store.set('activeModelProviderId', provider.id);
  }
  // Auto-detect vision support for custom models
  if (provider.supportsVision === undefined) {
    provider.supportsVision = modelNameSupportsVision(provider.modelName);
  }
  return provider;
}

function runMigrations() {
  // Migrate old single apiKey to modelProviders array
  const oldApiKey = store.get('apiKey');
  if (oldApiKey !== undefined) {
    const providers = store.get('modelProviders');
    if (!providers || providers.length === 0) {
      store.set('modelProviders', [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          type: 'preset',
          apiKey: oldApiKey || '',
          apiBaseUrl: 'https://api.deepseek.com/chat/completions',
          modelName: 'deepseek-chat',
          order: 0
        }
      ]);
      store.set('activeModelProviderId', 'deepseek');
    }
    store.delete('apiKey');
  }

  // Migrate old chatHistory to new conversations model
  const conversations = store.get('conversations');
  if (!conversations || conversations.length === 0) {
    const oldHistory = store.get('chatHistory');
    if (oldHistory && oldHistory.length > 0) {
      const migratedConv = {
        id: generateId(),
        title: '历史对话',
        messages: oldHistory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.set('conversations', [migratedConv]);
      store.set('activeConversationId', migratedConv.id);
      store.delete('chatHistory');
    }
  }
  // Clean up any leftover chatHistory key from old data model
  if (store.get('chatHistory') !== undefined) {
    store.delete('chatHistory');
  }
}

module.exports = {
  store,
  generateId,
  getConversations,
  saveConversations,
  getActiveConversation,
  getConversationList,
  updateActiveConversation,
  PRESET_PROVIDERS,
  getModelProviders,
  saveModelProviders,
  ensurePresetProviders,
  getActiveModelProvider,
  modelNameSupportsVision,
  runMigrations
};
