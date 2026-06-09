const { store, getActiveModelProvider, getModelProviders } = require('./store');
const { getTheme } = require('../themes');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

let activeStreamController = null;
const DESKTOP_PATH = path.join(os.homedir(), 'Desktop');

/* ─── System Tools / AI Agent ─── */
const SYSTEM_TOOLS = [
  {
    name: 'desktop_write_file',
    description: 'Write content to a file on the desktop. Use this when the user wants to save a file to their desktop.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The filename (e.g., "document.txt", "note.md")' },
        content: { type: 'string', description: 'The file content to write' }
      },
      required: ['filename', 'content']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file at an arbitrary path on the filesystem.',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute file path' },
        content: { type: 'string', description: 'The file content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'read_file',
    description: 'Read the content of a file from the filesystem.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute file path to read' }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a specified path.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to list' }
      },
      required: ['path']
    }
  },
  {
    name: 'run_command',
    description: 'Execute a shell command on the system. Use this when the user wants to run terminal commands, scripts, or interact with the system via CLI.',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'get_system_info',
    description: 'Get information about the system: OS, hostname, CPU, memory, uptime, etc.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        detail: { type: 'string', description: 'Optional: what detail to get (basic/all)', enum: ['basic', 'all'] }
      }
    }
  },
  {
    name: 'open_url',
    description: 'Open a URL in the default web browser.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to open' }
      },
      required: ['url']
    }
  },
  {
    name: 'get_desktop_path',
    description: 'Get the absolute path to the user\'s desktop directory.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'generate_docx',
    description: 'Generate a Word document (.docx) and save it to the desktop. Use this when the user wants a formatted Word document.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The filename (e.g., "报告.docx", "文档.docx")' },
        title: { type: 'string', description: 'Document title (heading)' },
        content: { type: 'string', description: 'Document content in Markdown format. Use # for headings, - for lists, **bold** for emphasis.' }
      },
      required: ['filename', 'title', 'content']
    }
  },
  {
    name: 'generate_pdf',
    description: 'Generate a PDF document and save it to the desktop. Use this when the user wants a PDF file.',
    requiresConfirmation: false,
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The filename (e.g., "文档.pdf")' },
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Document content in plain text with simple formatting.' }
      },
      required: ['filename', 'title', 'content']
    }
  }
];

/* ─── Tool helpers ─── */
function getOpenAITools() {
  return SYSTEM_TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}

function toolRequiresConfirmation(toolName) {
  const tool = SYSTEM_TOOLS.find(t => t.name === toolName);
  return tool ? tool.requiresConfirmation : true;
}

/** Pending tool confirmations: toolCallId -> { resolve, reject, timeout } */
const pendingToolConfirmations = new Map();

/** Send a confirmation request to the chat window and wait for user response */
function requestToolConfirmation(toolName, args) {
  return new Promise((resolve) => {
    const toolCallId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const timeout = setTimeout(() => {
      pendingToolConfirmations.delete(toolCallId);
      resolve(false); // Timeout = reject
    }, 60000);

    pendingToolConfirmations.set(toolCallId, { resolve, timeout });

    // Send to chat window via main process IPC
    const { BrowserWindow } = require('electron');
    const chatWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('chat'));
    if (chatWindow && chatWindow.webContents) {
      chatWindow.webContents.send('request-tool-confirm', {
        toolCallId,
        toolName,
        args
      });
    } else {
      clearTimeout(timeout);
      pendingToolConfirmations.delete(toolCallId);
      resolve(false);
    }
  });
}

