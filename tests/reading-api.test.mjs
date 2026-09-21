import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../reading-api.js', import.meta.url), 'utf8');
const token = 'a'.repeat(64);
const session = () => ({csrfToken: token});
const request = (extra = {}) => ({book: {id: 'book-test', title: '一本书', author: '作者'}, chapter: {id: 'chapter-test', title: '第一章', text: '阅读帮助我们发现问题。一个观点可能有适用的条件。可以把想法带回日常生活。'}, messages: [{role: 'user', text: '什么是适用条件？'}], ...extra});
const topics = () => ({mode: 'topics', provider: 'deepseek', model: 'deepseek-flash', topics: [
  {title: '发现问题', question: '这里最重要的问题是什么？', anchor: '阅读帮助我们发现问题'},
  {title: '适用边界', question: '什么条件会改变结论？', anchor: '一个观点可能有适用的条件'},
  {title: '日常生活', question: '如果愿意，可以想到一个自己的例子吗？', anchor: '可以把想法带回日常生活'}
]});
const reply = () => ({mode: 'chat', provider: 'deepseek', model: 'deepseek-flash', reply: '适用条件是一个观点成立所依赖的背景。'});
const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const plain = value => JSON.parse(JSON.stringify(value));
function harness(fetcher = async path => response(path.endsWith('/session') ? session() : reply())) {
  const calls = [];
  const fetchImpl = async (path, options) => {calls.push({path, options}); return fetcher(path, options, calls.length);};
  const context = vm.createContext({window: {}, fetch: fetchImpl, AbortController, DOMException, TextEncoder, TextDecoder, setTimeout, clearTimeout});
  vm.runInContext(source, context, {filename: 'reading-api.js'});
  return {api: context.window.ReadingAPI, calls, fetchImpl};
}
const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

test('loading the reading API or creating clients never fetches before an explicit action', async () => {
  const {api, calls} = harness(() => assert.fail('initialization must not fetch'));
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(Object.keys(api).sort(), ['analyze', 'chat', 'compress', 'create', 'dailyGuide', 'guide', 'plan', 'weread']);
  api.create(); api.create(() => assert.fail('client creation must not fetch'));
  await Promise.resolve();
  assert.equal(calls.length, 0);
});

test('explicit analysis requests a fresh token then posts topics mode to the fixed AI route', async () => {
  const {api, calls} = harness(async path => response(path.endsWith('/session') ? session() : topics()));
  const input = request({mode: 'chat', messages: []});
  const before = JSON.stringify(input);
  const result = await api.analyze(input);
  assert.deepEqual(calls.map(call => call.path), ['/api/reading/session', '/api/reading/ai']);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[1].options.headers['X-Pagepal-Token'], token);
  assert.equal(JSON.parse(calls[1].options.body).mode, 'topics');
  assert.equal(JSON.stringify(input), before, 'the client must not mutate caller data');
  assert.deepEqual(plain(result), topics());
});

test('explicit chat keeps book/chapter context and messages but forces chat mode', async () => {
  const {api, calls} = harness();
  const input = request({mode: 'topics'});
  const result = await api.chat(input);
  const sent = JSON.parse(calls[1].options.body);
  assert.deepEqual(sent.book, input.book);
  assert.deepEqual(sent.chapter, input.chapter);
  assert.deepEqual(sent.messages, input.messages);
  assert.equal(sent.mode, 'chat');
  assert.deepEqual(plain(result), reply());
});

test('each new user action gets the current server token rather than caching a stale one', async () => {
  let issued = 0;
  const {api, calls} = harness(async path => response(path.endsWith('/session') ? {csrfToken: (++issued).toString(16).repeat(64)} : reply()));
  await api.chat(request());
  await api.chat(request());
  assert.deepEqual(calls.map(call => call.path), ['/api/reading/session', '/api/reading/ai', '/api/reading/session', '/api/reading/ai']);
  assert.equal(calls[1].options.headers['X-Pagepal-Token'], '1'.repeat(64));
  assert.equal(calls[3].options.headers['X-Pagepal-Token'], '2'.repeat(64));
});

