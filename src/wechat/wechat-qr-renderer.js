/**
 * wechat-qr-renderer.js — 微信扫码登录
 *
 * 封装扫码登录流程：
 * 1. 请求 QR 码
 * 2. 在 webview 中展示二维码
 * 3. 轮询扫码状态直到确认或超时
 */

const fs = require('fs');
const QRCode = require('qrcode');
const { DEFAULT_BASE_URL, BOT_TYPE, ensureDataDir, writeJsonFile, CREDENTIALS_FILE } = require('./wechat-transport');

const GET_QR_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;
const LOGIN_TIMEOUT_MS = 480000;

/**
 * 生成 QR 码的 data URL（用于在 <img> 中显示）
 */
async function generateQRDataUrl(text) {
  try {
    return await QRCode.toDataURL(text, {
      width: 280,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    throw new Error(`二维码生成失败: ${err.message}`);
  }
}

/**
 * 完整扫码登录流程
 *
 * @param {object} options
 * @param {string} options.baseUrl — API 基础 URL
 * @param {function} options.onQR — QR data URL 回调，用于展示二维码
 * @param {function} options.onStatus — 状态变化回调 (status, detail?)
 * @param {function} options.onError — 错误回调 (error)
 * @returns {Promise<{ token, baseUrl, accountId, userId, savedAt }>}
 */
async function wechatQRLogin(options = {}) {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const statusUrl = `${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
  const onQR = options.onQR || (() => {});
  const onStatus = options.onStatus || (() => {});
  const onError = options.onError || (err => console.error('[wechat]', err));

  // 1. 获取二维码
  onStatus('connecting', '正在获取二维码...');

  let qrResp;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GET_QR_TIMEOUT_MS);
    const res = await fetch(statusUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`获取二维码失败: HTTP ${res.status}`);
    qrResp = await res.json();
  } catch (err) {
    onError(`获取二维码失败: ${err.message}`);
    throw err;
  }

  // 2. 生成 QR data URL 并展示
  const qrCode = qrResp.qrcode;
  const qrImgContent = qrResp.qrcode_img_content;

  try {
    const dataUrl = await generateQRDataUrl(qrImgContent || qrCode);
    onQR(dataUrl);
  } catch (err) {
    onError(err.message);
    throw err;
  }

  onStatus('connecting', '请用微信扫描二维码');

  // 3. 轮询扫码状态
  const pollBase = baseUrl.replace(/\/+$/, '');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    try {
      const pollUrl = `${pollBase}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrCode)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35000);
      const res = await fetch(pollUrl, {
        headers: { 'iLink-App-ClientVersion': '1' },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`查询二维码状态失败: HTTP ${res.status}`);
      const status = await res.json();

      switch (status.status) {
        case 'wait':
          // 等待扫码
          break;
        case 'scaned':
          if (!scannedPrinted) {
            onStatus('connecting', '已扫码，请在手机上确认登录...');
            scannedPrinted = true;
          }
          break;
        case 'expired':
          throw new Error('二维码已过期，请重新扫码登录。');
        case 'confirmed': {
          if (!status.ilink_bot_id || !status.bot_token) {
            throw new Error('登录失败：服务器未返回机器人凭据。');
          }

          const account = {
            token: status.bot_token,
            baseUrl: status.baseurl || baseUrl,
            accountId: status.ilink_bot_id,
            userId: status.ilink_user_id || '',
            savedAt: new Date().toISOString(),
          };

          // 保存凭据
          ensureDataDir();
          writeJsonFile(CREDENTIALS_FILE, account);
          try {
            fs.chmodSync(CREDENTIALS_FILE, 0o600);
          } catch {}

          onStatus('connected', `已登录: ${account.accountId}`);
          return account;
        }
      }
    } catch (err) {
      if (err.message.includes('已过期')) throw err;
      // 网络错误忽略，继续轮询
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error('登录超时，请重新扫码。');
}

module.exports = {
  wechatQRLogin,
  generateQRDataUrl,
};