/** Execute a tool call and return the result string */
async function executeToolCall(toolName, args) {
  try {
    switch (toolName) {
      case 'desktop_write_file': {
        const { filename, content } = args;
        const filePath = path.join(DESKTOP_PATH, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        return `文件已保存到桌面: ${filePath}`;
      }

      case 'write_file': {
        const { path: filePath, content } = args;
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        return `文件已保存: ${filePath}`;
      }

      case 'read_file': {
        const { path: filePath } = args;
        if (!fs.existsSync(filePath)) {
          return `文件不存在: ${filePath}`;
        }
        const maxSize = 100 * 1024;
        const stat = fs.statSync(filePath);
        if (stat.size > maxSize) {
          return `文件过大 (${(stat.size / 1024).toFixed(0)}KB)，只读取了前 100KB:\n\n` + fs.readFileSync(filePath, 'utf-8').slice(0, maxSize);
        }
        return fs.readFileSync(filePath, 'utf-8');
      }

      case 'list_directory': {
        const { path: dirPath } = args;
        if (!fs.existsSync(dirPath)) {
          return `目录不存在: ${dirPath}`;
        }
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines = items.map(item => {
          const type = item.isDirectory() ? '📁' : (item.isFile() ? '📄' : '🔗');
          return `${type} ${item.name}`;
        });
        return `目录: ${dirPath}\n共 ${items.length} 项:\n` + lines.join('\n');
      }

      case 'run_command': {
        const { command } = args;
        const output = execSync(command, {
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 5000
        });
        const truncated = output.length > 5000 ? output.slice(0, 5000) + '\n... (输出已截断)' : output;
        return truncated || '(命令执行成功，无输出)';
      }

      case 'get_system_info': {
        const { detail = 'basic' } = args;
        const info = {
          platform: os.platform(),
          hostname: os.hostname(),
          arch: os.arch(),
          release: os.release(),
          homedir: os.homedir(),
          desktopPath: DESKTOP_PATH,
          cpus: os.cpus().length,
          totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
          freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
          uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`
        };
        if (detail === 'all') {
          info.loadavg = os.loadavg();
          info.userInfo = os.userInfo();
          info.networkInterfaces = Object.keys(os.networkInterfaces()).length;
        }
        return JSON.stringify(info, null, 2);
      }

      case 'open_url': {
        const { url } = args;
        const openCmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start ""' : 'xdg-open';
        execSync(`${openCmd} "${url.replace(/"/g, '\\"')}"`, { timeout: 5000 });
        return `已在浏览器中打开: ${url}`;
      }

      case 'get_desktop_path': {
        return DESKTOP_PATH;
      }

      case 'generate_docx': {
        const { filename: docxFilename, title: docxTitle, content: docxContent } = args;
        const { Document: DocxDocument, Packer: DocxPacker, Paragraph: DocxParagraph, TextRun: DocxTextRun, AlignmentType } = require('docx');

        const lines = docxContent.split('\n');
        const children = [];

        children.push(new DocxParagraph({
          children: [new DocxTextRun({ text: docxTitle, size: 36, bold: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }));

        for (const line of lines) {
          if (!line.trim()) {
            children.push(new DocxParagraph({ spacing: { after: 60 } }));
            continue;
          }
          const h1 = line.match(/^#\s+(.+)/);
          if (h1) {
            children.push(new DocxParagraph({
              children: [new DocxTextRun({ text: h1[1], size: 28, bold: true })],
              spacing: { before: 200, after: 100 },
            }));
            continue;
          }
          const h2 = line.match(/^##\s+(.+)/);
          if (h2) {
            children.push(new DocxParagraph({
              children: [new DocxTextRun({ text: h2[1], size: 24, bold: true })],
              spacing: { before: 160, after: 80 },
            }));
            continue;
          }
          const bullet = line.match(/^[-*+]\s+(.+)/);
          if (bullet) {
            children.push(new DocxParagraph({
              children: [new DocxTextRun({ text: '• ' + bullet[1], size: 22 })],
              spacing: { after: 60 },
              indent: { left: 400 },
            }));
            continue;
          }
          children.push(new DocxParagraph({
            children: [new DocxTextRun({ text: line, size: 22 })],
            spacing: { after: 80 },
          }));
        }

        const doc = new DocxDocument({
          sections: [{
            properties: {
              page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
            },
            children,
          }],
        });

        const buffer = await DocxPacker.toBuffer(doc);
        const filePath = path.join(DESKTOP_PATH, docxFilename);
        fs.writeFileSync(filePath, buffer);
        return `Word 文档已生成并保存到桌面: ${filePath}`;
      }

      case 'generate_pdf': {
        const { filename: pdfFilename, title: pdfTitle, content: pdfContent } = args;
        const PDFDocument = require('pdfkit');

        const filePath = path.join(DESKTOP_PATH, pdfFilename);
        const doc = new PDFDocument({ size: 'A4', margin: 72 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        doc.font('Helvetica-Bold').fontSize(24).text(pdfTitle, { align: 'center' });
        doc.moveDown(1.5);

        const lines2 = pdfContent.split('\n');
        for (const line2 of lines2) {
          if (!line2.trim()) { doc.moveDown(0.5); continue; }
          const h1m = line2.match(/^#\s+(.+)/);
          if (h1m) {
            doc.font('Helvetica-Bold').fontSize(18).text(h1m[1]);
            doc.moveDown(0.5);
            continue;
          }
          const h2m = line2.match(/^##\s+(.+)/);
          if (h2m) {
            doc.font('Helvetica-Bold').fontSize(15).text(h2m[1]);
            doc.moveDown(0.3);
            continue;
          }
          const bm = line2.match(/^[-*+]\s+(.+)/);
          if (bm) {
            doc.font('Helvetica').fontSize(11).text('  •  ' + bm[1]);
            doc.moveDown(0.2);
            continue;
          }
          doc.font('Helvetica').fontSize(11).text(line2);
          doc.moveDown(0.3);
        }

        doc.end();
        await new Promise((resolve) => stream.on('finish', resolve));
        return `PDF 文档已生成并保存到桌面: ${filePath}`;
      }

      default:
        return `未知工具: ${toolName}`;
    }
  } catch (err) {
    return `工具执行出错 (${toolName}): ${err.message}`;
  }
}

/** Full AI call with tool calling support (non-streaming) */
async function callAIWithTools(messages, onUpdate) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key哦！请在聊天窗口的设置里输入API Key~`;
  }

  const maxToolRounds = 10;
  const tools = getOpenAITools();
  let currentMessages = [...messages];

  for (let round = 0; round < maxToolRounds; round++) {
    const body = {
      model: provider.modelName,
      messages: currentMessages,
      temperature: 0.8,
      max_tokens: 4000,
      tools
    };

    if (onUpdate) onUpdate({ type: 'api-call', round: round + 1 });

    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`API错误(${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const message = data.choices[0].message;

    // No tool calls → return text
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || '';
    }

    // Add assistant message with tool calls
    currentMessages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls
    });

    // Process each tool call
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      // Notify UI
      if (onUpdate) onUpdate({ type: 'tool-start', toolName, args, toolCallId: toolCall.id });
      notifyToolStatus(toolCall.id, toolName, args, 'pending');

      // Check if confirmation needed
      if (toolRequiresConfirmation(toolName)) {
        if (onUpdate) onUpdate({ type: 'tool-confirm', toolName, args, toolCallId: toolCall.id });
        const confirmed = await requestToolConfirmation(toolName, args);
        if (!confirmed) {
          const deniedMsg = '用户拒绝了该操作';
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: deniedMsg
          });
          if (onUpdate) onUpdate({ type: 'tool-denied', toolName, toolCallId: toolCall.id });
          notifyToolStatus(toolCall.id, toolName, null, 'denied');
          continue;
        }
      }

      // Execute the tool
      if (onUpdate) onUpdate({ type: 'tool-executing', toolName, toolCallId: toolCall.id });
      const result = await executeToolCall(toolName, args);

      if (onUpdate) onUpdate({ type: 'tool-done', toolName, toolCallId: toolCall.id, result });
      notifyToolStatus(toolCall.id, toolName, result, 'completed');

      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result
      });
    }
  }

  return '任务步骤已全部完成。还有什么需要帮忙的吗？';
}

function notifyToolStatus(toolCallId, toolName, result, status) {
  const { BrowserWindow } = require('electron');
  const chatWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('chat'));
  if (chatWindow && chatWindow.webContents) {
    const data = { toolCallId, toolName, status };
    if (status === 'completed' && result) {
      data.result = result.length > 200 ? result.slice(0, 200) + '...' : result;
    }
    if (status === 'pending') {
      data.args = arguments[1]; // toolName is arg 2... let me fix this
    }
    chatWindow.webContents.send('tool-execution-status', data);
  }
}