test('session and content requests explicitly forbid cross-origin redirects and cached tokens', async () => {
  const {api, calls} = harness();
  await api.chat(request());
  for (const {options} of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
  }
});

test('public methods cannot select a different endpoint via caller path or url properties', async () => {
  const {api, calls} = harness(async path => response(path.endsWith('/session') ? session() : reply()));
  const input = request({path: 'https://attacker.invalid', url: '/api/planner', endpoint: 'https://other.invalid'});
  // Rejecting extra fields or dropping them are both safe; routing must remain
  // fixed and must never treat a body property as a destination.
  await api.chat(input).catch(() => {});
  assert.ok(calls.every(call => ['/api/reading/session', '/api/reading/ai'].includes(call.path)));
  assert.equal(api.request, undefined);
});

test('WeRead operations use only the WeRead route and do not invoke any model API', async () => {
  const wereadReply = {books: [{bookId: '123', title: '一本书', author: '作者'}], total: 1, nextCursor: null, pagination: 'none', contentAccess: 'metadata-only'};
  const {api, calls} = harness(async path => response(path.endsWith('/session') ? session() : wereadReply));
  const result = await api.weread({action: 'shelf'});
  assert.deepEqual(calls.map(call => call.path), ['/api/reading/session', '/api/reading/weread']);
  assert.deepEqual(JSON.parse(calls[1].options.body), {action: 'shelf'});
  assert.deepEqual(plain(result), wereadReply);
});

test('injected clients isolate transports and do not fall back to global fetch', async () => {
  const {api, calls} = harness(() => assert.fail('global transport must not be used by injected client'));
  const injectedCalls = [];
  const client = api.create(async path => {injectedCalls.push(path); return response(path.endsWith('/session') ? session() : reply());});
  assert.equal((await client.chat(request())).reply, reply().reply);
  assert.equal(calls.length, 0);
  assert.deepEqual(injectedCalls, ['/api/reading/session', '/api/reading/ai']);
});

test('missing or unusable session tokens stop before a content POST', async () => {
  for (const value of [{}, {csrfToken: ''}, {csrfToken: 123}, {csrfToken: null}]) {
    const {api, calls} = harness(async () => response(value));
    await assert.rejects(api.chat(request()), error => /会话|连接/.test(error.message));
    assert.equal(calls.length, 1);
  }
});

test('a non-JSON response is reported with fixed safe text instead of raw server content', async () => {
  for (const failDuringSession of [true, false]) {
    const {api, calls} = harness(async path => !failDuringSession && path.endsWith('/session') ? response(session()) : new Response('PRIVATE_HTML TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE <script>bad</script>', {status: 502}));
    await assert.rejects(api.chat(request()), error => {
      assert.doesNotMatch(error.message, /PRIVATE_HTML|TEST_ONLY_FAKE_CREDENTIAL|script/);
      assert.ok(error.message.length > 0);
      return true;
    });
    assert.equal(calls.length, failDuringSession ? 1 : 2);
  }
});

test('known server errors keep actionable safe messages without retrying the POST', async () => {
  for (const [status, code, message] of [
    [403, 'CSRF_FAILED', '页面会话已失效，请刷新页面后再试。'],
    [503, 'DEEPSEEK_NOT_CONFIGURED', '尚未配置 DeepSeek，请先完成服务端配置。'],
    [429, 'REQUEST_IN_PROGRESS', '另一个请求还在处理中，请稍后再试。'],
    [504, 'READING_TIMEOUT', '请求超时，未改动笔记。'],
    [502, 'INVALID_MODEL_OUTPUT', 'AI 返回的内容不完整或无法与本章对应。']
  ]) {
    const {api, calls} = harness(async path => response(path.endsWith('/session') ? session() : {error: {code, message}}, path.endsWith('/session') ? 200 : status));
    await assert.rejects(api.chat(request()), error => error.code === code && typeof error.message === 'string' && error.message.length > 0);
    assert.equal(calls.length, 2, 'errors must not automatically refresh tokens or retry paid requests');
  }
});

