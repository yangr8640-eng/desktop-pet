/**
 * wechat-transport.js — WeChat OpenILink HTTP API 封装
 *
 * 从 CLI-WeChat-Bridge (UNLINEARITY/CLI-WeChat-Bridge) 移植
 * 支持：凭据管理、长轮询收消息、发送文本回复
 * 简化版：去掉 CDN 上传/下载、voice/video、表情绑定、daemon 等功能
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── 常量 ───
const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const CHANNEL_VERSION = '0.3.0';
const BOT_TYPE = '3';
const DATA_DIR = path.join(require('os').homedir(), '.cli-bridge');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'account.json');
const SYNC_BUF_FILE = path.join(DATA_DIR, 'sync_buf.txt');
const CONTEXT_CACHE_FILE = path.join(DATA_DIR, 'context_tokens.json');

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35000;
const SEND_TIMEOUT_MS = 15000;
const RECENT_MESSAGE_CACHE_SIZE = 500;
const MSG_TYPE_USER = 1;
const MSG_TYPE_BOT = 2;
const MSG_ITEM_TEXT = 1;
const MSG_ITEM_IMAGE = 2;
const MSG_ITEM_FILE = 4;
const MSG_STATE_FINISH = 2;
const SYNC_SESSION_TIMEOUT_ERRCODE = -14;

// ─── 数据目录 ───
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

// ─── API 请求 ───
function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildHeaders(token, body) {
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (body) {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf-8'));
  }
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function apiFetch({ baseUrl, endpoint, body, token, timeoutMs }) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(endpoint, base).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(token, body),
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return text;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── 错误码判断 ───
function isWechatSyncSessionTimeout(response) {
  return (
    response.errcode === SYNC_SESSION_TIMEOUT_ERRCODE &&
    /session timeout/i.test(response.errmsg || '')
  );
}

/**
 * WeChatTransport — 微信 API 传输层
 *
 * 用法：
 *   const transport = new WeChatTransport();
 *   const messages = await transport.pollMessages();
 *   await transport.sendText(senderId, '回复内容');
 */
class WeChatTransport {
  constructor() {
    this.recentMessageKeys = new Set();
    this.recentMessageOrder = [];
    this.contextTokenCache = new Map(
      Object.entries(readJsonFile(CONTEXT_CACHE_FILE) || {})
    );
    this.syncBuffer = this._readSyncBuffer();
  }

  /** 获取已保存的凭据 */
  getCredentials() {
    return readJsonFile(CREDENTIALS_FILE);
  }

  /** 获取状态文本 */
  getStatusText() {
    const account = this.getCredentials();
    const syncExists = fs.existsSync(SYNC_BUF_FILE);
    const contextExists = fs.existsSync(CONTEXT_CACHE_FILE);
    return [
      `data_dir: ${DATA_DIR}`,
      `credentials_present: ${account ? 'yes' : 'no'}`,
      `sync_state_present: ${syncExists ? 'yes' : 'no'}`,
      `context_cache_present: ${contextExists ? 'yes' : 'no'}`,
      `cached_context_count: ${this.contextTokenCache.size}`,
      `account_id: ${account?.accountId || '(none)'}`,
      `user_id: ${account?.userId || '(none)'}`,
      `saved_at: ${account?.savedAt || '(none)'}`,
    ].join('\n');
  }

