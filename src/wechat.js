/**
 * WeChat ClawBot iLink Protocol Module
 *
 * Implements the official Tencent iLink Bot API for connecting
 * desktop-pet to WeChat via the ClawBot channel.
 *
 * Protocol: pure HTTP/JSON long-polling at ilinkai.weixin.qq.com
 */

const QRCode = require('qrcode');
const { store, getActiveConversation, saveConversations, generateId } = require('./store');
const { callAIWithTools, buildSystemPrompt, generateConversationTitle } = require('./ai');
const { getChatWindow } = require('./windows');

// ─── Constants ───
const ILINK_BASE = 'https://ilinkai.weixin.qq.com';
const CLIENT_VERSION = '132099'; // 2.4.3 → (2<<16)|(4<<8)|3
const BOT_TYPE = '3';
const QR_POLL_INTERVAL = 3000;    // 3 seconds between QR status polls
const LONGPOLL_TIMEOUT = 35000;   // Server holds connection up to 35s
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const TYPING_REFRESH_INTERVAL = 5000; // Re-send typing indicator every 5s

// ─── State ───
let running = false;
let loginPollTimer = null;
let messageLoopTimer = null;
let currentController = null;
let consecutiveErrors = 0;
let lastMessageTime = null;

const state = {
  status: 'disconnected', // 'disconnected' | 'qr_pending' | 'qr_confirmed' | 'logged_in' | 'running' | 'error'
  qrCode: null,           // QR code image URL (shown in UI)
  qrId: null,             // QR code ID (for polling)
  botToken: null,
  baseUrl: null,
  ilinkBotId: null,
  ilinkUserId: null,
  cursor: '',             // get_updates_buf cursor
  typingTicket: null,
  error: null
};

// ─── Helpers ───

/** Generate random X-WECHAT-UIN for replay protection */
function randomUin() {
  const uint32 = Math.floor(Math.random() * 0xFFFFFFFF);
  return Buffer.from(String(uint32)).toString('base64');
}

/** Build standard iLink request headers */
function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomUin(),
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': CLIENT_VERSION,
    ...(state.botToken ? { 'Authorization': `Bearer ${state.botToken}` } : {})
  };
}

/** Load persisted settings from store */
function loadState() {
  const settings = store.get('wechat');
  if (!settings) return;
  if (settings.botToken) state.botToken = settings.botToken;
  if (settings.cursor) state.cursor = settings.cursor;
  if (settings.ilinkBotId) state.ilinkBotId = settings.ilinkBotId;
  if (settings.ilinkUserId) state.ilinkUserId = settings.ilinkUserId;
  if (settings.baseUrl) state.baseUrl = settings.baseUrl;
  if (state.botToken) {
    state.status = 'logged_in';
  }
}

/** Save current state to store */
function saveState() {
  store.set('wechat', {
    botToken: state.botToken || '',
    cursor: state.cursor || '',
    ilinkBotId: state.ilinkBotId || '',
    ilinkUserId: state.ilinkUserId || '',
    baseUrl: state.baseUrl || '',
    enabled: store.get('wechat.enabled') || false,
    autoStart: store.get('wechat.autoStart') || false
  });
}

/** Notify the chat renderer of status changes */
function broadcastStatus() {
  const chatWindow = getChatWindow();
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.webContents) {
    chatWindow.webContents.send('wechat-status-change', getWeChatStatus());
  }
}

// ─── QR Login Flow ───

async function fetchQrCode() {
  const resp = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
    headers: buildHeaders()
  });
  if (!resp.ok) {
    throw new Error(`获取二维码失败 (HTTP ${resp.status})`);
  }
  const data = await resp.json();
  // qrcode_img_content is the LiteApp URL that WeChat scans to trigger login.
  // The raw `qrcode` string alone won't work — encode the full URL as the QR.
  const loginUrl = data.qrcode_img_content;
  const qrDataUrl = await QRCode.toDataURL(loginUrl, {
    width: 200,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
  return { qrCode: data.qrcode, qrImageUrl: qrDataUrl };
}

async function pollQrStatus(qrCode) {
  const resp = await fetch(`${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrCode)}`, {
    headers: buildHeaders()
  });
  if (!resp.ok) {
    throw new Error(`轮询二维码状态失败 (HTTP ${resp.status})`);
  }
  return await resp.json();
}

// ─── Message Operations ───

async function fetchTypingTicket() {
  const resp = await fetch(`${state.baseUrl || ILINK_BASE}/ilink/bot/getconfig`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({})
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.typing_ticket;
}

async function sendTypingIndicator(status) {
  if (!state.typingTicket) {
    state.typingTicket = await fetchTypingTicket();
    if (!state.typingTicket) return;
  }
  try {
    await fetch(`${state.baseUrl || ILINK_BASE}/ilink/bot/sendtyping`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ status, typing_ticket: state.typingTicket })
    });
  } catch {
    // typing indicator is best-effort
  }
}