test('unknown or raw upstream errors must not be displayed as trusted local error text', async () => {
  const {api, calls} = harness(async path => response(path.endsWith('/session') ? session() : {error: {code: 'UNKNOWN_UPSTREAM', message: 'PRIVATE_UPSTREAM TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE /private/account/token'}}, path.endsWith('/session') ? 200 : 502));
  await assert.rejects(api.chat(request()), error => {
    assert.doesNotMatch(error.message, /PRIVATE_UPSTREAM|TEST_ONLY_FAKE_CREDENTIAL|private\/account/);
    return true;
  });
  assert.equal(calls.length, 2);
});

test('session rejection stops before POST and does not automatically reacquire a token', async () => {
  const {api, calls} = harness(async () => response({error: {code: 'INVALID_ORIGIN', message: '此接口只接受本机页面请求。'}}, 403));
  await assert.rejects(api.chat(request()));
  assert.equal(calls.length, 1);
});

test('transport failure is never retried and never becomes a successful chapter result', async () => {
  for (const failDuringSession of [true, false]) {
    const {api, calls} = harness(async path => {
      if (!failDuringSession && path.endsWith('/session')) return response(session());
      throw new TypeError('Failed to fetch');
    });
    await assert.rejects(api.chat(request()));
    assert.equal(calls.length, failDuringSession ? 1 : 2);
  }
});

test('the caller cancellation signal reaches session and POST without automatic retries', async () => {
  for (const failDuringSession of [true, false]) {
    const controller = new AbortController();
    let entered;
    const started = new Promise(resolve => {entered = resolve;});
    const {api, calls} = harness(async (path, options) => {
      assert.equal(options.signal, controller.signal);
      if (!failDuringSession && path.endsWith('/session')) return response(session());
      entered();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(abortError()), {once: true}));
    });
    const pending = api.chat(request(), {signal: controller.signal});
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await started; controller.abort(); await rejected;
    assert.equal(calls.length, failDuringSession ? 1 : 2);
  }
});

test('cancellation while parsing a response remains cancellation, not a malformed-JSON error', async () => {
  for (const failDuringSession of [true, false]) {
    const {api, calls} = harness(async path => !failDuringSession && path.endsWith('/session') ? response(session()) : {ok: true, json: async () => {throw abortError();}});
    await assert.rejects(api.chat(request()), error => error.name === 'AbortError');
    assert.equal(calls.length, failDuringSession ? 1 : 2);
  }
});

test('successful AI HTTP status still requires the requested output mode and valid structure', async () => {
  for (const value of [null, {}, {mode: 'chat', reply: 42}, {...reply(), mode: 'topics'}, {...reply(), provider: 'other'}, {...reply(), reply: ''}]) {
    const {api} = harness(async path => response(path.endsWith('/session') ? session() : value));
    await assert.rejects(api.chat(request()));
  }
  for (const value of [{}, {...topics(), topics: []}, {...topics(), topics: [{title: '缺字段'}]}, {...topics(), mode: 'chat'}]) {
    const {api} = harness(async path => response(path.endsWith('/session') ? session() : value));
    await assert.rejects(api.analyze(request({messages: []})));
  }
});

