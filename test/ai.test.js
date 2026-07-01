// Mock store module
const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  store: { get: jest.fn(), set: jest.fn(), delete: jest.fn() }
};

jest.mock('../src/store', () => ({
  store: {
    get: jest.fn().mockReturnValue('claude'),
    set: jest.fn(),
    delete: jest.fn()
  },
  getActiveModelProvider: jest.fn().mockReturnValue({
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'preset',
    apiKey: 'sk-test-key',
    apiBaseUrl: 'https://api.deepseek.com/chat/completions',
    modelName: 'deepseek-chat'
  }),
  getModelProviders: jest.fn().mockReturnValue([
    {
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'preset',
      apiKey: 'sk-test-key',
      apiBaseUrl: 'https://api.deepseek.com/chat/completions',
      modelName: 'deepseek-chat'
    }
  ])
}));

jest.mock('../themes', () => ({
  getTheme: jest.fn().mockReturnValue({
    id: 'claude',
    name: 'Claude',
    emoji: '💠',
    personality: '冷静、理性、喜欢用代码说话',
    accent: '#6C5CE7'
  })
}));

const { buildSystemPrompt, validateModelApiKey } = require('../src/ai');
const { getTheme } = require('../themes');

describe('buildSystemPrompt', () => {
  test('returns object with role: system', () => {
    const result = buildSystemPrompt(null);
    expect(result.role).toBe('system');
    expect(typeof result.content).toBe('string');
  });

  test('includes today date in Chinese format', () => {
    const result = buildSystemPrompt(null);
    const now = new Date();
    const expectedYear = `${now.getFullYear()}年`;
    expect(result.content).toContain(expectedYear);
    expect(result.content).toContain('月');
    expect(result.content).toContain('日');
  });

  test('includes theme name and personality', () => {
    const result = buildSystemPrompt(null);
    expect(result.content).toContain('Claude');
    expect(result.content).toContain('冷静、理性、喜欢用代码说话');
  });

  test('includes search context when provided', () => {
    const searchCtx = '\n\n【联网搜索结果】\nsome search data';
    const result = buildSystemPrompt(searchCtx);
    expect(result.content).toContain('联网搜索结果');
    expect(result.content).toContain('some search data');
  });

  test('includes personality prompt when stored', () => {
    const { store } = require('../src/store');
    store.get.mockReturnValue('用英文回答');
    const result = buildSystemPrompt(null);
    expect(result.content).toContain('用户偏好');
    expect(result.content).toContain('用英文回答');
    // Reset mock
    store.get.mockReturnValue('claude');
  });
});

describe('validateModelApiKey', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns no-key when provider has no key', async () => {
    const { store, getModelProviders } = require('../src/store');
    // Provider without key
    getModelProviders.mockReturnValueOnce([
      {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'preset',
        apiKey: '',
        apiBaseUrl: 'https://api.deepseek.com/chat/completions',
        modelName: 'deepseek-chat'
      }
    ]);

    const result = await validateModelApiKey('deepseek');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no-key');
  });

  test('returns valid:true on successful API response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200
    });

    const { store, getModelProviders } = require('../src/store');
    getModelProviders.mockReturnValueOnce([
      {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'preset',
        apiKey: 'sk-valid',
        apiBaseUrl: 'https://api.deepseek.com/chat/completions',
        modelName: 'deepseek-chat'
      }
    ]);

    const result = await validateModelApiKey('deepseek');
    expect(result.valid).toBe(true);
  });

  test('returns invalid-key on 401/403', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401
    });

    const { store, getModelProviders } = require('../src/store');
    getModelProviders.mockReturnValueOnce([
      {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'preset',
        apiKey: 'sk-invalid',
        apiBaseUrl: 'https://api.deepseek.com/chat/completions',
        modelName: 'deepseek-chat'
      }
    ]);

    const result = await validateModelApiKey('deepseek');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid-key');
  });

  test('returns valid:true with network-error on fetch failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const { store, getModelProviders } = require('../src/store');
    getModelProviders.mockReturnValueOnce([
      {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'preset',
        apiKey: 'sk-test',
        apiBaseUrl: 'https://api.deepseek.com/chat/completions',
        modelName: 'deepseek-chat'
      }
    ]);

    const result = await validateModelApiKey('deepseek');
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('network-error');
  });
});
