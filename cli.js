#!/usr/bin/env node
/**
 * CLI client for desktop-pet AI engine.
 *
 * Talks to the local HTTP API server (must be running via npm start or Electron app).
 *
 * Usage:
 *   node cli.js "你好，帮我写个排序算法"    # Single-shot mode
 *   node cli.js                            # Interactive REPL mode
 *   echo "总结这个" | node cli.js           # Pipe mode
 *
 * Config via env vars:
 *   PET_HOST  — API host (default: 127.0.0.1)
 *   PET_PORT  — API port (default: 9876)
 */

const HOST = process.env.PET_HOST || '127.0.0.1';
const PORT = process.env.PET_PORT || '9876';
const BASE = `http://${HOST}:${PORT}`;

// ─── Spinner ───
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIdx = 0;
let spinnerTimer = null;

function startSpinner() {
  spinnerTimer = setInterval(() => {
    process.stderr.write(`\r  ${frames[spinnerIdx]} 思考中...`);
    spinnerIdx = (spinnerIdx + 1) % frames.length;
  }, 80);
}

function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stderr.write('\r                \r');
  }
}

// ─── API call ───
async function chat(message) {
  try {
    const resp = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const data = await resp.json();
    return data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      return { error: `无法连接到 ${BASE}\n请先启动桌面宠物 (npm start)` };
    }
    return { error: err.message };
  }
}

// ─── Single-shot mode ───
async function singleShot(message) {
  startSpinner();
  const result = await chat(message);
  stopSpinner();

  if (result.error) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }

  console.log(`\n🐱 ${result.reply}`);
  process.exit(0);
}

// ─── Interactive REPL mode ───
async function interactiveMode() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🐱 > '
  });

  // Check server is alive
  try {
    const resp = await fetch(`${BASE}/health`);
    if (!resp.ok) throw new Error();
  } catch {
    console.error(`❌ 无法连接到 ${BASE}`);
    console.error('请先启动桌面宠物 (npm start)');
    process.exit(1);
  }

  console.log('');
  console.log('  ╔══════════════════════════════╗');
  console.log('  ║   🐱 Desktop Pet CLI        ║');
  console.log('  ║   输入消息开始聊天           ║');
  console.log('  ║   /exit  退出               ║');
  console.log('  ║   /new   新建对话            ║');
  console.log('  ╚══════════════════════════════╝');
  console.log('');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/exit' || input === '/quit') {
      console.log('再见~ 👋');
      rl.close();
      process.exit(0);
    }

    if (input === '/new') {
      // Start a new conversation by calling the server
      try {
        await fetch(`${BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '/new' })
        });
      } catch {}
      console.log('✅ 新对话已创建\n');
      rl.prompt();
      return;
    }

    startSpinner();
    const result = await chat(input);
    stopSpinner();

    if (result.error) {
      console.log(`❌ ${result.error}\n`);
    } else {
      console.log(`\n🐱 ${result.reply}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('');
    process.exit(0);
  });
}

// ─── Pipe mode ───
async function pipeMode() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', async () => {
    const input = Buffer.concat(chunks).toString().trim();
    if (!input) {
      console.error('❌ 未收到任何输入');
      process.exit(1);
    }
    await singleShot(input);
  });
}

// ─── Entry ───
const args = process.argv.slice(2);

if (args.length > 0) {
  // Single-shot: node cli.js "message"
  singleShot(args.join(' '));
} else if (!process.stdin.isTTY) {
  // Pipe mode: echo "msg" | node cli.js
  pipeMode();
} else {
  // Interactive REPL: node cli.js
  interactiveMode();
}