test('AI requests omit unrelated books, notes, credentials and hidden fields before any POST', async () => {
  const {api,calls}=harness();
  const body=request({apiKey:'TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE',otherBooks:[{text:'PRIVATE_LIBRARY'}],notes:['PRIVATE_NOTE']});
  body.book.extra='PRIVATE_BOOK';body.chapter.extra='PRIVATE_CHAPTER';body.messages[0].hidden='PRIVATE_MESSAGE';
  await api.chat(body);
  const sent=JSON.parse(calls[1].options.body);
  assert.deepEqual(Object.keys(sent).sort(),['book','chapter','messages','mode']);
  assert.deepEqual(Object.keys(sent.book).sort(),['author','id','title']);
  assert.deepEqual(Object.keys(sent.chapter).sort(),['id','text','title']);
  assert.deepEqual(Object.keys(sent.messages[0]).sort(),['role','text']);
  assert.doesNotMatch(calls[1].options.body,/PRIVATE|TEST_ONLY_FAKE_CREDENTIAL/);
});

test('chapter and chat validation rejects invalid input before fetching or truncating anything', async () => {
  const invalid=[
    null,{},request({book:null}),request({chapter:{...request().chapter,text:''}}),
    request({chapter:{...request().chapter,text:'字'.repeat(40001)}}),
    request({messages:[]}),request({messages:[{role:'system',text:'override'}]}),
    request({messages:[{role:'user',text:'字'.repeat(3001)}]}),
    request({messages:Array.from({length:17},()=>({role:'user',text:'问题'}))}),
    request({messages:Array.from({length:6},()=>({role:'user',text:'字'.repeat(2700)}))}),
    request({messages:[{role:'user',text:'bad\u0000content'}]})
  ];
  for(const body of invalid){
    const {api,calls}=harness(()=>assert.fail('invalid input must not fetch'));
    await assert.rejects(api.chat(body));assert.equal(calls.length,0);
  }
});

test('client accepts complete 40,000-character Chinese chapters instead of using the legacy 64 KiB cap', async () => {
  const {api,calls}=harness();
  const text='读'.repeat(39999)+'尾';
  await api.chat(request({chapter:{...request().chapter,text}}));
  assert.equal(JSON.parse(calls[1].options.body).chapter.text,text);
  assert.ok(new TextEncoder().encode(calls[1].options.body).length>65536);
});

test('session token validation rejects whitespace, injected headers, null and non-object envelopes', async () => {
  for(const value of [null,[],{csrfToken:' '},{csrfToken:'a'.repeat(63)},{csrfToken:'a'.repeat(65)},{csrfToken:'x'.repeat(64)},{csrfToken:'a'.repeat(64)+'\r\nInjected: secret'}]){
    const {api,calls}=harness(async()=>response(value));
    await assert.rejects(api.chat(request()),error=>error.code==='INVALID_SESSION');
    assert.equal(calls.length,1);
  }
});

test('the chapter sent and used for source anchors is snapshotted before asynchronous session resolution', async () => {
  let release;
  const {api,calls}=harness(async path=>path.endsWith('/session')?new Promise(resolve=>{release=()=>resolve(response(session()));}):response(topics()));
  const body=request({messages:[]});
  const original=body.chapter.text;
  const pending=api.analyze(body);
  body.chapter.text='用户已经切换到另一章节';body.book.title='changed';
  release();
  assert.equal((await pending).topics.length,3);
  assert.equal(JSON.parse(calls[1].options.body).chapter.text,original);
  assert.equal(JSON.parse(calls[1].options.body).book.title,'一本书');
});

