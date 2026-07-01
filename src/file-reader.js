const path = require('path');
const fs = require('fs');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB limit

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

/** Read an image file and return base64 data with mime type */
function readImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_IMAGE_SIZE) {
    return { error: '图片过大', isImage: true, fileName: path.basename(filePath) };
  }
  const imageBuffer = fs.readFileSync(filePath);
  const mimeType = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;
  return {
    fileName: path.basename(filePath),
    content: `[这是一张图片: ${path.basename(filePath)}]`,
    error: null,
    isImage: true,
    base64: imageBuffer.toString('base64'),
    mimeType
  };
}

function isImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

module.exports = { readFileContent, readImageFile, isImageFile, IMAGE_EXTS };
