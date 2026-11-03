// W&W Wiki 本地服务器。仅监听 127.0.0.1:4318，Node 内置模块，无框架、无外部依赖。
// 写操作（POST/PATCH）要求 Host 为本机回环地址，且 Origin（如存在）与 Host 一致。

import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, ValidationError } from './lib/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media');
const DATA_FILE = path.join(HERE, 'data', 'records.json');
const SEED_FILE = path.join(HERE, 'seed', 'records.json');

const BIND_HOST = '127.0.0.1';
const BIND_PORT = 4318;

const BODY_LIMIT_JSON = 256 * 1024;        // 记录类请求
const BODY_LIMIT_MEDIA = 12 * 1024 * 1024; // base64 媒体请求（解码后上限 8MB）
const MEDIA_DECODE_LIMIT = 8 * 1024 * 1024;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.tres': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const IMAGE_SNIFFS = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 4 && b.toString('ascii', 0, 4) === 'GIF8' },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function isLoopbackHost(host) {
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host || '');
}

// 写操作防护：Host 必须是回环地址；带 Origin 的请求必须同源，阻断跨站表单/脚本提交。
function guardLocalWrite(req, res) {
  const host = req.headers.host;
  if (!isLoopbackHost(host)) {
    sendError(res, 403, '写操作仅允许本机回环地址访问');
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    let originUrl = null;
    try {
      originUrl = new URL(origin);
    } catch {
      sendError(res, 403, '无法解析的 Origin 头');
      return false;
    }
    if (originUrl.host !== host || originUrl.protocol !== 'http:') {
      sendError(res, 403, 'Origin 与 Host 不一致，拒绝跨源写入');
      return false;
    }
  }
  return true;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体超过大小上限'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ValidationError('请求体不是合法 JSON');
  }
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    sendError(res, 400, '路径编码无效');
    return;
  }
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // 路径穿越防护：解析结果必须仍位于 public 目录内。
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendError(res, 403, '路径越界');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type) {
    sendError(res, 404, '不支持的文件类型');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
    // Embedded GLB textures use object URLs: ImageBitmapLoader fetches them,
    // while TextureLoader's browser fallback displays them as images.
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' blob:",
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(data);
    }
  } catch {
    sendError(res, 404, '文件不存在');
  }
}

