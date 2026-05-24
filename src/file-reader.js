const path = require('path');
const fs = require('fs');

async function readFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    switch (ext) {
      case '.txt':
      case '.md':
      case '.json':
      case '.csv':
      case '.log':
      case '.xml':
      case '.yaml':
      case '.yml':
        return fs.readFileSync(filePath, 'utf-8');
      case '.pdf': {
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        return data.text || '(PDF内容为空)';
      }
      case '.docx': {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value || '(文档内容为空)';
      }
      default:
        return null;
    }
  } catch (err) {
    console.error('File read error:', err.message);
    return `[读取文件失败: ${err.message}]`;
  }
}

module.exports = { readFileContent };
