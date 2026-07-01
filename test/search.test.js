const { isWeatherQuery, formatSearchContext, dedupeResults } = require('../src/search');

describe('isWeatherQuery', () => {
  test('matches Chinese weather keywords', () => {
    expect(isWeatherQuery('今天天气怎么样')).toBe(true);
    expect(isWeatherQuery('明天会不会下雨')).toBe(true);
    expect(isWeatherQuery('北京气温多少度')).toBe(true);
    expect(isWeatherQuery('刮台风了')).toBe(true);
    expect(isWeatherQuery('今天热不热')).toBe(true);
    expect(isWeatherQuery('湿度大不大')).toBe(true);
  });

  test('matches English weather keywords', () => {
    expect(isWeatherQuery("what's the weather today")).toBe(true);
    expect(isWeatherQuery('is it going to rain tomorrow')).toBe(true);
    expect(isWeatherQuery('temperature in Tokyo')).toBe(true);
    expect(isWeatherQuery('snow forecast')).toBe(true);
  });

  test('does not match non-weather queries', () => {
    expect(isWeatherQuery('帮我写一段代码')).toBe(false);
    expect(isWeatherQuery('你好吗')).toBe(false);
    expect(isWeatherQuery('今天吃什么')).toBe(false);
    expect(isWeatherQuery('tell me a joke')).toBe(false);
  });
});

describe('formatSearchContext', () => {
  test('returns null for null input', () => {
    expect(formatSearchContext('test', null)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(formatSearchContext('test', [])).toBeNull();
  });

  test('formats results with correct structure', () => {
    const results = [
      { title: 'Test Title', snippet: 'A test snippet', url: 'https://example.com' }
    ];
    const output = formatSearchContext('my query', results);
    expect(output).toContain('联网搜索结果');
    expect(output).toContain('my query');
    expect(output).toContain('共找到 1 条相关结果');
    expect(output).toContain('Test Title');
    expect(output).toContain('A test snippet');
    expect(output).toContain('https://example.com');
  });

  test('handles multiple results', () => {
    const results = [
      { title: 'First', snippet: 'Snippet 1', url: 'https://a.com' },
      { title: 'Second', snippet: 'Snippet 2', url: 'https://b.com' }
    ];
    const output = formatSearchContext('q', results);
    expect(output).toContain('共找到 2 条相关结果');
    expect(output).toContain('1. First');
    expect(output).toContain('2. Second');
  });
});

describe('dedupeResults', () => {
  test('filters out results with empty title', () => {
    const results = [
      { title: '', snippet: 'Valid snippet', url: 'https://a.com' },
      { title: 'Valid title', snippet: 'Valid snippet', url: 'https://b.com' }
    ];
    const filtered = dedupeResults(results);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].url).toBe('https://b.com');
  });

  test('filters out results with empty snippet', () => {
    const results = [
      { title: 'Valid title', snippet: '', url: 'https://a.com' },
      { title: 'Another', snippet: 'Has content', url: 'https://b.com' }
    ];
    const filtered = dedupeResults(results);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].url).toBe('https://b.com');
  });

  test('deduplicates by URL', () => {
    const results = [
      { title: 'Title A', snippet: 'Snippet A', url: 'https://example.com' },
      { title: 'Title B', snippet: 'Snippet B', url: 'https://example.com' },
      { title: 'Title C', snippet: 'Snippet C', url: 'https://other.com' }
    ];
    const filtered = dedupeResults(results);
    expect(filtered).toHaveLength(2);
  });

  test('returns empty array for empty input', () => {
    expect(dedupeResults([])).toEqual([]);
  });
});
