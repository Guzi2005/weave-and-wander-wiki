import {createQuizService,adminAllowed} from './lib/quiz-service.mjs';
import {QuizError} from './public/quiz-topics.js';
import {LibraryError} from './lib/library-schema.mjs';
import {loadLibraryAssets} from './lib/library-assets.mjs';
// W&W Wiki 本地服务器。仅监听 127.0.0.1:4318，Node 内置模块，无框架、无外部依赖。
// 写操作（POST/PATCH）要求 Host 为本机回环地址，且 Origin（如存在）与 Host 一致。

import http from 'node:http';
import os from 'node:os';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
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
  '.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime',
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

// 手机等局域网设备访问：只有显式加 --lan 启动时才放行，且仅限本机网卡上的 IPv4 地址。
// 默认仍只接受回环 Host，避免 DNS rebinding 借本机名读取档案。
let allowLanAccess = false;
// 公网部署（反向代理/沙箱）模式：Host 来自代理域名，无法预知，因此放行任意 Host；
// 为控制影响面，该模式下只放开题库相关写入，档案、媒体、资料库等写接口仍然只允许本机。
let allowAnyHost = false;
let lanHostCache = null;
function lanAddresses() {
  if (lanHostCache) return lanHostCache;
  const set = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) if (item.family === 'IPv4' && !item.internal) set.add(item.address);
  }
  return (lanHostCache = set);
}
function isAllowedHost(host) {
  if (allowAnyHost) return true;
  if (isLoopbackHost(host)) return true;
  if (!allowLanAccess) return false;
  return lanAddresses().has(String(host || '').replace(/:\d+$/, ''));
}

// 公网模式下允许写入的路径前缀（题库作答、生成、结算都在这里）。
// 管理接口（草稿、发布、校验）仍只允许本机，避免线上被随意改题库。
function hostedWriteAllowed(req) {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    return pathname.startsWith('/api/quiz/') && !pathname.startsWith('/api/quiz/admin/');
  } catch {
    return false;
  }
}

