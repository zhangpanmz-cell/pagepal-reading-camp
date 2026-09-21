import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile, lstat, realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname, join, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConfigLoader} from './server/config.mjs';
import {PlannerError} from './server/errors.mjs';
import {runReadingAI} from './server/reading-ai.mjs';
import {createWereadAdapter} from './server/weread-adapter.mjs';

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const LOCAL_WEREAD_CLI = join(APP_ROOT, 'node_modules', '.bin', 'weread');
// Explicit public assets, not a glob: future config/source files stay private.
const PUBLIC_FILES = new Set([
  'reading.html', 'reading-library.html', 'reading-camp.html', 'reading-session.html', 'reading-notes.html',
  'react.production.min.js', 'react-dom.production.min.js',
  'reading.css', 'reading-ui.js', 'reading-art.js', 'reading-content.js', 'reading-model.js', 'reading-store.js', 'reading-import.js',
  'reading-api.js', 'reading-discussion.js', 'reading-extras.js', 'reading-export.js', 'reading-features.css',
  'reading-preferences.js'
]);
const MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8'};
const MAX_BODY = 65536;

function responseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}
function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}
function secureRequest(req, server) {
  const port = server.address()?.port;
  const host = req.headers.host;
  if (req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'host').length !== 1 || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) {
    throw new PlannerError(403, 'INVALID_HOST', '请从本机的页伴页面访问此服务。');
  }
  const origin = `http://${host}`;
  if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new PlannerError(403, 'INVALID_ORIGIN', '此接口只接受本机页伴页面的请求。');
  return origin;
}
async function readJson(req, limit = MAX_BODY) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) throw new PlannerError(415, 'INVALID_CONTENT_TYPE', '请使用 JSON 格式发送消息。');
  if (Number(req.headers['content-length']) > limit) throw new PlannerError(413, 'REQUEST_TOO_LARGE', '这次对话太长了，请缩短内容后再发送。');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new PlannerError(413, 'REQUEST_TOO_LARGE', '这次对话太长了，请缩短内容后再发送。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PlannerError(400, 'INVALID_JSON', '消息格式不完整，请重新发送。'); }
}
export function createAppServer({appRoot = join(APP_ROOT, 'public'), fetchImpl = globalThis.fetch, configLoader = createConfigLoader(join(APP_ROOT, 'server', '.env.deepseek.local')), wereadAdapter = createWereadAdapter({execPath:process.env.WEREAD_CLI_PATH || (existsSync(LOCAL_WEREAD_CLI) ? LOCAL_WEREAD_CLI : 'weread'), configDir: join(APP_ROOT, 'server', '.weread-cli')}), timeoutMs = 60000, now = Date.now} = {}) {
  const csrfToken = randomBytes(32).toString('hex');
  const tokenBuffer = Buffer.from(csrfToken);
  let active = false;
  const requestTimes = [];
  const server = http.createServer(async (req, res) => {
    responseHeaders(res);
    let controller, timeout, releaseSlot = false;
    const abortDisconnected = () => { if (!res.writableEnded) controller?.abort(); };
    try {
      const origin = secureRequest(req, server);
      const pathname = (req.url || '').split('?')[0];
      if (pathname === '/api/reading/session' && req.method === 'GET') {
        json(res, 200, {csrfToken}); return;
      }
      if (['/api/reading/ai', '/api/reading/weread'].includes(pathname) && req.method === 'POST') {
        const supplied = Buffer.from(String(req.headers['x-pagepal-token'] || ''));
        if (req.headers.origin !== origin || supplied.length !== tokenBuffer.length || !timingSafeEqual(supplied, tokenBuffer)) throw new PlannerError(403, 'CSRF_FAILED', '页面会话已失效，请刷新页面后再试。');
        if (active) throw new PlannerError(429, 'REQUEST_IN_PROGRESS', '另一个请求还在处理中，请稍后再试。');
        const currentTime = now();
        while (requestTimes.length && requestTimes[0] <= currentTime - 60000) requestTimes.shift();
        if (requestTimes.length >= 20) throw new PlannerError(429, 'LOCAL_RATE_LIMITED', '本分钟请求较多，请稍等片刻。');
        active = true; releaseSlot = true;
        const body = await readJson(req, pathname === '/api/reading/ai' ? 262144 : 8192);
        requestTimes.push(currentTime);
        controller = new AbortController();
        let timedOut = false;
        timeout = setTimeout(() => {timedOut = true; controller.abort();}, timeoutMs);
        req.on('aborted', abortDisconnected); res.on('close', abortDisconnected);
        if (req.aborted || res.destroyed) {controller.abort(); return;}
        try {
          let result;
          if (pathname === '/api/reading/ai') {
            result = await runReadingAI(body, {config:await configLoader(), fetchImpl, signal:controller.signal});
          } else {
            if (!body || typeof body !== 'object' || Array.isArray(body) || !['status','shelf','book'].includes(body.action)) throw new PlannerError(400, 'INVALID_WEREAD_REQUEST', '请选择连接检查、书架或书籍信息。');
            const allowed = body.action === 'book' ? ['action','bookId'] : body.action === 'shelf' ? ['action','cursor'] : ['action'];
            if (Object.keys(body).some(key => !allowed.includes(key))) throw new PlannerError(400, 'INVALID_WEREAD_REQUEST', '微信读书请求含有不支持的字段。');
            result = await wereadAdapter[body.action]({...body, signal:controller.signal});
          }
          json(res, 200, result); return;
        } catch (error) {
          if (controller.signal.aborted) {
            if (res.destroyed) return;
            throw new PlannerError(504, timedOut ? 'READING_TIMEOUT' : 'REQUEST_CANCELLED', timedOut ? '请求超时，未改动笔记。不会自动重试，请稍后手动操作。' : '已取消等待，未改动笔记。');
          }
          throw error;
        }
      }
      if (pathname.startsWith('/api/')) throw new PlannerError(404, 'NOT_FOUND', '未找到此接口。');
      if (!['GET', 'HEAD'].includes(req.method)) throw new PlannerError(405, 'METHOD_NOT_ALLOWED', '此页面不支持这种请求方式。');
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { throw new PlannerError(404, 'NOT_FOUND', '未找到此页面。'); }
      const name = decoded === '/' ? 'reading.html' : /^\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(decoded) ? decoded.slice(1) : '';
      if (!PUBLIC_FILES.has(name)) throw new PlannerError(404, 'NOT_FOUND', '未找到此页面。');
      const root = await realpath(appRoot);
      const file = join(root, name);
      try {
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file) !== file) throw new Error('private');
        const content = await readFile(file);
        res.writeHead(200, {'Content-Type': MIME[extname(name)], 'Content-Length': content.length});
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch { throw new PlannerError(404, 'NOT_FOUND', '未找到此页面。'); }
    } catch (error) {
      const safe = error instanceof PlannerError ? error : new PlannerError(500, 'INTERNAL_ERROR', '本地服务暂时出错，请稍后再试。');
      json(res, safe.status, {error: {code: safe.code, message: safe.message}});
    } finally {
      clearTimeout(timeout);
      req.off('aborted', abortDisconnected);
      res.off('close', abortDisconnected);
      if (releaseSlot) active = false;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('PORT 必须是 1 到 65535 的整数。'); process.exitCode = 1; }
  else {
    const server = createAppServer();
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请先停止旧的预览服务或更换 PORT。` : '无法启动本地服务。'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`页伴本地服务：http://127.0.0.1:${port}/（API Key 仅从服务端配置读取）`));
  }
}
