import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createWereadAdapter} from '../server/weread-adapter.mjs';

const envelope = (api, data) => ({ok: true, api_name: api, skill_version: '1.0.4', data});
const bookInfo = (extras = {}) => envelope('/book/info', {bookId: '3300045871', title: '一本书', author: '作者', ...extras});
const toc = (extras = {}) => envelope('/book/chapterinfo', {bookId: '3300045871', chapters: [{chapterUid: 1, title: '序', level: 1, wordCount: 300}, {chapterUid: 2, title: '第一章', level: 1, wordCount: 1000}], ...extras});
const mock = (...results) => {
  const calls = [];
  const execFileImpl = (file, args, options, done) => {
    calls.push({file, args, options});
    const next = results.shift();
    assert.ok(next, 'unexpected CLI invocation');
    queueMicrotask(() => done(next.error || null, next.raw ?? JSON.stringify(next.payload), next.stderr || ''));
    return {kill() {}};
  };
  return {calls, adapter: createWereadAdapter({execFileImpl, execPath: '/opt/local/bin/weread'})};
};

test('doctor only reports installed/configured and strips all credential/path diagnostics', async () => {
  const m = mock({payload: {ok: true, auth_configured: true, api_key_preview: 'wrk-PRIVATE', config_file: '/private/account', base_url: 'https://private.example', hint: 'secret'}});
  const state = await m.adapter.status({action: 'status'});
  assert.equal(state.installed, true);
  assert.equal(state.configured, true);
  assert.equal(state.verified, false);
  assert.equal(state.contentAccess, 'metadata-only');
  assert.ok(!JSON.stringify(state).match(/PRIVATE|private|secret/));
  assert.deepEqual(m.calls[0].args, ['--json', 'doctor']);
});

test('missing binary and missing authorization are explicit safe status states', async () => {
  const missing = mock({error: Object.assign(new Error('private path'), {code: 'ENOENT'})});
  assert.equal((await missing.adapter.status()).installed, false);
  const missingAuth = mock({error: Object.assign(new Error('wrk-SECRET'), {code: 2}), payload: {ok: false, error: {type: 'missing_auth', message: 'wrk-SECRET'}}});
  const state = await missingAuth.adapter.status();
  assert.equal(state.installed, true);
  assert.equal(state.configured, false);
  assert.ok(!state.message.includes('SECRET'));
});

test('shelf consumes the full raw books array, not compact/human truncated items or albums', async () => {
  const books = Array.from({length: 45}, (_, i) => ({bookId: String(i + 1), title: `书 ${i + 1}`, author: '作者', cover: 'https://private.example', secret: 1}));
  const m = mock({payload: {...envelope('/shelf/sync', {books, albums: [{albumInfo: {albumId: 9}}], mp: {name: '文章收藏'}, bookCount: 999}), items: books.slice(0, 30), totalCount: 999}});
  const result = await m.adapter.shelf({action: 'shelf', cursor: null});
  assert.equal(result.books.length, 45);
  assert.equal(result.total, 45);
  assert.equal(result.scope, 'ebooks');
  assert.equal(result.nextCursor, null);
  assert.equal(result.pagination, 'none');
  assert.deepEqual(m.calls[0].args, ['--json', 'shelf', 'list']);
  assert.deepEqual(Object.keys(result.books[0]), ['bookId', 'title', 'author']);
  assert.ok(!JSON.stringify(result).includes('private.example'));
});

test('shelf does not invent a cursor protocol or hide unexpected pagination', async () => {
  const m = mock({payload: envelope('/shelf/sync', {books: [], hasMore: 1})});
  await assert.rejects(m.adapter.shelf({cursor: 'next-page'}), {code: 'WEREAD_PAGINATION_UNSUPPORTED'});
  assert.equal(m.calls.length, 0);
  await assert.rejects(m.adapter.shelf(), {code: 'WEREAD_INVALID_OUTPUT'});
});

test('empty shelf is a successful empty list, malformed response is not', async () => {
  const m = mock({payload: envelope('/shelf/sync', {books: []})}, {payload: envelope('/shelf/sync', {items: []})});
  assert.deepEqual((await m.adapter.shelf()).books, []);
  await assert.rejects(m.adapter.shelf(), {code: 'WEREAD_INVALID_OUTPUT'});
});