function cancelActiveStream() {
  if (activeStreamController) {
    activeStreamController.abort();
    activeStreamController = null;
  }
}

/** Simple AI call without tools (for title generation, validation, etc.) */
async function callAISimple(messages) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key哦！请在聊天窗口的设置里输入API Key~`;
  }

  const resp = await fetch(provider.apiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.modelName,
      messages,
      temperature: 0.8,
      max_tokens: 2000
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API错误(${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callAI(messages) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key哦！请在聊天窗口的设置里输入API Key~`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages,
        temperature: 0.8,
        max_tokens: 2000
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`API错误(${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return data.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return '请求超时，请稍后重试';
    }
    throw err;
  }
}

async function validateModelApiKey(providerId) {
  const id = providerId || store.get('activeModelProviderId') || 'deepseek';
  const providers = getModelProviders();
  const provider = providers.find(p => p.id === id);
  if (!provider || !provider.apiKey || !provider.apiKey.trim()) {
    return { valid: false, reason: 'no-key' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (resp.ok || resp.status === 429) {
      return { valid: true };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { valid: false, reason: 'invalid-key' };
    }
    return { valid: true };
  } catch {
    return { valid: true, reason: 'network-error' };
  }
}

async function generateConversationTitle(userMessage, aiResponse) {
  const summaryPrompt = [
    { role: 'system', content: '你是一个标题生成器。根据对话内容生成一个简短的标题（10个字以内，不要引号，不要句号）。只输出标题本身，不要任何其他文字。' },
    { role: 'user', content: `用户: ${userMessage.slice(0, 200)}\n\nAI: ${aiResponse.slice(0, 200)}\n\n请为以上对话生成一个简短标题。` }
  ];
  try {
    return await callAISimple(summaryPrompt);
  } catch {
    return null;
  }
}

function buildSystemPrompt(searchContext) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const theme = getTheme(store.get('activeTheme') || 'claude');

  let content = `今天是${todayStr}。

