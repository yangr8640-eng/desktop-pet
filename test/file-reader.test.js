const path = require('path');

// Mock dependencies
jest.mock('fs', () => ({
  readFileSync: jest.fn()
}));

jest.mock('pdf-parse', () => jest.fn());
jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));

const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { readFileContent } = require('../src/file-reader');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('readFileContent', () => {
  test('reads .txt files via fs.readFileSync', async () => {
    fs.readFileSync.mockReturnValue('Hello world');
    const result = await readFileContent('/path/to/file.txt');
    expect(result).toBe('Hello world');
    expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/file.txt', 'utf-8');
  });

  test('reads .md files', async () => {
    fs.readFileSync.mockReturnValue('# Markdown');
    const result = await readFileContent('/path/to/file.md');
    expect(result).toBe('# Markdown');
  });

  test('reads .json files', async () => {
    fs.readFileSync.mockReturnValue('{"key":"value"}');
    const result = await readFileContent('/path/to/data.json');
    expect(result).toBe('{"key":"value"}');
  });

  test('reads .csv files', async () => {
    fs.readFileSync.mockReturnValue('a,b,c');
    const result = await readFileContent('/path/to/data.csv');
    expect(result).toBe('a,b,c');
  });

  test('reads .pdf files via pdf-parse', async () => {
    fs.readFileSync.mockReturnValue(Buffer.from('fake pdf buffer'));
    pdfParse.mockResolvedValue({ text: 'Extracted PDF text' });

    const result = await readFileContent('/path/to/file.pdf');
    expect(result).toBe('Extracted PDF text');
    expect(pdfParse).toHaveBeenCalled();
  });

  test('handles empty PDF content', async () => {
    fs.readFileSync.mockReturnValue(Buffer.from('fake'));
    pdfParse.mockResolvedValue({ text: '' });

    const result = await readFileContent('/path/to/file.pdf');
    expect(result).toBe('(PDF内容为空)');
  });

  test('reads .docx files via mammoth', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: 'Extracted DOCX text' });

    const result = await readFileContent('/path/to/file.docx');
    expect(result).toBe('Extracted DOCX text');
    expect(mammoth.extractRawText).toHaveBeenCalledWith({ path: '/path/to/file.docx' });
  });

  test('handles empty DOCX content', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: '' });

    const result = await readFileContent('/path/to/file.docx');
    expect(result).toBe('(文档内容为空)');
  });

  test('returns null for unknown extension', async () => {
    const result = await readFileContent('/path/to/file.exe');
    expect(result).toBeNull();
  });

  test('returns null for unsupported extension', async () => {
    const result = await readFileContent('/path/to/file.png');
    expect(result).toBeNull();
  });

  test('returns error string on read failure', async () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await readFileContent('/path/to/file.txt');
    expect(result).toContain('[读取文件失败:');
    expect(result).toContain('Permission denied');
  });
});