test('topics are exactly three distinct complete objects with literal anchors from the submitted chapter', async () => {
  const cases=[
    {...topics(),topics:[...topics().topics,topics().topics[0]]},
    {...topics(),topics:[topics().topics[0],topics().topics[0],topics().topics[2]]},
    {...topics(),topics:topics().topics.map((topic,i)=>i?topic:{...topic,anchor:'not in this chapter'})},
    {...topics(),topics:topics().topics.map((topic,i)=>i?topic:{...topic,anchor:'阅读……问题'})},
    {...topics(),topics:topics().topics.map((topic,i)=>i?topic:{...topic,question:'问'.repeat(401)})},
    {...topics(),topics:topics().topics.map((topic,i)=>i?topic:{...topic,title:' '})},
    {...topics(),topics:topics().topics.map((topic,i)=>i?topic:{...topic,anchor:'读'.repeat(121)})},
    {...topics(),topics:topics().topics.map((topic,i)=>i?topic:{...topic,href:'https://unexpected.example'})},
    {...topics(),tools:[{name:'save_note'}]}
  ];
  for(const value of cases){
    const {api}=harness(async path=>response(path.endsWith('/session')?session():value));
    await assert.rejects(api.analyze(request({messages:[]})),error=>error.code==='INVALID_RESPONSE');
  }
});

test('chat replies stay bounded and reasoning, extra authority or invalid model identity is never returned', async () => {
  for(const value of [
    {...reply(),reply:'字'.repeat(3001)},{...reply(),reply:' '},{...reply(),reply:'bad\u0000reply'},
    {...reply(),reasoning_content:'PRIVATE_REASONING'},{...reply(),saved:true},
    {...reply(),model:'https://unexpected-model.example'},{...reply(),model:123}
  ]){
    const {api}=harness(async path=>response(path.endsWith('/session')?session():value));
    await assert.rejects(api.chat(request()),error=>error.code==='INVALID_RESPONSE'&&!error.message.includes('PRIVATE'));
  }
  const {api}=harness(async path=>response(path.endsWith('/session')?session():{...reply(),reply:'字'.repeat(3000)}));
  assert.equal((await api.chat(request())).reply.length,3000);
});

test('known error codes select fixed messages even when their payload carries secrets', async () => {
  const cliMessages=[];
  for(const code of ['WEREAD_CLI_UNAVAILABLE','WEREAD_NOT_CONFIGURED','DEEPSEEK_AUTH_FAILED','INVALID_HOST','__proto__','constructor']){
    const {api}=harness(async path=>response(path.endsWith('/session')?session():{error:{code,message:'PRIVATE_UPSTREAM TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE /private/account/token'}},path.endsWith('/session')?200:503));
    await assert.rejects(api.chat(request()),error=>{
      assert.doesNotMatch(error.message,/PRIVATE_UPSTREAM|TEST_ONLY_FAKE_CREDENTIAL|private\/account/);
      if(code.startsWith('WEREAD_'))cliMessages.push(error.message);
      if(['__proto__','constructor'].includes(code))assert.equal(error.code,'REQUEST_FAILED');
      return true;
    });
  }
  assert.notEqual(cliMessages[0],cliMessages[1]);
  assert.match(cliMessages[0],/安装|运行/);
  assert.match(cliMessages[1],/授权/);
});

test('network exception details are sanitized rather than shown as service messages', async () => {
  const {api,calls}=harness(async()=>{throw new Error('PRIVATE_UPSTREAM TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE /private/account/token');});
  await assert.rejects(api.chat(request()),error=>error.code==='NETWORK_ERROR'&&!/PRIVATE|TEST_ONLY_FAKE_CREDENTIAL/.test(error.message));
  assert.equal(calls.length,1);
});