  /** 轮询消息 */
  async pollMessages(options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_LONG_POLL_TIMEOUT_MS;
    const account = this._requireAccount();

    let response = await this._getUpdates(account, timeoutMs);
    if (isWechatSyncSessionTimeout(response) && this.syncBuffer) {
      this._clearSyncBuffer();
      response = await this._getUpdates(account, timeoutMs);
    }

    if (isWechatSyncSessionTimeout(response)) {
      throw new Error('微信登录已过期，请重新扫码登录。');
    }

    const isError =
      (response.ret !== undefined && response.ret !== 0) ||
      (response.errcode !== undefined && response.errcode !== 0);
    if (isError) {
      throw new Error(
        `pollMessages failed: ret=${response.ret} errcode=${response.errcode} errmsg=${response.errmsg || ''}`
      );
    }

    if (response.get_updates_buf) {
      this.syncBuffer = response.get_updates_buf;
      this._saveSyncBuffer(this.syncBuffer);
    }

    const messages = [];
    let ignoredBacklogCount = 0;

    for (const raw of response.msgs || []) {
      if (raw.message_type !== MSG_TYPE_USER) continue;

      const extracted = this._extractMessageContent(raw);
      if (!extracted.text && extracted.attachments.length === 0) continue;

      const messageKey = this._buildMessageKey(raw);
      if (!this._rememberMessage(messageKey)) continue;

      const senderId = raw.from_user_id || 'unknown';
      if (raw.context_token) {
        this._cacheContextToken(senderId, raw.context_token);
      }

      const createdAtMs = raw.create_time_ms || 0;
      if (
        typeof options.minCreatedAtMs === 'number' &&
        (!Number.isFinite(createdAtMs) || createdAtMs < options.minCreatedAtMs)
      ) {
        ignoredBacklogCount += 1;
        continue;
      }

      messages.push({
        senderId,
        sender: senderId.split('@')[0] || senderId,
        sessionId: raw.session_id || '',
        text: extracted.text,
        attachments: extracted.attachments,
        contextToken: raw.context_token,
        createdAt: new Date(raw.create_time_ms || Date.now()).toISOString(),
        createdAtMs,
      });
    }

    return { messages, ignoredBacklogCount };
  }

  /** 发送文本回复 */
  async sendText(senderId, text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const resolved = this._resolveRecipient(senderId);
    await this._sendMessageWithContext(resolved.account, resolved.recipientId, trimmed, resolved.contextToken);
  }

  /** 主动发送通知 */
  async sendNotification(message, recipientId) {
    const trimmed = (message || '').trim();
    if (!trimmed) throw new Error('通知文本不能为空。');

    const resolved = this._resolveRecipient(recipientId);
    await this._sendMessageWithContext(resolved.account, resolved.recipientId, trimmed, resolved.contextToken);
    return resolved.recipientId;
  }

  /** 重置同步状态 */
  resetSyncState(options = {}) {
    this._clearSyncBuffer();
    this._clearRecentMessages();
    if (options.clearContextCache) {
      this._clearContextTokenCache();
    }
    return options.clearContextCache
      ? '已重置同步状态并清除缓存的上下文 token。'
      : '已重置同步状态。';
  }

  /** 清除特定收件人的 context token */
  clearCachedContextToken(recipientId) {
    const id = (recipientId || '').trim();
    if (!id || !this.contextTokenCache.has(id)) return false;
    this.contextTokenCache.delete(id);
    writeJsonFile(CONTEXT_CACHE_FILE, Object.fromEntries(this.contextTokenCache));
    return true;
  }

  // ─── 内部方法 ───

  _requireAccount() {
    const account = this.getCredentials();
    if (!account) {
      throw new Error('未找到微信登录凭据，请先扫码登录。');
    }
    return account;
  }

  _resolveRecipient(recipientId) {
    const account = this._requireAccount();

    let resolvedId = (recipientId || '').trim();
    if (!resolvedId) {
      const recipients = [...this.contextTokenCache.keys()];
      resolvedId = recipients[recipients.length - 1];
      if (!resolvedId) {
        throw new Error('没有缓存的收件人上下文 token，请先接收一条微信消息。');
      }
    }

    const contextToken = this.contextTokenCache.get(resolvedId);
    if (!contextToken) {
      throw new Error(
        `没有 ${resolvedId} 的上下文 token，请先让该用户发送一条消息。`
      );
    }

    return { account, recipientId: resolvedId, contextToken };
  }

  async _sendMessageWithContext(account, recipientId, text, contextToken) {
    const raw = await apiFetch({
      baseUrl: account.baseUrl,
      endpoint: 'ilink/bot/sendmessage',
      body: JSON.stringify({
        msg: {
          from_user_id: '',
          to_user_id: recipientId,
          client_id: this._generateClientId(),
          message_type: MSG_TYPE_BOT,
          message_state: MSG_STATE_FINISH,
          item_list: [{ type: MSG_ITEM_TEXT, text_item: { text } }],
          context_token: contextToken,
        },
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      token: account.token,
      timeoutMs: SEND_TIMEOUT_MS,
    });

    this._assertResponseOk('sendmessage', raw);
  }

  async _getUpdates(account, timeoutMs) {
    try {
      const raw = await apiFetch({
        baseUrl: account.baseUrl,
        endpoint: 'ilink/bot/getupdates',
        body: JSON.stringify({
          get_updates_buf: this.syncBuffer,
          base_info: { channel_version: CHANNEL_VERSION },
        }),
        token: account.token,
        timeoutMs,
      });
      return JSON.parse(raw);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ret: 0, msgs: [], get_updates_buf: this.syncBuffer };
      }
      throw err;
    }
  }