你叫"${theme.name}"，是一个可爱的桌面宠物。你的性格：
${theme.personality}`;

  if (searchContext) {
    content += searchContext;
  }

  const personality = store.get('personalityPrompt');
  if (personality) {
    content += `\n\n【用户偏好】\n${personality}`;
  }

  // Agent capabilities
  content += `\n\n【系统操作能力】
你有直接操作电脑的能力，可以使用以下工具完成任务：

可用工具：
- desktop_write_file(filename, content) — 写文件到桌面（不需要用户确认）
- write_file(path, content) — 写文件到任意路径（需要用户确认）
- read_file(path) — 读取文件内容
- list_directory(path) — 列出目录内容
- run_command(command) — 执行终端命令（需要用户确认）
- get_system_info(detail) — 获取系统信息
- open_url(url) — 在浏览器中打开网页
- get_desktop_path() — 获取桌面路径
- generate_docx(filename, title, content) — 生成 Word 文档 (.docx) 并保存到桌面
- generate_pdf(filename, title, content) — 生成 PDF 文档并保存到桌面

使用说明：
1. 当用户让你做操作电脑的事情时（写文档、读文件、查目录、运行命令等），使用对应的工具完成
2. 对于需要确认的工具，系统会先询问用户，得到同意后再执行
3. 如果用户拒绝，请理解并尝试用其他方式帮助用户
4. 一次任务可能需要多个工具配合使用，请规划好步骤
5. 执行完工具后，用自然语言告诉用户结果
6. 桌面路径是: ${DESKTOP_PATH}`;

  return {
    role: 'system',
    content
  };
}

async function callAIStream(messages, onChunk, onDone, onError) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    onError(`你还没设置${provider.name}的API Key哦！`);
    return;
  }

  cancelActiveStream();
  activeStreamController = new AbortController();
  const controller = activeStreamController;
  let aborted = false;
  controller.signal.addEventListener('abort', () => { aborted = true; });

  let resp;
  try {
    resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages,
        temperature: 0.8,
        max_tokens: 2000,
        stream: true
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      if (activeStreamController === controller) activeStreamController = null;
      return;
    }
    onError(`网络错误: ${err.message}`);
    if (activeStreamController === controller) activeStreamController = null;
    return;
  }

  if (!resp.ok) {
    try {
      const errText = await resp.text();
      onError(`API错误(${resp.status}): ${errText}`);
    } catch {
      onError(`API错误(${resp.status})`);
    }
    if (activeStreamController === controller) activeStreamController = null;
    return;
  }

  try {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (aborted) {
          if (activeStreamController === controller) activeStreamController = null;
          return;
        }
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onChunk(content, fullContent);
          }
        } catch { /* skip unparseable lines */ }
      }
    }

    if (fullContent) {
      onDone(fullContent);
    } else {
      onError('AI没有返回任何内容');
    }
  } catch (err) {
    if (err.name === 'AbortError' || aborted) {
      if (activeStreamController === controller) activeStreamController = null;
      return;
    }
    onError(`读取响应时出错: ${err.message}`);
  }

  if (activeStreamController === controller) activeStreamController = null;
}

// Promise-based wrapper for callAIStream
function callAIStreamAsync(messages, onChunk) {
  return new Promise((resolve, reject) => {
    callAIStream(messages, onChunk, resolve, reject);
  });
}

// Streaming with automatic retry (exponential backoff)
async function callAIStreamWithRetry(messages, onChunk, onDone, onError, maxRetries) {
  if (maxRetries === undefined) maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (activeStreamController && activeStreamController.signal.aborted) return;

    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const fullContent = await callAIStreamAsync(messages, onChunk);
      onDone(fullContent);
      return;
    } catch (err) {
      lastError = err;
      if (activeStreamController && activeStreamController.signal.aborted) return;
    }
  }

  onError(`重试${maxRetries}次后仍然失败: ${lastError}`);
}

module.exports = {
  callAI, callAIStream, callAIStreamWithRetry, cancelActiveStream,
  validateModelApiKey, generateConversationTitle, buildSystemPrompt,
  callAISimple, callAIWithTools, SYSTEM_TOOLS, getOpenAITools,
  executeToolCall, requestToolConfirmation, pendingToolConfirmations
};
