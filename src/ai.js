const { store, getActiveModelProvider, getModelProviders } = require('./store');
const { getTheme } = require('../themes');

async function callAI(messages) {
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
    return await callAI(summaryPrompt);
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
      })
    });
  } catch (err) {
    onError(`网络错误: ${err.message}`);
    return;
  }

  if (!resp.ok) {
    try {
      const errText = await resp.text();
      onError(`API错误(${resp.status}): ${errText}`);
    } catch {
      onError(`API错误(${resp.status})`);
    }
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
    onError(`读取响应时出错: ${err.message}`);
  }
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
    }
  }

  onError(`重试${maxRetries}次后仍然失败: ${lastError}`);
}

module.exports = { callAI, callAIStream, callAIStreamWithRetry, validateModelApiKey, generateConversationTitle, buildSystemPrompt };
