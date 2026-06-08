const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // Chat
  sendMessage: (msg) => ipcRenderer.invoke('send-message', msg),
  analyzeFile: (filePath) => ipcRenderer.invoke('analyze-file', filePath),
  getFilePath: (file) => webUtils.getPathForFile(file),
  getHistory: () => ipcRenderer.invoke('get-history'),

  // Conversations
  getConversations: () => ipcRenderer.invoke('get-conversations'),
  getAllConversations: () => ipcRenderer.invoke('get-all-conversations'),
  getActiveConversationId: () => ipcRenderer.invoke('get-active-conversation-id'),
  switchConversation: (id) => ipcRenderer.invoke('switch-conversation', id),
  newConversation: () => ipcRenderer.invoke('new-conversation'),
  deleteConversation: (id) => ipcRenderer.invoke('delete-conversation', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // File import
  importFile: () => ipcRenderer.invoke('import-file'),
  importDroppedFile: (filePath) => ipcRenderer.invoke('import-dropped-file', filePath),
  readPendingFiles: (filePaths) => ipcRenderer.invoke('read-pending-files', filePaths),

  // Model Providers
  getModelProviders: () => ipcRenderer.invoke('get-model-providers'),
  saveModelProvider: (provider) => ipcRenderer.invoke('save-model-provider', provider),
  deleteModelProvider: (id) => ipcRenderer.invoke('delete-model-provider', id),
  getActiveModelProvider: () => ipcRenderer.invoke('get-active-model-provider'),
  setActiveModelProvider: (id) => ipcRenderer.invoke('set-active-model-provider', id),
  validateModelApiKey: (providerId) => ipcRenderer.invoke('validate-model-api-key', providerId),

  // Search toggle
  toggleSearch: () => ipcRenderer.invoke('toggle-search'),
  getSearchEnabled: () => ipcRenderer.invoke('get-search-enabled'),

  // Personality
  savePersonality: (text) => ipcRenderer.invoke('save-personality', text),
  getPersonality: () => ipcRenderer.invoke('get-personality'),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (themeId) => ipcRenderer.invoke('set-theme', themeId),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_event, theme) => cb(theme)),

  // Expression (multi-expression support)
  setPetExpression: (name) => ipcRenderer.send('set-expression', name),

  // Window controls
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),
  resizePet: (width, height) => ipcRenderer.send('resize-pet', width, height),
  openChat: () => ipcRenderer.send('open-chat'),
  showChat: () => ipcRenderer.send('show-chat'),
  closeChat: () => ipcRenderer.send('close-chat'),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  savePosition: (pos) => ipcRenderer.send('save-position', pos),
  minimizeChat: () => ipcRenderer.send('minimize-chat'),
  quitApp: () => ipcRenderer.send('quit-app'),

  // Listen for events from main
  onFocusInput: (cb) => ipcRenderer.on('focus-input', () => cb()),
  onMessagesUpdated: (cb) => ipcRenderer.on('messages-updated', () => cb()),

  // System tools / Agent
  getSystemTools: () => ipcRenderer.invoke('get-system-tools'),
  confirmToolResponse: (data) => ipcRenderer.invoke('confirm-tool-response', data),
  onToolConfirm: (cb) => ipcRenderer.on('request-tool-confirm', (_event, data) => cb(data)),
  onToolExecutionStatus: (cb) => ipcRenderer.on('tool-execution-status', (_event, data) => cb(data))
});