async function sendWeChatReply(toUserId, text, contextToken) {
  const body = {
    msg: {
      to_user_id: toUserId,
      from_user_id: '',           // 必填！空字符串
      client_id: `desktoppet-${Math.random().toString(16).slice(2, 10)}`,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [
        { type: 1, text_item: { text } }
      ]
    },
    base_info: {
      channel_version: '2.4.3'
    }
  };

  const resp = await fetch(`${state.baseUrl || ILINK_BASE}/ilink/bot/sendmessage`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`发送消息失败 (HTTP ${resp.status}): ${errText}`);
  }
  return await resp.json();
}

async function pollMessages() {
  const resp = await fetch(`${state.baseUrl || ILINK_BASE}/ilink/bot/getupdates`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      get_updates_buf: state.cursor || '',
      base_info: { channel_version: '2.4.3' }
    }),
    signal: currentController ? currentController.signal : undefined
  });

  if (!resp.ok) {
    throw new Error(`长轮询失败 (HTTP ${resp.status})`);
  }
  return await resp.json();
}

// ─── Message Processing ───

function extractText(msg) {
  if (!msg.item_list || !Array.isArray(msg.item_list)) return null;
  const textItem = msg.item_list.find(i => i.type === 1);
  return textItem?.text_item?.text || null;
}

async function processMessage(msg) {
  const text = extractText(msg);
  if (!text) return null;

  console.log(`[WeChat] 收到消息: ${text.slice(0, 50)}...`);

  // Show typing indicator
  sendTypingIndicator(1);

  try {
    // Get or create a WeChat-specific conversation
    // For now, use the active conversation (same as chat window)
    const { conv, convs } = getActiveConversation();
    const history = (conv.messages || []).slice(-20); // Last 20 messages for context

    const messages = [
      buildSystemPrompt(null),
      ...history,
      { role: 'user', content: `[来自微信] ${text}` }
    ];

    // Persist user message
    conv.messages.push({ role: 'user', content: `📱 ${text}` });
    conv.updatedAt = new Date().toISOString();
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);
    saveConversations(convs);

    // Call AI
    const reply = await callAIWithTools(messages);

    // Persist AI response
    conv.messages.push({ role: 'assistant', content: reply });
    conv.updatedAt = new Date().toISOString();
    if (conv.messages.length > 100) conv.messages.splice(0, conv.messages.length - 100);

    // Auto-title if new conversation
    if (conv.title === '新对话') {
      const title = await generateConversationTitle(text, reply);
      if (title) conv.title = title;
    }

    saveConversations(convs);

    // Notify chat window to refresh
    const chatWindow = getChatWindow();
    if (chatWindow && !chatWindow.isDestroyed() && chatWindow.webContents) {
      chatWindow.webContents.send('messages-updated');
      // Also send the reply as a stream-chunk so UI shows it live
      chatWindow.webContents.send('stream-chunk', { text: reply, done: true });
    }

    return reply;
  } finally {
    // Hide typing indicator
    sendTypingIndicator(2);
  }
}

// ─── Main Message Loop ───

