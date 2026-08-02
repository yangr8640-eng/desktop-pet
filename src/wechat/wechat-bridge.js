/**
 * wechat-bridge.js — 微信桥接调度器
 *
 * 将微信消息桥接到桌宠 AI 系统：
 * - 接收微信消息 → 调用 callAIWithTools → 回复微信
 * - 维持自己的消息历史（不干扰 chat 窗口对话）
 */

const { WeChatTransport } = require('./wechat-transport');
const { wechatQRLogin } = require('./wechat-qr-renderer');
const { callAIWithTools, buildSystemPrompt } = require('../ai');
const { store } = require('../store');
const { getChatWindow } = require('../windows');

const POLL_INTERVAL_MS = 1000; // 轮询间隔(长轮询 35s 后立即重连)

/**
 * WeChatBridge — 桥接调度器
 *
 * 消息流：
 *   微信 → transport.pollMessages() → _handleMessage → callAIWithTools → transport.sendText → 微信
 */
class WeChatBridge {
  constructor() {
    this.transport = new WeChatTransport();
    this._running = false;
    this._polling = false;
    this._messageHistory = [];   // 微信对话的独立历史
    this._onStatusChange = null; // 状态变化回调: (status, detail) => {}
    this._onQRCode = null;       // QR 码回调: (dataUrl) => {}
  }

  /** 设置状态变化回调 */
  onStatusChange(cb) { this._onStatusChange = cb; }

  /** 设置 QR 码回调 */
  onQRCode(cb) { this._onQRCode = cb; }

  /** 是否已登录 */
  isLoggedIn() {
    return !!this.transport.getCredentials();
  }

  /** 获取状态 */
  getStatus() {
    const account = this.transport.getCredentials();
    return {
      loggedIn: !!account,
      accountId: account?.accountId || null,
      userId: account?.userId || null,
      bridgeRunning: this._running && this._polling,
    };
  }

  /** 获取状态文本（简单版本） */
  getConnectedText() {
    const account = this.transport.getCredentials();
    if (!account) return '未连接';
    return `已连接 (${account.accountId?.slice(0, 12) || ''}...)`;
  }

  /** 启动桥接（开始轮询） */
  start() {
    if (this._running) return;
    this._running = true;

    if (this.isLoggedIn()) {
      this._beginPolling();
    }
  }

  /** 停止桥接 */
  stop() {
    this._running = false;
    this._polling = false;
    this._emitStatus('disconnected');
  }

  /** 触发扫码登录 */
  async login(onQR) {
    this._emitStatus('connecting', '正在获取二维码...');

    try {
      const account = await wechatQRLogin({
        onQR: onQR || this._onQRCode,
        onStatus: (status, detail) => {
          if (status === 'connected') {
            this._emitStatus('connected', detail);
          } else {
            this._emitStatus('connecting', detail);
          }
        },
        onError: (err) => {
          this._emitStatus('error', err);
        },
      });

      this._emitStatus('connected', `已登录: ${account.accountId}`);
      if (this._running) {
        this._beginPolling();
      }
      return account;
    } catch (err) {
      this._emitStatus('error', err.message);
      throw err;
    }
  }

  /** 退出登录 */
  logout() {
    this._polling = false;
    this._messageHistory = [];
    this.transport.resetSyncState({ clearContextCache: true });

    const { CREDENTIALS_FILE } = require('./wechat-transport');
    try {
      if (require('fs').existsSync(CREDENTIALS_FILE)) {
        require('fs').rmSync(CREDENTIALS_FILE, { force: true });
      }
    } catch {}

    this._emitStatus('disconnected', '已退出登录');
  }

  // ─── 轮询 ───

  _beginPolling() {
    if (this._polling) return;
    this._polling = true;
    this._emitStatus('connected', '开始轮询消息...');
    this._pollLoop();
  }

  async _pollLoop() {
    while (this._running && this._polling) {
      try {
        const result = await this.transport.pollMessages();

        for (const msg of result.messages) {
          await this._handleMessage(msg);
        }
      } catch (err) {
        const msg = err.message || String(err);
        if (/登录已过期/i.test(msg) || /session timeout/i.test(msg) || /credentials/i.test(msg)) {
          this._polling = false;
          this._emitStatus('disconnected', msg);
          return;
        }
        // 其他错误（网络等）继续轮询
      }
    }
  }

  async _handleMessage(msg) {
    const text = msg.text || '';
    if (!text.trim()) return;

    // 保存到消息历史
    this._messageHistory.push({ role: 'user', content: text });

    // 通知聊天窗口（红色消息气泡）
    const chatWindow = getChatWindow();
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('wechat-incoming-message', {
        sender: msg.sender,
        text: text.slice(0, 60) + (text.length > 60 ? '...' : ''),
      });
    }

    try {
      // 使用桌宠的 AI 处理
      const systemPrompt = buildSystemPrompt();
      const messages = [
        systemPrompt,
        ...this._messageHistory.slice(-20), // 保留最近 20 条
      ];

      const reply = await callAIWithTools(messages);

      // 保存回复
      this._messageHistory.push({ role: 'assistant', content: reply });

      // 发回微信
      await this.transport.sendText(msg.senderId, reply);
    } catch (err) {
      const errorText = `处理消息时出错: ${err.message}`;
      try {
        await this.transport.sendText(msg.senderId, errorText);
      } catch {}
    }
  }

  _emitStatus(status, detail) {
    if (this._onStatusChange) {
      this._onStatusChange(status, detail);
    }
  }
}

module.exports = { WeChatBridge };