test('book imports metadata and ordered TOC but never fabricates or imports returned body', async () => {
  const m = mock({payload: bookInfo({intro: '这是简介，不是序言', text: 'unexpected body', cover: 'https://private.example'})}, {payload: toc({chapters: [{chapterUid: 2, title: '序', level: 1, wordCount: 100, text: 'leak'}, {chapterUid: 3, title: '第一章', level: 2, wordCount: 600}]})});
  const {book} = await m.adapter.book({action: 'book', bookId: '3300045871'});
  assert.equal(book.id, 'weread-3300045871');
  assert.equal(book.source, 'weread');
  assert.equal(book.contentStatus, 'metadata-only');
  assert.deepEqual(book.units, []);
  assert.equal(book.prelude, '');
  assert.equal(book.description, '这是简介，不是序言');
  assert.deepEqual(book.chapters.map(x => [x.chapterUid, x.title, x.level, x.wordCount]), [['2', '序', 1, 100], ['3', '第一章', 2, 600]]);
  assert.ok(!JSON.stringify(book).match(/unexpected body|leak|private.example/));
  assert.deepEqual(m.calls.map(x => x.args), [['--json', 'book', 'info', '3300045871'], ['--json', 'book', 'chapters', '3300045871']]);
});

test('book rejects mismatched book IDs and duplicate TOC IDs instead of importing wrong content', async () => {
  const wrong = mock({payload: bookInfo({bookId: '999'})});
  await assert.rejects(wrong.adapter.book({bookId: '3300045871'}), {code: 'WEREAD_INVALID_OUTPUT'});
  assert.equal(wrong.calls.length, 1);
  const duplicate = mock({payload: bookInfo()}, {payload: toc({chapters: [{chapterUid: 1, title: '章'}, {chapterUid: 1, title: '重复'}]})});
  await assert.rejects(duplicate.adapter.book({bookId: '3300045871'}), {code: 'WEREAD_INVALID_OUTPUT'});
});

test('nested data.book metadata is normalized through the same whitelist as the flat response', async () => {
  const metadata = {bookId: '3300045871', title: '嵌套书籍', author: '作者', intro: '嵌套简介', apiKey: 'PRIVATE-KEY', cover: 'https://private.example', text: 'PRIVATE-BODY'};
  const flat = mock({payload: envelope('/book/info', metadata)}, {payload: toc()});
  const nested = mock({payload: envelope('/book/info', {book: metadata, bookId: '3300045871', title: '不得混入的外层书名', intro: 'PRIVATE-OUTER', account: 'PRIVATE-ACCOUNT'})}, {payload: toc()});
  const flatResult = await flat.adapter.book({bookId: '3300045871'});
  const nestedResult = await nested.adapter.book({bookId: '3300045871'});
  assert.deepEqual(nestedResult, flatResult);
  assert.equal(nestedResult.book.description, '嵌套简介');
  assert.ok(!JSON.stringify(nestedResult).match(/PRIVATE|private\.example|不得混入/));
  assert.deepEqual(nestedResult.book.units, []);
  assert.equal(nestedResult.book.contentStatus, 'metadata-only');
});

test('nested book ID must match the request and any outer ID, and malformed nesting fails closed', async () => {
  for (const data of [
    {book: {bookId: '999', title: '错误书籍'}},
    {bookId: '3300045871', book: {bookId: '999', title: '不得采用外层 ID'}},
    {bookId: '999', book: {bookId: '3300045871', title: '外层不一致'}},
    {bookId: '3300045871', book: {title: '不得推断缺失 ID'}},
    {bookId: '3300045871', title: '不得回退平铺', book: null},
    {bookId: '3300045871', title: '不得回退平铺', book: []}
  ]) {
    const m = mock({payload: envelope('/book/info', data)});
    await assert.rejects(m.adapter.book({bookId: '3300045871'}), {code: 'WEREAD_INVALID_OUTPUT'});
    assert.equal(m.calls.length, 1);
  }
});

test('request cannot inject command arguments, paths, keys, or flags', async () => {
  const m = mock();
  for (const bookId of ['; whoami', '1$(id)', '--help', '../secret', 'a\nb', 'x'.repeat(97), 1, null, {}]) {
    await assert.rejects(m.adapter.book({bookId}), {code: 'WEREAD_INVALID_REQUEST'});
  }
  for (const extra of [{execPath: '/bin/sh'}, {args: ['config', 'list']}, {apiKey: 'wrk-SECRET'}, {action: 'shelf'}, {signal: {aborted: false}}]) {
    await assert.rejects(m.adapter.book({bookId: '123', ...extra}), {code: 'WEREAD_INVALID_REQUEST'});
  }
  assert.equal(m.calls.length, 0);
  for (const execPath of ['./weread', 'node --eval bad', '/bin/sh\n', '', null]) assert.throws(() => createWereadAdapter({execPath}), {code: 'WEREAD_CONFIG_ERROR'});
});