test('already cancelled actions do no I/O and late success after cancellation is ignored', async () => {
  const controller=new AbortController();controller.abort();
  const first=harness(()=>assert.fail('already cancelled request must not fetch'));
  await assert.rejects(first.api.chat(request(),{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(first.calls.length,0);
  const lateController=new AbortController();let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const second=harness(async path=>path.endsWith('/session')?response(session()):new Promise(resolve=>{entered();release=()=>resolve(response(reply()));}));
  const pending=second.api.chat(request(),{signal:lateController.signal});
  const rejected=assert.rejects(pending,error=>error.name==='AbortError');
  await started;lateController.abort();release();await rejected;
  assert.equal(second.calls.length,2);
});

test('WeRead status preserves missing CLI versus missing authorization and strips diagnostics', async () => {
  const messages=[];
  for(const [installed,configured] of [[false,false],[true,false],[true,true]]){
    const value={provider:'weread',installed,configured,verified:false,contentAccess:'metadata-only',message:'PRIVATE_DIAGNOSTIC',apiKey:'PRIVATE_KEY',config_file:'/private/account'};
    const {api}=harness(async path=>response(path.endsWith('/session')?session():value));
    const result=await api.weread({action:'status'});
    assert.equal(result.installed,installed);assert.equal(result.configured,configured);assert.equal(result.verified,false);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private\/account/);messages.push(result.message);
  }
  assert.match(messages[0],/安装|运行/);assert.match(messages[1],/授权/);assert.match(messages[2],/尚未验证/);
});

test('WeRead status and shelf malformed successes cannot inject nulls into UI state', async () => {
  const statusBase={provider:'weread',installed:true,configured:true,verified:false,contentAccess:'metadata-only'};
  const shelfBase={books:[],total:0,nextCursor:null,pagination:'none',contentAccess:'metadata-only'};
  for(const [action,values] of [
    ['status',[null,{}, {...statusBase,installed:'yes'},{...statusBase,verified:true},{...statusBase,installed:false},{...statusBase,contentAccess:'full-body'}]],
    ['shelf',[null,{}, {...shelfBase,books:null},{...shelfBase,total:5},{...shelfBase,nextCursor:'more'},{...shelfBase,books:[null],total:1},{...shelfBase,books:[{bookId:'1',title:4,author:''}],total:1}]]
  ])for(const value of values){
    const {api}=harness(async path=>response(path.endsWith('/session')?session():value));
    await assert.rejects(api.weread({action}),error=>error.code==='INVALID_RESPONSE');
  }
});

test('WeRead import validates the selected book and chapter identities and only returns metadata', async () => {
  const book={id:'weread-123',bookId:'123',title:'一本书',author:'作者',source:'weread',format:'微信读书',contentStatus:'metadata-only',chapters:[{id:'weread-123-1',chapterUid:'1',title:'第一章',level:1,order:0,wordCount:123}],units:[],prelude:'',description:'简介',notice:'metadata only'};
  const {api,calls}=harness(async path=>response(path.endsWith('/session')?session():{book:{...book,apiKey:'PRIVATE_KEY',body:'PRIVATE_BODY',chapters:book.chapters.map(chapter=>({...chapter,text:'PRIVATE_BODY'}))}}));
  const result=await api.weread({action:'book',bookId:'123',apiKey:'PRIVATE_KEY',execPath:'/bin/sh'});
  assert.equal(result.book.title,book.title);assert.equal(result.book.chapters.length,1);
  assert.deepEqual(plain(result.book.units),[]);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|apiKey/);
  assert.deepEqual(JSON.parse(calls[1].options.body),{action:'book',bookId:'123'});
  for(const value of [
    null,{}, {book:{...book,bookId:'456'}},{book:{...book,contentStatus:'full'}},
    {book:{...book,units:[{text:'unexpected'}]}},{book:{...book,prelude:'unexpected body'}},
    {book:{...book,chapters:[null]}},{book:{...book,chapters:book.chapters.map(chapter=>({...chapter,id:'wrong-id'}))}},
    {book:{...book,chapters:book.chapters.map(chapter=>({...chapter,order:1}))}}
  ]){
    const h=harness(async path=>response(path.endsWith('/session')?session():value));
    await assert.rejects(h.api.weread({action:'book',bookId:'123'}),error=>error.code==='INVALID_RESPONSE');
  }
});

test('invalid WeRead actions, book identifiers and pagination are rejected before session access', async () => {
  for(const input of [null,{}, {action:'config'},{action:'book',bookId:'--help'},{action:'book',bookId:'1;whoami'},{action:'book',bookId:1},{action:'shelf',cursor:'next'}]){
    const {api,calls}=harness(()=>assert.fail('bad CLI request must not fetch'));
    await assert.rejects(api.weread(input));assert.equal(calls.length,0);
  }
});

test('guide and dailyGuide post their modes and validate their guide payloads', async () => {
  const guideResp = () => ({mode:'guide', provider:'deepseek', model:'deepseek-flash', guide:{intro:'开场',background:'背景',themes:['主题一','主题二'],questions:['问题一','问题二']}});
  const {api, calls} = harness(async path => response(path.endsWith('/session') ? session() : guideResp()));
  const guideBody = {book:{id:'book-test',title:'一本书',author:'作者'},chapter:{id:'guide-book-test',title:'全书导读资料',text:'序言与目录与摘要'}};
  const guideResult = await api.guide(guideBody);
  assert.equal(guideResult.guide.questions.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), {mode:'guide',book:guideBody.book,chapter:guideBody.chapter,messages:[]});
  const dailyResp = () => ({mode:'daily-guide', provider:'deepseek', model:'deepseek-flash', guide:{focus:'关注点',question:'引子'}});
  const h2 = harness(async path => response(path.endsWith('/session') ? session() : dailyResp()));
  const daily = await h2.api.dailyGuide({book:{id:'book-test',title:'一本书',author:''},chapter:{id:'reading-day-1',title:'第 1 天',text:'正文'}});
  assert.equal(daily.guide.focus, '关注点');
  const bad = harness(async path => response(path.endsWith('/session') ? session() : {mode:'guide',provider:'deepseek',model:'deepseek-flash',guide:{intro:'只有开头'}}));
  await assert.rejects(bad.api.guide(guideBody), error => error.code === 'INVALID_RESPONSE');
});