async function handleApi(req, res, pathname, url, store, mediaDir) {
  if (pathname === '/api/questions' && req.method === 'GET') {
    const questions = store.listQuestions({ status: url.searchParams.get('status'), record_id: url.searchParams.get('record_id') });
    sendJson(res, 200, { questions, count: questions.length });
    return;
  }
  if (pathname === '/api/questions' && req.method === 'POST') {
    if (!guardLocalWrite(req, res)) return;
    const question = store.createQuestion(await readJson(req, BODY_LIMIT_JSON));
    sendJson(res, 201, { question });
    return;
  }
  const questionMatch = pathname.match(/^\/api\/questions\/([A-Za-z0-9-]+)$/);
  if (questionMatch && ['GET', 'PATCH'].includes(req.method)) {
    if (req.method === 'PATCH' && !guardLocalWrite(req, res)) return;
    const question = req.method === 'GET' ? store.getQuestion(questionMatch[1])
      : store.patchQuestion(questionMatch[1], await readJson(req, BODY_LIMIT_JSON));
    if (!question) sendError(res, 404, '题目不存在');
    else sendJson(res, 200, { question });
    return;
  }
  if (pathname === '/api/game-export' && req.method === 'GET') {
    sendJson(res, 200, store.gameExport(), { 'Content-Disposition': 'attachment; filename="ww-wiki-game-content.json"' });
    return;
  }
  if (pathname === '/api/records' && req.method === 'GET') {
    const q = url.searchParams.get('q');
    const category = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    const records = store.list({ q, category, status });
    sendJson(res, 200, { count: records.length, total: store.count(), records });
    return;
  }

  if (pathname === '/api/records' && req.method === 'POST') {
    if (!guardLocalWrite(req, res)) return;
    const input = await readJson(req, BODY_LIMIT_JSON);
    const record = store.create(input);
    sendJson(res, 201, { record });
    return;
  }

  const recordMatch = pathname.match(/^\/api\/records\/([A-Za-z0-9-]+)$/);
  if (recordMatch && req.method === 'GET') {
    const found = store.get(recordMatch[1]);
    if (!found) {
      sendError(res, 404, '记录不存在');
      return;
    }
    sendJson(res, 200, found);
    return;
  }
  if (recordMatch && req.method === 'PATCH') {
    if (!guardLocalWrite(req, res)) return;
    const input = await readJson(req, BODY_LIMIT_JSON);
    const record = store.patch(recordMatch[1], input);
    if (!record) {
      sendError(res, 404, '记录不存在');
      return;
    }
    sendJson(res, 200, { record });
    return;
  }

  if (pathname === '/api/media' && req.method === 'POST') {
    if (!guardLocalWrite(req, res)) return;
    const input = await readJson(req, BODY_LIMIT_MEDIA);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('请求体必须是对象');
    if (typeof input.data_base64 !== 'string' || input.data_base64.length === 0) {
      throw new ValidationError('缺少 data_base64');
    }
    const buffer = Buffer.from(input.data_base64, 'base64');
    if (buffer.length === 0 || buffer.length > MEDIA_DECODE_LIMIT) {
      throw new ValidationError(`媒体解码后大小必须在 1 字节到 ${MEDIA_DECODE_LIMIT} 字节之间`);
    }
    const sniff = IMAGE_SNIFFS.find((s) => s.test(buffer));
    if (!sniff) {
      throw new ValidationError('仅允许 PNG / JPEG / GIF / WebP 图片，且内容须与格式匹配');
    }
    await mkdir(mediaDir, { recursive: true });
    const filename = `m${Date.now().toString(36)}${randomBytes(4).toString('hex')}.${sniff.ext}`;
    const tmpPath = path.join(mediaDir, `${filename}.tmp`);
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, path.join(mediaDir, filename));
    sendJson(res, 201, { path: `/media/${filename}`, bytes: buffer.length, mime: sniff.mime });
    return;
  }

  if (pathname === '/api/export' && req.method === 'GET') {
    const dump = store.exportDump();
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    sendJson(res, 200, dump, {
      'Content-Disposition': `attachment; filename="ww-wiki-backup-${stamp}.json"`,
    });
    return;
  }

  sendError(res, 404, '未知的 API 路径');
}

export function buildServer(store, { mediaDir = MEDIA_DIR } = {}) {
  return http.createServer(async (req, res) => {
    try {
      // Apply the loopback Host check to reads too, so DNS rebinding cannot read
      // the local archive under an attacker-controlled same-origin hostname.
      if (!isLoopbackHost(req.headers.host)) {
        sendError(res, 403, '仅允许本机回环地址访问');
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, url, store, mediaDir);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, pathname);
      } else {
        sendError(res, 405, '方法不允许');
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        sendError(res, 422, err.message);
      } else if (err && err.message === '请求体超过大小上限') {
        sendError(res, 413, err.message);
      } else {
        sendError(res, 500, '服务器内部错误');
        console.error(err);
      }
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // npm run dev -- --host 127.0.0.1 --port 7100；默认仍是 4318。
  const argValue = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const host = argValue('--host') || BIND_HOST;
  const port = Number(argValue('--port') || BIND_PORT);
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('本地预览仅允许回环 host 与 1–65535 端口');
  }
  const store = createStore({ dataFile: DATA_FILE, seedFile: SEED_FILE });
  store.load();
  const server = buildServer(store);
  server.listen(port, host, () => {
    console.log(`W&W Wiki 本地档案已启动：http://${host}:${port}/ （仅本机访问，记录 ${store.count()} 条）`);
  });
}