  _extractMessageContent(rawMessage) {
    if (!rawMessage.item_list || !rawMessage.item_list.length) {
      return { text: '', attachments: [] };
    }

    const lines = [];
    const attachments = [];

    for (const item of rawMessage.item_list) {
      if (item.type === MSG_ITEM_TEXT) {
        const text = (item.text_item?.text || '').trim();
        if (text) lines.push(text);
      } else if (item.type === MSG_ITEM_IMAGE) {
        const info = `[微信图片: ${item.image_item?.file_name || '图片'}]`;
        lines.push(info);
      } else if (item.type === MSG_ITEM_FILE) {
        const info = `[微信文件: ${item.file_item?.file_name || '文件'}]`;
        lines.push(info);
      }
    }

    return { text: lines.join('\n').trim(), attachments };
  }

  _assertResponseOk(endpoint, raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return;

    let response;
    try {
      response = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (typeof response !== 'object' || response === null) return;

    const ret = response.ret;
    const errcode = response.errcode;
    const failed =
      (ret !== undefined && ret !== 0) ||
      (errcode !== undefined && errcode !== 0);
    if (!failed) return;

    const errmsg =
      response.errmsg || response.message || response.msg || '';
    throw new Error(
      `${endpoint} failed: ret=${ret} errcode=${errcode} errmsg=${errmsg}`
    );
  }

  _buildMessageKey(message) {
    return [message.from_user_id || '', message.client_id || '', String(message.create_time_ms || ''), message.context_token || ''].join('|');
  }

  _rememberMessage(key) {
    if (!key || this.recentMessageKeys.has(key)) return false;
    this.recentMessageKeys.add(key);
    this.recentMessageOrder.push(key);
    while (this.recentMessageOrder.length > RECENT_MESSAGE_CACHE_SIZE) {
      const oldest = this.recentMessageOrder.shift();
      if (oldest) this.recentMessageKeys.delete(oldest);
    }
    return true;
  }

  _clearRecentMessages() {
    this.recentMessageKeys.clear();
    this.recentMessageOrder.length = 0;
  }

  _readSyncBuffer() {
    try {
      if (!fs.existsSync(SYNC_BUF_FILE)) return '';
      return fs.readFileSync(SYNC_BUF_FILE, 'utf-8');
    } catch {
      return '';
    }
  }

  _saveSyncBuffer(buf) {
    ensureDataDir();
    fs.writeFileSync(SYNC_BUF_FILE, buf, 'utf-8');
  }

  _clearSyncBuffer() {
    this.syncBuffer = '';
    if (fs.existsSync(SYNC_BUF_FILE)) {
      fs.rmSync(SYNC_BUF_FILE, { force: true });
    }
  }

  _cacheContextToken(senderId, token) {
    if (this.contextTokenCache.has(senderId)) {
      this.contextTokenCache.delete(senderId);
    }
    this.contextTokenCache.set(senderId, token);
    writeJsonFile(CONTEXT_CACHE_FILE, Object.fromEntries(this.contextTokenCache));
  }

  _clearContextTokenCache() {
    this.contextTokenCache.clear();
    if (fs.existsSync(CONTEXT_CACHE_FILE)) {
      fs.rmSync(CONTEXT_CACHE_FILE, { force: true });
    }
  }

  _generateClientId() {
    return `desktop-pet:${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
}

// ─── 导出 ───
module.exports = {
  WeChatTransport,
  DATA_DIR,
  CREDENTIALS_FILE,
  DEFAULT_BASE_URL,
  BOT_TYPE,
  ensureDataDir,
  readJsonFile,
  writeJsonFile,
};
