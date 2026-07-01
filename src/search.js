const isMac = process.platform === 'darwin';

const UA = isMac
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function searchBing(url) {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function parseBingResults(html) {
  if (!html) return [];

  // Extract title+URL pairs from h2/h3 > a elements
  const titleRegex = /<h[23][^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[23]>/gi;
  // Extract snippets from b_caption / b_snippet / b_paractl
  const captionRegex = /class="b_(?:caption|snippet|paractl|algo)"[^>]*>\s*(?:<p[^>]*>|<div[^>]*>)([\s\S]*?)(?:<\/p>|<\/div>)/gi;

  const titles = [];
  const captions = [];
  let m;

  while ((m = titleRegex.exec(html)) !== null && titles.length < 8) {
    const url = m[1];
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    if (title) titles.push({ url, title });
  }
  while ((m = captionRegex.exec(html)) !== null && captions.length < 8) {
    const snippet = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&ensp;/g, ' ').replace(/&#0?\d+;/g, '')
      .trim();
    if (snippet) captions.push(snippet);
  }

  // Pair titles with captions
  const results = [];
  for (let i = 0; i < Math.min(titles.length, captions.length); i++) {
    results.push({
      title: titles[i].title,
      snippet: captions[i],
      url: titles[i].url
    });
  }

  return results;
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter(r => {
    if (!r.title || !r.snippet) return false;
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

async function performWebSearch(query) {
  const encoded = encodeURIComponent(query);

  // Try cn.bing.com first
  let html = await searchBing(`https://cn.bing.com/search?q=${encoded}`);
  let results = parseBingResults(html);
  results = dedupeResults(results);

  // Fallback to international Bing
  if (results.length === 0) {
    html = await searchBing(`https://www.bing.com/search?q=${encoded}`);
    results = parseBingResults(html);
    results = dedupeResults(results);
  }

  return results.length > 0 ? results.slice(0, 5) : null;
}

function formatSearchContext(query, results) {
  if (!results || results.length === 0) return null;

  let text = '\n\n【联网搜索结果】\n';
  text += `用户查询："${query}"\n`;
  text += `共找到 ${results.length} 条相关结果：\n\n`;

  results.forEach((r, i) => {
    text += `${i + 1}. ${r.title}\n`;
    if (r.snippet) text += `   ${r.snippet}\n`;
    text += `   来源: ${r.url}\n\n`;
  });

  text += '请根据以上搜索结果回答用户的问题。如果搜索结果与问题不相关或不充分，请如实告诉用户，并尽量用你自己的知识补充回答。记住保持你可爱的性格~\n';
  return text;
}

function isWeatherQuery(query) {
  return /天气|气温|温度|下雨|下雪|刮风|台风|雾霾|晴天|阴天|多云|湿度|风力|穿什么|热不热|冷不冷|weather|temperature|rain|snow|wind|forecast/i.test(query);
}

async function fetchWeatherData() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://wttr.in?format=j1', {
      signal: controller.signal,
      headers: { 'User-Agent': 'curl/8.0' }
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    return formatWeatherData(data);
  } catch { return null; }
}

function formatWeatherData(data) {
  const current = data.current_condition?.[0];
  const today = data.weather?.[0];
  if (!current) return null;

  let text = '\n\n【实时天气数据 - wttr.in】\n';
  text += `当前温度: ${current.temp_C}°C (体感 ${current.FeelsLikeC}°C)\n`;
  text += `天气状况: ${current.weatherDesc?.[0]?.value || '未知'}\n`;
  text += `湿度: ${current.humidity}%\n`;
  text += `风速: ${current.windspeedKmph} km/h\n`;
  if (today) {
    text += `今日最高: ${today.maxtempC}°C / 最低: ${today.mintempC}°C\n`;
  }
  text += '\n请根据以上实时天气数据回答用户。记住保持你可爱的性格~\n';
  return text;
}

module.exports = { performWebSearch, formatSearchContext, isWeatherQuery, fetchWeatherData, dedupeResults };
