import {execFile} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {PlannerError} from './errors.mjs';

// Adapter for shiquda/weread-cli (npm: weread-agent-cli), not a Tencent CLI.
// Sources checked 2026-09-16:
// https://github.com/shiquda/weread-cli/blob/main/src/cli.ts
// https://github.com/Tencent/WeChatReading/blob/main/skills/book.md
// https://github.com/Tencent/WeChatReading/blob/main/skills/shelf.md
// The official gateway provides metadata / TOC, NOT chapter body content.
// Use raw --json: --compact is a CLI-specific projection that can drop fields.
const API = Object.freeze({shelf: '/shelf/sync', info: '/book/info', chapters: '/book/chapterinfo'});
const BOOK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const CHILD_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'
]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeText = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const unavailable = () => new PlannerError(503, 'WEREAD_CLI_UNAVAILABLE', '未找到微信读书 CLI。请先在本机安装 weread-agent-cli，并配置官方微信读书 API Key；不要把密钥填进网页。');
const invalidOutput = () => new PlannerError(502, 'WEREAD_INVALID_OUTPUT', '微信读书 CLI 返回的数据格式不兼容，未导入任何内容。请检查 CLI 版本后重试。');
const invalidRequest = () => new PlannerError(400, 'WEREAD_INVALID_REQUEST', '微信读书请求格式不正确，请重新选择书籍。');
const aborted = () => new PlannerError(499, 'WEREAD_ABORTED', '已取消微信读书请求。');
const numeric = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;

function childEnvironment(source, configDir) {
  const result = {};
  for (const key of CHILD_ENV_KEYS) {
    if (typeof source[key] === 'string') result[key] = source[key];
  }
  if (configDir) result.WEREAD_CLI_CONFIG_DIR = configDir;
  return result;
}

function identifier(value) {
  const text = typeof value === 'string' ? value : Number.isSafeInteger(value) && value >= 0 ? String(value) : '';
  return BOOK_ID.test(text) ? text : null;
}

function validateOptions(value, action, fields = []) {
  if (!isObject(value) || Object.keys(value).some(key => !['action', 'signal', ...fields].includes(key))) throw invalidRequest();
  if (value.action !== undefined && value.action !== action) throw invalidRequest();
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) throw invalidRequest();
}

function failure(payload) {
  const error = isObject(payload.error) ? payload.error : {};
  if (error.type === 'missing_auth' || error.status === 401 || error.status === 403) {
    return new PlannerError(503, 'WEREAD_NOT_CONFIGURED', '微信读书 CLI 尚未授权，或授权已失效。请在本机完成官方 API Key 配置，再重新读取书架；不要在网页或聊天中粘贴密钥。');
  }
  if (error.type === 'upgrade_required') return new PlannerError(503, 'WEREAD_UPGRADE_REQUIRED', '微信读书接口要求升级 CLI，请先更新 weread-agent-cli 后重试。');
  if (error.type === 'upstream_timeout') return new PlannerError(504, 'WEREAD_TIMEOUT', '微信读书请求超时，请稍后重试。');
  if (error.status === 429) return new PlannerError(429, 'WEREAD_RATE_LIMIT', '微信读书请求过于频繁，请稍后再试。');
  return new PlannerError(502, 'WEREAD_REQUEST_FAILED', '暂时无法读取微信读书数据。请检查本机 CLI 授权与网络后重试。');
}

function parseEnvelope(stdout) {
  let result;
  try { result = JSON.parse(stdout); } catch { throw invalidOutput(); }
  if (!isObject(result) || typeof result.ok !== 'boolean') throw invalidOutput();
  if (!result.ok) throw failure(result);
  return result;
}

function bookSummary(record) {
  if (!isObject(record)) throw invalidOutput();
  const bookId = identifier(record.bookId);
  const title = safeText(record.title);
  if (!bookId || !title) throw invalidOutput();
  // Deliberately exclude cover / deepLink / account data / unknown properties.
  return {bookId, title, author: safeText(record.author) || '作者未提供'};
}

