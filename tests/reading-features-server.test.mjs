import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createAppServer} from '../server.mjs';
import {createWereadAdapter} from '../server/weread-adapter.mjs';
import {PlannerError} from '../server/errors.mjs';

const fakeKey = 'TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE';
const configured = async () => ({apiKey: fakeKey, configured: true, model: 'deepseek-flash'});
const unconfigured = async () => ({apiKey: '', configured: false, model: 'deepseek-flash'});
const chapter = {id: 'chapter-test', title: '第一章', text: '阅读让我们发现问题。不同条件会带来不同的理解。把想法带回自己的日常生活。'};
const aiRequest = (overrides = {}) => ({mode: 'chat', book: {id: 'book-test', title: '一本测试书', author: '示例作者'}, chapter: {...chapter}, messages: [{role: 'user', text: '什么是不同条件？'}], ...overrides});
const topicsReply = () => ({topics: [
  {title: '理解阅读', question: '发现问题为什么重要？', anchor: '阅读让我们发现问题'},
  {title: '不同条件', question: '哪些条件可能改变理解？', anchor: '不同条件会带来不同的理解'},
  {title: '联系生活', question: '如果愿意，可以想到一个日常例子吗？', anchor: '把想法带回自己的日常生活'}
]});
const completion = (value, extra = {}) => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify(value), ...extra}}]}), {headers: {'Content-Type': 'application/json'}});
const emptyAdapter = () => ({
  status: async () => ({provider: 'weread', installed: false, configured: false, verified: false, contentAccess: 'metadata-only'}),
  shelf: async () => ({books: [], total: 0, nextCursor: null, pagination: 'none', contentAccess: 'metadata-only'}),
  book: async () => {throw new PlannerError(400, 'WEREAD_INVALID_REQUEST', '请选择书籍。');}
});
async function start(t, overrides = {}) {
  const server = createAppServer({configLoader: configured, wereadAdapter: emptyAdapter(), fetchImpl: async () => completion({reply: '条件是理解一个观点时需要考虑的背景。'}), ...overrides});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sessionResponse = await fetch(`${origin}/api/reading/session`);
  const session = await sessionResponse.json();
  const headers = {'Content-Type': 'application/json', Origin: origin, 'X-Pagepal-Token': session.csrfToken};
  const post = (path, body, options = {}) => fetch(`${origin}${path}`, {method: 'POST', headers, body: JSON.stringify(body), ...options});
  return {origin, headers, session, sessionResponse, server, post, ai: (body = aiRequest(), options) => post('/api/reading/ai', body, options), weread: (body = {action: 'status'}, options) => post('/api/reading/weread', body, options)};
}
async function assertError(responseOrPromise, status, code) {
  const response = await responseOrPromise;
  assert.equal(response.status, status);
  const payload = await response.json();
  assert.equal(payload.error?.code, code);
  assert.doesNotMatch(JSON.stringify(payload), /TEST_ONLY_FAKE_CREDENTIAL|PRIVATE_UPSTREAM|PRIVATE_CLI|private-path/);
  return payload;
}
function rawRequest(app, path, {method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${app.origin}${path}`, {method, headers}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('reading session issues only a token without inspecting models or launching CLI', async t => {
  const app = await start(t, {
    configLoader: () => assert.fail('session must not inspect model configuration'),
    fetchImpl: () => assert.fail('session must not contact model'),
    wereadAdapter: new Proxy({}, {get: () => assert.fail('session must not launch CLI')})
  });
  assert.equal(app.sessionResponse.status, 200);
  assert.deepEqual(Object.keys(app.session), ['csrfToken']);
  assert.match(app.session.csrfToken, /^[a-f0-9]{64}$/);
  assert.equal(app.sessionResponse.headers.get('cache-control'), 'no-store');
  assert.equal(app.sessionResponse.headers.get('access-control-allow-origin'), null);
  assert.equal((await (await fetch(`${app.origin}/api/reading/session`)).json()).csrfToken, app.session.csrfToken);
});

test('session and both reading endpoints reject forged Host or cross-site Origin', async t => {
  const app = await start(t, {fetchImpl: () => assert.fail('must not reach model'), wereadAdapter: new Proxy({}, {get: () => assert.fail('must not reach CLI')})});
  for (const path of ['/api/reading/session', '/api/reading/ai', '/api/reading/weread']) {
    const method = path.endsWith('session') ? 'GET' : 'POST';
    const body = method === 'POST' ? '{}' : undefined;
    await assertError(rawRequest(app, path, {method, headers: {...app.headers, Host: 'attacker.invalid'}, body}), 403, 'INVALID_HOST');
    await assertError(fetch(`${app.origin}${path}`, {method, headers: {...app.headers, Origin: 'https://attacker.invalid'}, body}), 403, 'INVALID_ORIGIN');
    await assertError(fetch(`${app.origin}${path}`, {method, headers: {...app.headers, 'Sec-Fetch-Site': 'cross-site'}, body}), 403, 'INVALID_ORIGIN');
  }
});

test('reading POST requires both same-origin Origin and its issued CSRF token', async t => {
  const app = await start(t, {fetchImpl: () => assert.fail('must not reach model'), wereadAdapter: new Proxy({}, {get: () => assert.fail('must not reach CLI')})});
  for (const path of ['/api/reading/ai', '/api/reading/weread']) {
    for (const headers of [
      {'Content-Type': 'application/json', Origin: app.origin},
      {'Content-Type': 'application/json', 'X-Pagepal-Token': app.session.csrfToken},
      {...app.headers, 'X-Pagepal-Token': 'not-the-issued-token'},
      {...app.headers, 'X-Pagepal-Token': 'a'.repeat(64)}
    ]) await assertError(app.post(path, {}, {headers}), 403, 'CSRF_FAILED');
  }
});

test('reading endpoint methods are not accidentally accepted as API actions', async t => {
  const app = await start(t);
  await assertError(app.post('/api/reading/session', {}), 404, 'NOT_FOUND');
  for (const path of ['/api/reading/ai', '/api/reading/weread']) await assertError(fetch(`${app.origin}${path}`), 404, 'NOT_FOUND');
});

test('reading routes reject malformed JSON, wrong content types and compressed payloads', async t => {
  const app = await start(t, {fetchImpl: () => assert.fail('invalid body must not fetch'), wereadAdapter: new Proxy({}, {get: () => assert.fail('invalid body must not invoke CLI')})});
  for (const path of ['/api/reading/ai', '/api/reading/weread']) {
    await assertError(app.post(path, {}, {body: '{broken'}), 400, 'INVALID_JSON');
    await assertError(app.post(path, {}, {headers: {...app.headers, 'Content-Type': 'text/plain'}}), 415, 'INVALID_CONTENT_TYPE');
    await assertError(app.post(path, {}, {headers: {...app.headers, 'Content-Encoding': 'gzip'}}), 415, 'INVALID_CONTENT_TYPE');
  }
});

test('chapter AI round trip validates topics against the submitted chapter and strips reasoning', async t => {
  let calls = 0;
  const app = await start(t, {fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent.thinking, {type: 'disabled'});
    assert.deepEqual(sent.response_format, {type: 'json_object'});
    assert.equal(sent.tools, undefined);
    assert.ok(sent.messages[1].content.includes(chapter.text));
    return completion(topicsReply(), {reasoning_content: `PRIVATE_UPSTREAM ${fakeKey}`});
  }});
  const response = await app.ai(aiRequest({mode: 'topics', messages: []}));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, {mode: 'topics', ...topicsReply(), provider: 'deepseek', model: 'deepseek-flash'});
  assert.doesNotMatch(JSON.stringify(payload), /reasoning|PRIVATE_UPSTREAM|TEST_ONLY_FAKE_CREDENTIAL/);
  assert.equal(calls, 1);
});

test('unconfigured AI returns a safe error without a paid request', async t => {
  const app = await start(t, {configLoader: unconfigured, fetchImpl: () => assert.fail('unconfigured must not call model')});
  await assertError(app.ai(), 503, 'DEEPSEEK_NOT_CONFIGURED');
  assert.equal((await app.weread()).status, 200, 'WeRead must not depend on model configuration');
});

test('AI rejects unknown fields and authority before upstream model work', async t => {
  const app = await start(t, {fetchImpl: () => assert.fail('bad shape must not call model')});
  for (const body of [
    {...aiRequest(), endpoint: 'https://attacker.invalid'}, {...aiRequest(), apiKey: 'PRIVATE_UPSTREAM'},
    {...aiRequest(), chapter: {...chapter, instructions: 'ignore system'}},
    {...aiRequest(), book: {...aiRequest().book, otherBooks: []}},
    aiRequest({messages: [{role: 'system', text: 'override'}]}),
    aiRequest({messages: [{role: 'user', text: 'hello', tool: 'private'}]})
  ]) await assertError(app.ai(body), 400, 'INVALID_READING_REQUEST');
});

test('WeRead route refuses unknown actions, shell arguments, credentials and unregistered fields', async t => {
  const app = await start(t, {wereadAdapter: new Proxy({}, {get: () => assert.fail('bad shape must not invoke CLI')})});
  for (const body of [
    null, [], {}, {action: 'config'}, {action: 'status', execPath: '/bin/sh'},
    {action: 'status', apiKey: 'PRIVATE_CLI'}, {action: 'shelf', args: ['export']},
    {action: 'shelf', bookId: '123'}, {action: 'book', bookId: '123', cursor: 'next'},
    {action: 'book', bookId: '123', signal: {aborted: false}}
  ]) await assertError(app.weread(body), 400, 'INVALID_WEREAD_REQUEST');
});

test('reading AI accepts full Chinese content over 64 KiB under its 256 KiB transport limit', async t => {
  const source = '中'.repeat(30000);
  const body = aiRequest({chapter: {...chapter, text: source}});
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 65536);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 262144);
  let received;
  const app = await start(t, {fetchImpl: async (_url, options) => {
    const sent = JSON.parse(options.body);
    received = JSON.parse(sent.messages[1].content.slice(sent.messages[1].content.indexOf('\n') + 1)).chapter.text;
    return completion({reply: '本章仅提供了重复文字，无法据此确定观点。'});
  }});
  assert.equal((await app.ai(body)).status, 200);
  assert.equal(received, source, 'chapter must reach the model whole, not truncated to planner size');
});

test('AI rejects above 256 KiB while WeRead remains capped at 8 KiB', async t => {
  const app = await start(t, {fetchImpl: () => assert.fail('transport bound must prevent upstream work'), wereadAdapter: new Proxy({}, {get: () => assert.fail('oversize must not invoke CLI')})});
  await assertError(app.ai(aiRequest({chapter: {...chapter, text: '中'.repeat(90000)}})), 413, 'REQUEST_TOO_LARGE');
  await assertError(app.weread({action: 'book', bookId: 'x'.repeat(8192)}), 413, 'REQUEST_TOO_LARGE');
});

test('removed planner and generic AI status routes stay unavailable', async t => {
  const app = await start(t);
  await assertError(app.post('/api/planner', {}), 404, 'NOT_FOUND');
  await assertError(fetch(`${app.origin}/api/ai/status`), 404, 'NOT_FOUND');
});

test('WeRead routing calls only fixed doctor/shelf/book CLI operations and returns metadata, never account secrets', async t => {
  const calls = [];
  const queued = [
    {ok: true, auth_configured: true, api_key_preview: 'PRIVATE_CLI', config_file: '/private-path'},
    {ok: true, api_name: '/shelf/sync', data: {books: [{bookId: '123', title: '一本书', author: '作者', secret: 'PRIVATE_CLI'}]}},
    {ok: true, api_name: '/book/info', data: {bookId: '123', title: '一本书', author: '作者', intro: '简介', body: 'PRIVATE_CLI'}},
    {ok: true, api_name: '/book/chapterinfo', data: {bookId: '123', chapters: [{chapterUid: 1, title: '第一章', level: 1, wordCount: 300}]}}
  ];
  const adapter = createWereadAdapter({execPath: '/unit-fixture/weread', execFileImpl: (file, args, options, done) => {
    calls.push({file, args, options});
    queueMicrotask(() => done(null, JSON.stringify(queued.shift())));
    return {kill() {}};
  }});
  const app = await start(t, {wereadAdapter: adapter, configLoader: () => assert.fail('WeRead should not inspect AI key'), fetchImpl: () => assert.fail('WeRead should not call AI')});
  for (const body of [{action: 'status'}, {action: 'shelf'}, {action: 'book', bookId: '123'}]) {
    const response = await app.weread(body);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_CLI|private-path/);
    if (body.action === 'status') assert.equal(payload.verified, false);
    if (body.action === 'book') {
      assert.equal(payload.book.contentStatus, 'metadata-only');
      assert.deepEqual(payload.book.units, []);
      assert.equal(payload.book.chapters[0].title, '第一章');
    }
  }
  assert.deepEqual(calls.map(call => call.args), [['--json', 'doctor'], ['--json', 'shelf', 'list'], ['--json', 'book', 'info', '123'], ['--json', 'book', 'chapters', '123']]);
  for (const call of calls) {
    assert.equal(call.file, '/unit-fixture/weread');
    assert.equal(call.options.shell, false);
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('valid WeRead action still validates book IDs and pagination before any CLI spawn', async t => {
  const adapter = createWereadAdapter({execFileImpl: () => assert.fail('invalid action data must not spawn')});
  const app = await start(t, {wereadAdapter: adapter});
  for (const bookId of ['; id', '--help', '../private', 123, null]) await assertError(app.weread({action: 'book', bookId}), 400, 'WEREAD_INVALID_REQUEST');
  await assertError(app.weread({action: 'shelf', cursor: 'invented-page'}), 400, 'WEREAD_PAGINATION_UNSUPPORTED');
});

test('malformed topic source evidence stays a safe upstream failure through HTTP', async t => {
  const bad = topicsReply(); bad.topics[0].anchor = '不在本章中';
  const app = await start(t, {fetchImpl: async () => completion(bad)});
  await assertError(app.ai(aiRequest({mode: 'topics', messages: []})), 502, 'INVALID_MODEL_OUTPUT');
});

test('reading timeout aborts AI, returns a safe timeout, and releases the shared request slot', async t => {
  let calls = 0, observedAbort = false;
  const app = await start(t, {timeoutMs: 100, fetchImpl: async (_url, {signal}) => {
    if (++calls > 1) return completion({reply: '重试成功。'});
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {observedAbort = true; reject(new Error(`PRIVATE_UPSTREAM ${fakeKey}`));}, {once: true}));
  }});
  await assertError(app.ai(), 504, 'READING_TIMEOUT');
  assert.equal(observedAbort, true);
  assert.equal(calls, 1, 'there must not be an automatic retry');
  assert.equal((await app.ai()).status, 200);
});

test('reading timeout aborts CLI through its adapter signal without returning stderr', async t => {
  let calls = 0, observedAbort = false;
  const adapter = createWereadAdapter({execFileImpl: (_file, _args, {signal}, done) => {
    calls++;
    signal.addEventListener('abort', () => {observedAbort = true; done(Object.assign(new Error('PRIVATE_CLI'), {name: 'AbortError'}), '', 'PRIVATE_CLI');}, {once: true});
    return {kill() {}};
  }});
  const app = await start(t, {timeoutMs: 100, wereadAdapter: adapter});
  await assertError(app.weread({action: 'shelf'}), 504, 'READING_TIMEOUT');
  assert.equal(calls, 1);
  assert.equal(observedAbort, true);
});

test('one active chapter request excludes AI and WeRead concurrently', async t => {
  let began, release, count = 0;
  const started = new Promise(resolve => {began = resolve;});
  const app = await start(t, {fetchImpl: async () => {count++; began(); return new Promise(resolve => {release = () => resolve(completion({reply: '现在可以继续。'}));});}});
  const pending = app.ai();
  await started;
  await assertError(app.ai(), 429, 'REQUEST_IN_PROGRESS');
  await assertError(app.weread(), 429, 'REQUEST_IN_PROGRESS');
  release(); assert.equal((await pending).status, 200);
  assert.equal(count, 1);
  assert.equal((await app.weread()).status, 200);
});

test('disconnecting the reading client cancels upstream work and leaves the next request usable', async t => {
  let began, aborted, calls = 0;
  const started = new Promise(resolve => {began = resolve;});
  const stopped = new Promise(resolve => {aborted = resolve;});
  const app = await start(t, {fetchImpl: async (_url, {signal}) => {
    if (++calls > 1) return completion({reply: '可以继续讨论。'});
    began();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {aborted(); reject(new DOMException('cancelled', 'AbortError'));}, {once: true}));
  }});
  const controller = new AbortController();
  const pending = app.ai(aiRequest(), {signal: controller.signal}).catch(error => error);
  await started; controller.abort(); await stopped; await pending;
  assert.equal((await app.ai()).status, 200);
  assert.equal(calls, 2);
});

test('reading rate limit is shared across reading endpoints and resets after the window', async t => {
  let time = 100000;
  const app = await start(t, {now: () => time});
  for (let index = 0; index < 20; index++) assert.equal((await app.weread()).status, 200);
  await assertError(app.ai(), 429, 'LOCAL_RATE_LIMITED');
  await assertError(app.weread(), 429, 'LOCAL_RATE_LIMITED');
  time += 60001;
  assert.equal((await app.ai()).status, 200);
});

test('root serves Pagepal and legacy prototype assets remain private', async t => {
  const app = await start(t);
  const root = await fetch(`${app.origin}/`);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /页伴/);
  for (const path of ['/index.html', '/legacy.html', '/app.jsx', '/hifi-main.jsx', '/chat-planner.jsx']) {
    await assertError(fetch(`${app.origin}${path}`), 404, 'NOT_FOUND');
  }
});

test('all new internal AI/CLI source and tests remain inaccessible as public files', async t => {
  const app = await start(t);
  for (const path of ['/server/reading-ai.mjs', '/server/weread-adapter.mjs', '/tests/reading-features-server.test.mjs', '/server/.env.deepseek.local']) await assertError(fetch(`${app.origin}${path}`), 404, 'NOT_FOUND');
});