test('plan posts units, validates ordered 7-day coverage, and rejects malformed days', async () => {
  const ids = Array.from({length: 14}, (_, i) => `u${i + 1}`);
  const units = ids.map((id, i) => ({id, title:`单元 ${i + 1}`, level:1, wordCount:100, excerpt:`摘录 ${i + 1}`}));
  const daysResp = () => ({mode:'plan', provider:'deepseek', model:'deepseek-flash', days:Array.from({length:7}, (_, i) => ({unitIds:ids.slice(i*2,i*2+2), reason:`理由 ${i+1}`}))});
  const {api, calls} = harness(async path => response(path.endsWith('/session') ? session() : daysResp()));
  const result = await api.plan({book:{id:'book-test',title:'一本书',author:''}, units});
  assert.equal(result.days.length, 7);
  assert.deepEqual(result.days.flatMap(d => d.unitIds), ids);
  assert.deepEqual(JSON.parse(calls[1].options.body).units.map(u => u.id), ids);
  for (const bad of [
    {mode:'plan',provider:'deepseek',model:'deepseek-flash',days:Array.from({length:6}, (_, i) => ({unitIds:ids.slice(i*2,i*2+2), reason:'x'}))},
    {mode:'plan',provider:'deepseek',model:'deepseek-flash',days:Array.from({length:7}, (_, i) => ({unitIds:i===0?['u2','u3']:ids.slice(i*2,i*2+2), reason:'x'}))},
    {mode:'plan',provider:'deepseek',model:'deepseek-flash',days:Array.from({length:7}, (_, i) => ({unitIds:ids.slice(i*2,i*2+2), reason:'x', extra:1}))}
  ]) {
    const h = harness(async path => response(path.endsWith('/session') ? session() : bad));
    await assert.rejects(h.api.plan({book:{id:'book-test',title:'一本书',author:''}, units}), error => error.code === 'INVALID_RESPONSE');
  }
  const few = harness(() => assert.fail('too few units must not fetch'));
  await assert.rejects(few.api.plan({book:{id:'book-test',title:'一本书',author:''}, units:units.slice(0,6)}), error => error.code === 'PLAN_UNITS_INVALID');
});