export function createWereadAdapter({
  execFileImpl = execFile,
  execPath = process.env.WEREAD_CLI_PATH || 'weread',
  configDir,
  processEnv = process.env,
  timeoutMs = 30000,
  maxBuffer = 4 * 1024 * 1024
} = {}) {
  // Only server-owned startup configuration selects the executable. HTTP
  // requests cannot supply a path, command, flags, endpoint or credential.
  if (typeof execPath !== 'string' || execPath.length > 4096 || /[\u0000-\u001f\u007f]/.test(execPath) || (execPath !== 'weread' && !isAbsolute(execPath))) {
    throw new PlannerError(503, 'WEREAD_CONFIG_ERROR', 'WEREAD_CLI_PATH 必须是本机 CLI 的绝对路径。');
  }
  if (configDir !== undefined && (typeof configDir !== 'string' || configDir.length > 4096 || /[\u0000-\u001f\u007f]/.test(configDir) || !isAbsolute(configDir))) {
    throw new PlannerError(503, 'WEREAD_CONFIG_ERROR', 'WEREAD_CLI_CONFIG_DIR 必须是本机配置目录的绝对路径。');
  }
  if (typeof execFileImpl !== 'function' || !isObject(processEnv) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1024 || maxBuffer > 8 * 1024 * 1024) {
    throw new PlannerError(503, 'WEREAD_CONFIG_ERROR', '微信读书 CLI 适配器配置不正确。');
  }

  function run(action, {bookId, signal} = {}) {
    if (signal?.aborted) return Promise.reject(aborted());
    const command = action === 'status' ? ['doctor'] : action === 'shelf' ? ['shelf', 'list'] : action === 'info' ? ['book', 'info', bookId] : action === 'chapters' ? ['book', 'chapters', bookId] : null;
    if (!command || ((action === 'info' || action === 'chapters') && !identifier(bookId))) return Promise.reject(invalidRequest());
    return new Promise((resolve, reject) => {
      const finish = (error, stdout = '') => {
        try {
          if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw aborted();
          if (error?.code === 'ENOENT') throw unavailable();
          if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || Buffer.byteLength(String(stdout), 'utf8') > maxBuffer) throw new PlannerError(502, 'WEREAD_OUTPUT_TOO_LARGE', '微信读书数据超过单次安全读取上限，未截断或导入数据。');
          if (error?.killed || error?.code === 'ETIMEDOUT') throw new PlannerError(504, 'WEREAD_TIMEOUT', '微信读书请求超时，请稍后重试。');
          // A failed CLI often emits its structured error to stdout. Parse that
          // only to select an allowlisted local message, never expose raw errors.
          const output = parseEnvelope(String(stdout));
          if (error) throw new PlannerError(502, 'WEREAD_REQUEST_FAILED', '微信读书 CLI 未正常完成，未导入任何内容。');
          if (action !== 'status' && (output.api_name !== API[action] || !isObject(output.data))) throw invalidOutput();
          resolve(output);
        } catch (safeError) { reject(safeError instanceof PlannerError ? safeError : invalidOutput()); }
      };
      try {
        execFileImpl(execPath, ['--json', ...command], {
          encoding: 'utf8', shell: false, windowsHide: true,
          timeout: timeoutMs, maxBuffer, killSignal: 'SIGKILL',
          env: childEnvironment(processEnv, configDir),
          ...(signal ? {signal} : {})
        }, finish);
      } catch (error) {
        reject(error?.code === 'ENOENT' ? unavailable() : new PlannerError(503, 'WEREAD_CLI_UNAVAILABLE', '微信读书 CLI 暂时无法运行，请检查本机安装与执行权限。'));
      }
    });
  }

  return Object.freeze({
    async status(options = {}) {
      validateOptions(options, 'status');
      const base = {provider: 'weread',verified: false, contentAccess: 'metadata-only'};
      try {
        const payload = await run('status', options);
        if (typeof payload.auth_configured !== 'boolean') throw invalidOutput();
        return {...base, installed: true, configured: payload.auth_configured, message: payload.auth_configured ? 'CLI 已配置；尚未验证联网授权。读取书架后可导入书籍信息和目录，不包含正文。' : 'CLI 已安装，但尚未配置官方 API Key。请在本机完成授权。'};
      } catch (error) {
        if (error.code === 'WEREAD_CLI_UNAVAILABLE') return {...base, installed: false, configured: false, message: error.message};
        if (error.code === 'WEREAD_NOT_CONFIGURED') return {...base, installed: true, configured: false, message: error.message};
        throw error;
      }
    },

    async shelf(options = {}) {
      validateOptions(options, 'shelf', ['cursor']);
      // /shelf/sync has no pagination parameters. Do not invent --cursor or
      // --page, truncate its JSON output, or silently pretend a page was loaded.
      if (options.cursor !== undefined && options.cursor !== null && options.cursor !== '') throw new PlannerError(400, 'WEREAD_PAGINATION_UNSUPPORTED', '当前微信读书书架接口一次返回电子书列表，不支持分页游标。请重新读取书架。');
      const {data} = await run('shelf', options);
      if (!Array.isArray(data.books) || data.books.length > 10000 || (data.hasMore !== undefined && ![false, 0, null].includes(data.hasMore))) throw invalidOutput();
      const seen = new Set();
      const books = data.books.map(bookSummary).filter(book => !seen.has(book.bookId) && seen.add(book.bookId));
      return {
        books, total: books.length, nextCursor: null, pagination: 'none', scope: 'ebooks',
        contentAccess: 'metadata-only',
        message: '仅列出可导入的电子书条目，不含有声书与文章收藏；导入内容为书籍信息和目录，不含正文。'
      };
    },

    async book(options = {}) {
      validateOptions(options, 'book', ['bookId']);
      if (typeof options.bookId !== 'string' || !identifier(options.bookId)) throw invalidRequest();
      const info = await run('info', options);
      // The CLI supports both flat gateway metadata and a data.book envelope.
      // Never mix fields from the two shapes or infer a missing nested ID from
      // the request: every supplied book identity must agree with the selection.
      const metadata = Object.hasOwn(info.data, 'book') ? info.data.book : info.data;
      if (!isObject(metadata) || (Object.hasOwn(info.data, 'bookId') && identifier(info.data.bookId) !== options.bookId)) throw invalidOutput();
      const summary = bookSummary(metadata);
      if (summary.bookId !== options.bookId) throw invalidOutput();
      const toc = await run('chapters', options);
      if (identifier(toc.data.bookId) !== options.bookId || !Array.isArray(toc.data.chapters) || toc.data.chapters.length > 10000) throw invalidOutput();
      const seen = new Set();
      const chapters = toc.data.chapters.map((chapter, index) => {
        if (!isObject(chapter)) throw invalidOutput();
        const uid = identifier(chapter.chapterUid);
        const title = safeText(chapter.title);
        if (!uid || !title || seen.has(uid)) throw invalidOutput();
        seen.add(uid);
        return {id: `weread-${summary.bookId}-${uid}`, chapterUid: uid, title, level: Math.min(20, Math.max(1, numeric(chapter.level, 1))), order: index, wordCount: numeric(chapter.wordCount)};
      });
      return {book: {
        id: `weread-${summary.bookId}`, ...summary, source: 'weread', format: '微信读书',
        contentStatus: 'metadata-only', chapters, units: [], prelude: '',
        description: safeText(metadata.intro, 4000),
        notice: '已从微信读书导入书籍信息与目录，未导入正文。请补充你有权使用的 EPUB / TXT / Markdown，才能按正文生成阅读计划和章节讨论。'
      }};
    }
  });
}
