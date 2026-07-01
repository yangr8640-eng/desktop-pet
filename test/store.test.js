const path = require('path');

// Mock electron-store before importing store module
const mockStoreData = {};
let mockStoreInstance;

jest.mock('electron-store', () => {
  return function Store(options) {
    mockStoreInstance = this;
    this.defaults = options.defaults || {};
    this.data = {};

    // Initialize with defaults
    for (const [key, val] of Object.entries(this.defaults)) {
      this.data[key] = val;
    }

    this.get = function(key) { return this.data[key]; };
    this.set = function(key, val) { this.data[key] = val; };
    this.delete = function(key) { delete this.data[key]; };

    return this;
  };
});

// Clear module cache and reload store for each test
let storeModule;
beforeEach(() => {
  jest.resetModules();
  // Clear the mocked instance data
  storeModule = require('../src/store');
});

describe('generateId', () => {
  test('returns a non-empty string', () => {
    const id = storeModule.generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('produces unique values on consecutive calls', () => {
    const id1 = storeModule.generateId();
    const id2 = storeModule.generateId();
    expect(id1).not.toBe(id2);
  });
});

describe('getActiveConversation', () => {
  test('creates a new conversation when none exist', () => {
    const { conv, convs } = storeModule.getActiveConversation();
    expect(conv).toBeDefined();
    expect(conv.title).toBe('新对话');
    expect(conv.messages).toEqual([]);
    expect(convs).toHaveLength(1);
    expect(convs[0].id).toBe(conv.id);
  });

  test('returns existing conversation by activeId', () => {
    // First call creates it
    const first = storeModule.getActiveConversation();
    // Second call should return the same
    const second = storeModule.getActiveConversation();
    expect(second.conv.id).toBe(first.conv.id);
    expect(second.convs).toHaveLength(1);
  });

  test('creates new conversation when activeId is stale', () => {
    const first = storeModule.getActiveConversation();
    // Manually set activeConversationId to a non-existent id
    storeModule.store.set('activeConversationId', 'nonexistent');
    const second = storeModule.getActiveConversation();
    expect(second.conv.id).not.toBe(first.conv.id);
  });
});

describe('getConversationList', () => {
  test('returns sorted list with id/title/updatedAt', () => {
    const convs = storeModule.store.get('conversations') || [];
    convs.push(
      { id: 'a', title: 'Older', messages: [], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
      { id: 'b', title: 'Newer', messages: [], createdAt: '2025-06-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' }
    );
    storeModule.store.set('conversations', convs);

    const list = storeModule.getConversationList();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Newest first
    expect(list[0].title).toBe('Newer');
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('updatedAt');
    // Should not expose messages
    expect(list[0]).not.toHaveProperty('messages');
  });
});

describe('updateActiveConversation', () => {
  test('applies updater to the active conversation', () => {
    const { conv } = storeModule.getActiveConversation();
    storeModule.updateActiveConversation(c => { c.title = 'Updated Title'; });

    const { conv: updated } = storeModule.getActiveConversation();
    expect(updated.title).toBe('Updated Title');
  });
});

describe('ensurePresetProviders', () => {
  test('seeds DeepSeek and OpenAI presets when providers are empty', () => {
    const providers = storeModule.ensurePresetProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
    expect(providers.find(p => p.id === 'deepseek')).toBeDefined();
    expect(providers.find(p => p.id === 'openai')).toBeDefined();
  });

  test('does not duplicate presets on second call', () => {
    const first = storeModule.ensurePresetProviders();
    const second = storeModule.ensurePresetProviders();
    expect(second.length).toBe(first.length);
  });
});

describe('getActiveModelProvider', () => {
  test('returns deepseek by default', () => {
    const provider = storeModule.getActiveModelProvider();
    expect(provider.id).toBe('deepseek');
    expect(provider.type).toBe('preset');
  });

  test('falls back to first provider when activeId is invalid', () => {
    storeModule.store.set('activeModelProviderId', 'nonexistent');
    const provider = storeModule.getActiveModelProvider();
    expect(provider).toBeDefined();
    expect(provider.id).toBe('deepseek');
  });
});

describe('saveModelProvider / deleteModelProvider', () => {
  // These are tested via store methods since ipc-handlers wraps them
  test('store can save and retrieve providers', () => {
    storeModule.ensurePresetProviders();
    const providers = storeModule.getModelProviders();
    providers.push({
      id: 'custom-test',
      name: 'Test Custom',
      type: 'custom',
      apiKey: 'sk-test',
      apiBaseUrl: 'https://test.example.com/v1',
      modelName: 'test-model'
    });
    storeModule.store.set('modelProviders', providers);

    const saved = storeModule.getModelProviders();
    const custom = saved.find(p => p.id === 'custom-test');
    expect(custom).toBeDefined();
    expect(custom.apiKey).toBe('sk-test');
  });

  test('delete provider removes it from the list', () => {
    storeModule.ensurePresetProviders();
    const providers = storeModule.getModelProviders();
    const filtered = providers.filter(p => p.id !== 'openai');
    storeModule.store.set('modelProviders', filtered);

    const after = storeModule.getModelProviders();
    expect(after.find(p => p.id === 'openai')).toBeUndefined();
    expect(after.find(p => p.id === 'deepseek')).toBeDefined();
  });
});

describe('runMigrations', () => {
  test('migrates old apiKey to modelProviders', () => {
    storeModule.store.set('apiKey', 'sk-old-key');
    storeModule.store.set('modelProviders', []);
    storeModule.store.set('activeModelProviderId', null);

    storeModule.runMigrations();

    const providers = storeModule.store.get('modelProviders');
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0].apiKey).toBe('sk-old-key');
    expect(providers[0].id).toBe('deepseek');
    expect(storeModule.store.get('apiKey')).toBeUndefined();
  });

  test('migrates old chatHistory to conversations', () => {
    const oldHistory = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' }
    ];
    storeModule.store.set('conversations', []);
    storeModule.store.set('chatHistory', oldHistory);

    storeModule.runMigrations();

    const conversations = storeModule.store.get('conversations');
    expect(conversations.length).toBe(1);
    expect(conversations[0].title).toBe('历史对话');
    expect(conversations[0].messages).toEqual(oldHistory);
    expect(storeModule.store.get('chatHistory')).toBeUndefined();
  });

  test('does not overwrite existing conversations', () => {
    const existingConvs = [{ id: 'test', title: 'Existing', messages: [], createdAt: '', updatedAt: '' }];
    storeModule.store.set('conversations', existingConvs);
    storeModule.store.set('chatHistory', [{ role: 'user', content: 'old' }]);

    storeModule.runMigrations();

    const conversations = storeModule.store.get('conversations');
    expect(conversations).toBe(existingConvs);
  });

  test('cleans up leftover chatHistory key', () => {
    storeModule.store.set('chatHistory', []);
    storeModule.store.set('conversations', [{ id: 'c', title: 'T', messages: [], createdAt: '', updatedAt: '' }]);

    storeModule.runMigrations();

    expect(storeModule.store.get('chatHistory')).toBeUndefined();
  });
});
