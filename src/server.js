/**
 * Local HTTP API server for desktop-pet.
 *
 * Exposes a minimal REST endpoint on localhost so any client
 * (CLI, scripts, third-party tools) can call the AI engine.
 *
 * Zero external dependencies — uses Node.js built-in http module.
 */

const http = require('http');
const { buildSystemPrompt, callAIWithTools, generateConversationTitle } = require('./ai');
const { getActiveConversation, saveConversations, store } = require('./store');
const { getChatWindow } = require('./windows');

const DEFAULT_PORT = 9876;
let server = null;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleChat(body) {
  if (!body || !body.message) {
    return { error: '缺少 message 字段' };
  }

  const { conv, convs } = getActiveConversation();
  const history = (conv.messages || []).slice(-20);

  const messages = [
    buildSystemPrompt(null),
    ...history,
    { role: 'user', content: body.message }
  ];

  // Persist user message
  conv.messages.push({ role: 'user', content: body.message });
  conv.updatedAt = new Date().toISOString();
  if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
  saveConversations(convs);

  try {
    const reply = await callAIWithTools(messages);

    conv.messages.push({ role: 'assistant', content: reply });
    if (conv.title === '新对话') {
      const title = await generateConversationTitle(body.message, reply);
      if (title) conv.title = title;
    }
    conv.updatedAt = new Date().toISOString();
    saveConversations(convs);

    // Notify GUI to refresh
    const chatWindow = getChatWindow();
    if (chatWindow && !chatWindow.isDestroyed() && chatWindow.webContents) {
      chatWindow.webContents.send('messages-updated');
      chatWindow.webContents.send('stream-chunk', { text: reply, done: true });
    }

    return { reply };
  } catch (err) {
    // Remove the user message if AI call fails
    conv.messages.pop();
    saveConversations(convs);
    return { error: err.message };
  }
}

async function handleRequest(req, res) {
  // CORS for local clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJSON(res, 200, { ok: true, model: store.get('activeModelProviderId') });
    return;
  }

  if (req.method === 'POST' && req.url === '/chat') {
    const body = await parseBody(req);
    const result = await handleChat(body);
    sendJSON(res, result.error ? 400 : 200, result);
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
}

function startServer(port) {
  if (server) return;

  const p = port || store.get('serverPort') || DEFAULT_PORT;

  server = http.createServer(handleRequest);
  server.listen(p, '127.0.0.1', () => {
    console.log(`[Server] HTTP API running at http://127.0.0.1:${p}`);
    console.log(`[Server]   POST /chat  {"message": "..."}`);
    console.log(`[Server]   GET  /health`);
    store.set('serverPort', p);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] 端口 ${p} 已被占用，尝试 ${p + 1}...`);
      server = null;
      startServer(p + 1);
    } else {
      console.error('[Server] 启动失败:', err.message);
    }
  });
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
    console.log('[Server] 已停止');
  }
}

module.exports = { startServer, stopServer };