// 写操作防护：Host 必须是回环地址（--lan 时可为本机局域网地址）；带 Origin 的请求必须同源，阻断跨站表单/脚本提交。
function guardLocalWrite(req, res) {
  const host = req.headers.host;
  if (!isAllowedHost(host)) {
    sendError(res, 403, '写操作仅允许本机或同一局域网地址访问');
    return false;
  }
  if (allowAnyHost && !hostedWriteAllowed(req)) {
    sendError(res, 403, '线上部署模式下该接口仅支持本机读写');
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
    // 反向代理会把公网域名放在 Host 或 X-Forwarded-Host 里，两者之一匹配即可，协议允许 http/https。
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const hosts = new Set([host, forwardedHost].filter(Boolean));
    if (!hosts.has(originUrl.host) || !/^https?:$/.test(originUrl.protocol)) {
      // 托管网关（如 workbuddy.host）会把 Host / X-Forwarded-Host 改写为沙箱内部域名，
      // 与浏览器携带的公网 Origin 永远不同。线上模式已把可写范围收窄到题库接口，
      // 且数据按沙箱隔离，因此此处改为信任网关、接受任意 http(s) Origin。
      if (allowAnyHost && /^https?:$/.test(originUrl.protocol)) return true;
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
      ...(['.html', '.js', '.mjs', '.css', '.json'].includes(ext) ? {'Cache-Control': 'no-store'} : {}),
      'X-Content-Type-Options': 'nosniff',
    // Embedded GLB textures use object URLs: ImageBitmapLoader fetches them,
    // while TextureLoader's browser fallback displays them as images.
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' blob:; media-src 'self' blob:",
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

async function handleApi(req, res, pathname, url, store, mediaDir, quiz) {
  if(pathname.startsWith('/api/quiz/')){
    if(pathname==='/api/quiz/bootstrap'&&req.method==='GET'){sendJson(res,200,await quiz.bootstrap());return;}
    const admin=pathname.startsWith('/api/quiz/admin/');
    if(admin&&!adminAllowed(req.headers.authorization,quiz.adminToken())){sendError(res,403,'需要服务端管理员令牌，普通用户不能发布固定题库');return;}
    if(admin&&pathname==='/api/quiz/admin/drafts'&&req.method==='GET'){sendJson(res,200,await quiz.adminList());return;}
    if(req.method!=='POST'){sendError(res,405,'方法不允许');return;}
    if(!guardLocalWrite(req,res))return;
    const input=await readJson(req,BODY_LIMIT_JSON);
    if(pathname==='/api/quiz/generate'){sendJson(res,201,await quiz.generate({selectedTags:input.selectedTags}));return;}
    if(pathname==='/api/quiz/admin/generate'){sendJson(res,201,await quiz.generate({fixedId:input.fixedId,revise:input.revise===true}));return;}
    if(pathname==='/api/quiz/admin/publish'){sendJson(res,201,await quiz.publish(input));return;}
    if(pathname==='/api/quiz/admin/check-model'){await quiz.models();sendJson(res,200,{ok:true});return;}
    sendError(res,404,'未知的出题接口');return;
  }
  if(pathname==='/api/library/bootstrap'&&req.method==='GET'){
    const assets=await loadLibraryAssets(PUBLIC_DIR),state=store.libraryState(),managedPaths=new Set((state.autosaves||[]).flatMap(item=>(item.files||[]).map(file=>file.path)));const records=store.exportDump().records.map(r=>({...r,note:r.notes||'',media:(r.media||[]).filter(m=>!managedPaths.has(m.path))}));sendJson(res,200,{data:{schema:'ww-library-v1',...assets,records:[...records,...assets.patternRecords.filter(pattern=>!records.some(record=>record.id===pattern.id))]},state});return;
  }
  if(pathname==='/api/library/state'){
    if(req.method==='GET'){sendJson(res,200,store.libraryState());return;}
    if(req.method==='PATCH'){
      if(!guardLocalWrite(req,res))return;
      const body=await readJson(req,2*1024*1024),vocabulary=JSON.parse(await readFile(path.join(PUBLIC_DIR,'library/vocabulary.json'),'utf8'));
      const state=store.setLibraryPart(body.part,body.value,vocabulary);sendJson(res,200,state);return;
    }
    sendError(res,405,'方法不允许');return;
  }
  if(pathname==='/api/library/files'&&req.method==='POST'){
    if(!guardLocalWrite(req,res))return;
    const name=url.searchParams.get('name')||'',ext=path.extname(name).toLowerCase(),bytes=await readBody(req,50*1024*1024);
    const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.glb':'model/gltf-binary','.json':'application/json','.tres':'text/plain','.pdf':'application/pdf','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'};
    if(!types[ext]||!bytes.length||name.length>200){sendError(res,422,'文件类型或名称无效');return;}
    let valid=true;
    if(['.png','.jpg','.jpeg','.gif','.webp'].includes(ext))valid=IMAGE_SNIFFS.some(s=>s.mime===types[ext]&&s.test(bytes));
    if(ext==='.glb')valid=bytes.toString('ascii',0,4)==='glTF';
    if(ext==='.pdf')valid=bytes.toString('ascii',0,5)==='%PDF-';
    if(ext==='.webm')valid=bytes.length>4&&bytes.readUInt32BE(0)===0x1a45dfa3;
    if(['.mp4','.mov'].includes(ext))valid=bytes.length>12&&['ftyp','moov','mdat','wide'].includes(bytes.toString('ascii',4,8));
    if(ext==='.json'){try{JSON.parse(bytes.toString('utf8'));}catch{valid=false;}}
    if(ext==='.svg'){const svg=bytes.toString('utf8');valid=/<svg[\s>]/i.test(svg)&&!/<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["'](?!#)|<!ENTITY/i.test(svg);}
    if(!valid){sendError(res,422,'文件内容与类型不匹配或包含不支持的内容');return;}
    await mkdir(mediaDir,{recursive:true});const filename='library-'+randomBytes(16).toString('hex')+ext,target=path.join(mediaDir,filename);await writeFile(target+'.tmp',bytes);await rename(target+'.tmp',target);
    sendJson(res,201,{path:'/media/'+filename,name,type:types[ext],size:bytes.length,lastModified:Number(url.searchParams.get('lastModified'))||0});return;
  }
  if(pathname==='/api/library/autosaves'){
    if(req.method==='GET'){sendJson(res,200,{items:store.libraryState().autosaves||[]});return;}
    if(req.method==='PUT'){
      if(!guardLocalWrite(req,res))return;const input=await readJson(req,2*1024*1024);
      if(!input||!/^[-A-Za-z0-9_:]{1,120}$/.test(input.recordId||'')||!Array.isArray(input.files)||input.files.length>50){sendError(res,422,'资料文件信息无效');return;}
      const files=[];for(const file of input.files){if(!file||!/^\/media\/library-[a-f0-9]{32}\.(png|jpe?g|webp|gif|svg|glb|json|tres|pdf|mp4|mov|webm)$/.test(file.path||'')){sendError(res,422,'文件引用无效');return;}const bytes=await readFile(path.join(mediaDir,path.basename(file.path)));if(file.size!==bytes.length){sendError(res,422,'文件大小不符');return;}files.push({path:file.path,name:String(file.name||'').slice(0,200),type:String(file.type||'').slice(0,80),size:bytes.length,lastModified:Number(file.lastModified)||0});}
      const edit=store.libraryState().records[input.recordId];if(!edit){sendError(res,422,'请先保存资料信息');return;}
      const item=store.saveLibraryFiles({recordId:input.recordId,topicId:edit.topicId,files,fields:{title:edit.title,note:edit.note},record:{parent_id:input.record?.parent_id||null,category:input.record?.category},assignments:{tagIds:edit.tagIds},updatedAt:new Date().toISOString()});sendJson(res,200,item);return;
    }
    sendError(res,405,'方法不允许');return;
  }

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

export function buildServer(store, { mediaDir = MEDIA_DIR, quizDataFile = mediaDir===MEDIA_DIR?path.join(HERE,'data','quiz-banks.json'):path.join(path.dirname(mediaDir),'quiz-banks.json'), quizEnv = process.env, quizFetch = fetch } = {}) {
  const quiz=createQuizService({store,publicDir:PUBLIC_DIR,dataFile:quizDataFile,env:quizEnv,fetchImpl:quizFetch});
  return http.createServer(async (req, res) => {
    try {
      // Apply the loopback Host check to reads too, so DNS rebinding cannot read
      // the local archive under an attacker-controlled same-origin hostname.
      if (!isAllowedHost(req.headers.host)) {
        sendError(res, 403, '仅允许本机或同一局域网地址访问');
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, url, store, mediaDir, quiz);
      } else if(pathname.startsWith('/media/')&&mediaDir!==MEDIA_DIR&&(req.method==='GET'||req.method==='HEAD')){
        if(!/^\/media\/[A-Za-z0-9._-]+$/.test(pathname)){sendError(res,403,'路径无效');return;}try{const bytes=await readFile(path.join(mediaDir,path.basename(pathname)));res.writeHead(200,{'Content-Type':CONTENT_TYPES[path.extname(pathname)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(req.method==='HEAD'?undefined:bytes);}catch{sendError(res,404,'文件不存在');}
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, pathname);
      } else {
        sendError(res, 405, '方法不允许');
      }
    } catch (err) {
      if (err instanceof QuizError) {sendJson(res,err.status,{error:err.message,code:err.code});
      } else if (err instanceof ValidationError || err instanceof LibraryError) {
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
// 云端沙箱里没有 `node --env-file`（版本差异），这里补一层最小的 .env 读取：只补缺，不覆盖已有环境变量。
function loadDotEnv() {
  const file = path.join(HERE, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
if (isMain) loadDotEnv();
if (isMain) {
  // npm run dev -- --host 127.0.0.1 --port 7100；默认仍是 4318。
  // 手机同一 Wi-Fi 访问：npm start -- --lan（等价于 --host 0.0.0.0 并放行局域网 Host）。
  const argValue = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  // 公网部署：沙箱通过 PORT 环境变量指定端口、经代理域名访问（也可显式 --public）。
  const hostedMode = process.argv.includes('--public') || (!!process.env.PORT && !process.argv.includes('--port'));
  const lanMode = process.argv.includes('--lan') || hostedMode;
  const host = argValue('--host') || (lanMode ? '0.0.0.0' : BIND_HOST);
  const port = Number(argValue('--port') || process.env.PORT || BIND_PORT);
  const hostAllowed = hostedMode || (lanMode
    ? (/^(0\.0\.0\.0|127\.0\.0\.1|localhost|\[::1\])$/.test(host) || lanAddresses().has(host))
    : /^(127\.0\.0\.1|localhost|\[::1\])$/.test(host));
  if (!hostAllowed || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('本地预览仅允许回环 host（或 --lan 时的本机局域网 IP）与 1–65535 端口');
  }
  allowAnyHost = hostedMode;
  allowLanAccess = lanMode;
  const store = createStore({ dataFile: DATA_FILE, seedFile: SEED_FILE });
  store.load();
  const server = buildServer(store,{quizDataFile:path.join(HERE,'data','quiz-banks.json')});
  server.listen(port, host, () => {
    console.log(`W&W Wiki 本地档案已启动：http://${host}:${port}/ （记录 ${store.count()} 条）`);
    if (hostedMode) {
      console.log('公网部署模式：监听 0.0.0.0，放行代理域名；仅题库接口可写，档案与资料库保持只读。');
    }
    if (lanMode && !hostedMode) {
      const addrs = [...lanAddresses()];
      for (const ip of addrs) console.log(`手机（同一 Wi-Fi）访问：http://${ip}:${port}/#/practice`);
      if (!addrs.length) console.log('未检测到局域网 IPv4 地址，请检查 Wi-Fi 或热点连接。');
      console.log('注意：--lan 期间局域网内设备可读写本机档案，用完请重启为默认模式。');
    }
  });
}