test('CLI child receives only required environment values and never unrelated provider secrets', async () => {
  const calls = [];
  const adapter = createWereadAdapter({
    execPath: '/opt/local/bin/weread',
    configDir: '/tmp/pagepal-weread-config',
    processEnv: {
      PATH: '/usr/bin', LANG: 'zh_CN.UTF-8', HTTPS_PROXY: 'http://proxy.invalid',
      DEEPSEEK_API_KEY: 'TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE',
      OPENAI_API_KEY: 'TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE',
      CUSTOM_SECRET: 'TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE'
    },
    execFileImpl: (file, args, options, done) => {
      calls.push({file, args, options});
      queueMicrotask(() => done(null, JSON.stringify({ok: true, auth_configured: false})));
      return {kill() {}};
    }
  });
  await adapter.status();
  assert.deepEqual(calls[0].options.env, {
    PATH: '/usr/bin', LANG: 'zh_CN.UTF-8', HTTPS_PROXY: 'http://proxy.invalid',
    WEREAD_CLI_CONFIG_DIR: '/tmp/pagepal-weread-config'
  });
  assert.doesNotMatch(JSON.stringify(calls[0].options.env), /DEEPSEEK|OPENAI|CUSTOM_SECRET|TEST_ONLY_FAKE_CREDENTIAL/);
});

test('all commands enforce shell false, fixed resource bounds, and propagate cancellation', async () => {
  const controller = new AbortController();
  const m = mock({payload: envelope('/shelf/sync', {books: []})});
  await m.adapter.shelf({signal: controller.signal});
  const call = m.calls[0];
  assert.equal(call.file, '/opt/local/bin/weread');
  assert.equal(call.options.shell, false);
  assert.equal(call.options.timeout, 30000);
  assert.equal(call.options.maxBuffer, 4 * 1024 * 1024);
  assert.equal(call.options.killSignal, 'SIGKILL');
  assert.equal(call.options.signal, controller.signal);
  controller.abort();
  await assert.rejects(m.adapter.shelf({signal: controller.signal}), {code: 'WEREAD_ABORTED'});
  assert.equal(m.calls.length, 1);
});

test('abort, timeout, buffer, structured auth, unknown process errors never leak stderr or stdout', async () => {
  const cases = [
    [{name: 'AbortError'}, 'WEREAD_ABORTED'],
    [{killed: true}, 'WEREAD_TIMEOUT'],
    [{code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'}, 'WEREAD_OUTPUT_TOO_LARGE'],
    [{code: 2}, 'WEREAD_NOT_CONFIGURED', {ok: false, error: {type: 'http_error', status: 401, message: 'SECRET'}}],
    [{code: 1}, 'WEREAD_REQUEST_FAILED', {ok: false, error: {type: 'api_error', message: 'SECRET'}, response: 'SECRET'}],
    [{code: 1}, 'WEREAD_INVALID_OUTPUT']
  ];
  for (const [attrs, code, payload] of cases) {
    const m = mock({error: Object.assign(new Error('SECRET'), attrs), payload, stderr: 'SECRET'});
    await assert.rejects(m.adapter.shelf(), error => error.code === code && !JSON.stringify(error).includes('SECRET') && !error.message.includes('SECRET'));
  }
});

test('non-JSON, missing envelope, and wrong API name fail closed', async () => {
  const m = mock({raw: '<html>SECRET</html>'}, {payload: {books: []}}, {payload: envelope('/profile', {books: []})});
  for (let i = 0; i < 3; i++) await assert.rejects(m.adapter.shelf(), {code: 'WEREAD_INVALID_OUTPUT'});
});

test('actual child processes are cancelled, timed out, and bounded without running any account CLI', async () => {
  const controller = new AbortController();
  const sleepingProcess = (_file, _args, options, done) => execFile(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options, done);
  const cancellable = createWereadAdapter({execFileImpl: sleepingProcess});
  const pending = cancellable.shelf({signal: controller.signal});
  const timer = setTimeout(() => controller.abort(), 25);
  try { await assert.rejects(pending, {code: 'WEREAD_ABORTED'}); } finally { clearTimeout(timer); }
  const timed = createWereadAdapter({execFileImpl: sleepingProcess, timeoutMs: 25});
  await assert.rejects(timed.shelf(), {code: 'WEREAD_TIMEOUT'});
  const noisy = createWereadAdapter({maxBuffer: 1024, execFileImpl: (_file, _args, options, done) => execFile(process.execPath, ['-e', 'process.stdout.write("X".repeat(4096))'], options, done)});
  await assert.rejects(noisy.shelf(), {code: 'WEREAD_OUTPUT_TOO_LARGE'});
});