async function messageLoop() {
  while (running) {
    try {
      // Create abort controller for this poll cycle
      currentController = new AbortController();

      const data = await pollMessages();

      // Update cursor
      if (data.get_updates_buf) {
        state.cursor = data.get_updates_buf;
        saveState();
      }

      // Reset error counter on success
      consecutiveErrors = 0;
      state.error = null;

      // Process messages
      if (data.msgs && Array.isArray(data.msgs)) {
        for (const msg of data.msgs) {
          if (!running) break;
          // Only process user messages that are complete
          if (msg.message_type === 1 && msg.message_state === 2) {
            if (msg.context_token) {
              const reply = await processMessage(msg);
              if (reply) {
                await sendWeChatReply(msg.from_user_id, reply, msg.context_token);
                lastMessageTime = Date.now();
                console.log('[WeChat] 回复已发送');
              }
            }
          }
        }
      }
    } catch (err) {
      if (!running) break;

      // AbortError from stopping is expected
      if (err.name === 'AbortError') continue;

      consecutiveErrors++;
      console.error(`[WeChat] 错误 (${consecutiveErrors}): ${err.message}`);

      if (consecutiveErrors >= 5) {
        state.status = 'error';
        state.error = `连续 ${consecutiveErrors} 次错误: ${err.message}`;
        broadcastStatus();
        // Cooldown before retry
        const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, consecutiveErrors - 5), RECONNECT_MAX_DELAY);
        console.log(`[WeChat] 冷却 ${delay / 1000}s 后重试...`);
        await sleep(delay);
        consecutiveErrors = 0;
        state.error = null;
      } else {
        // Quick retry
        await sleep(RECONNECT_BASE_DELAY * consecutiveErrors);
      }
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Public API ───

function getWeChatStatus() {
  return {
    loggedIn: state.status === 'logged_in' || state.status === 'running',
    running: state.status === 'running',
    connecting: state.status === 'qr_pending' || state.status === 'qr_confirmed',
    qrCode: state.qrCode,
    error: state.error,
    status: state.status
  };
}

async function startLogin() {
  try {
    state.status = 'qr_pending';
    state.error = null;

    const { qrCode, qrImageUrl } = await fetchQrCode();
    state.qrCode = qrImageUrl;
    state.qrId = qrCode;
    broadcastStatus();

    console.log('[WeChat] 二维码已获取，等待扫码...');

    // Poll for scan
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 120; // 6 minutes max

      loginPollTimer = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(loginPollTimer);
          loginPollTimer = null;
          state.status = 'disconnected';
          state.qrCode = null;
          state.qrId = null;
          state.error = '二维码已过期，请重新获取';
          broadcastStatus();
          reject(new Error('二维码过期'));
          return;
        }

        try {
          const status = await pollQrStatus(state.qrId);

          if (status.status === 'confirmed') {
            clearInterval(loginPollTimer);
            loginPollTimer = null;

            state.botToken = status.bot_token;
            state.baseUrl = status.baseurl || ILINK_BASE;
            state.ilinkBotId = status.ilink_bot_id;
            state.ilinkUserId = status.ilink_user_id;
            state.status = 'logged_in';
            state.qrCode = null;
            state.qrId = null;
            saveState();
            broadcastStatus();

            console.log('[WeChat] 登录成功!');
            resolve(state.qrCode); // null means logged in
          } else if (status.status === 'scaned') {
            state.status = 'qr_confirmed';
            broadcastStatus();
            console.log('[WeChat] 已扫码，等待确认...');
          } else if (status.status === 'expired') {
            clearInterval(loginPollTimer);
            loginPollTimer = null;
            state.status = 'disconnected';
            state.qrCode = null;
            state.qrId = null;
            state.error = '二维码已过期';
            broadcastStatus();
            reject(new Error('二维码过期'));
          }
          // else: still 'wait' — keep polling
        } catch (err) {
          console.error('[WeChat] 轮询错误:', err.message);
          // Continue polling on transient errors
        }
      }, QR_POLL_INTERVAL);
    });
  } catch (err) {
    state.status = 'disconnected';
    state.qrCode = null;
    state.error = err.message;
    broadcastStatus();
    throw err;
  }
}

function initWeChat() {
  if (state.status === 'running') return;
  if (state.status !== 'logged_in') {
    loadState();
    if (state.status !== 'logged_in') {
      console.log('[WeChat] 未登录，跳过初始化');
      return;
    }
  }

  running = true;
  state.status = 'running';
  state.error = null;
  consecutiveErrors = 0;
  broadcastStatus();

  console.log('[WeChat] 消息循环启动');
  messageLoop().catch(err => {
    console.error('[WeChat] 消息循环崩溃:', err);
    running = false;
    state.status = 'error';
    state.error = err.message;
    broadcastStatus();
  });
}

function stopWeChat() {
  running = false;

  // Clear timers
  if (loginPollTimer) {
    clearInterval(loginPollTimer);
    loginPollTimer = null;
  }

  // Abort current request
  if (currentController) {
    currentController.abort();
    currentController = null;
  }

  state.status = 'disconnected';
  state.qrCode = null;
  state.qrId = null;
  broadcastStatus();

  console.log('[WeChat] 已停止');
}

// ─── Initialize on load ───
loadState();

module.exports = {
  initWeChat,
  stopWeChat,
  getWeChatStatus,
  startLogin
};
