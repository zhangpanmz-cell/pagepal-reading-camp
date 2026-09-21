import test from 'node:test';
import assert from 'node:assert/strict';
import {runReadingAI, validateReadingRequest, READING_AI_LIMITS} from '../server/reading-ai.mjs';
import {PlannerError} from '../server/errors.mjs';

const fakeKey = 'TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE';
const config = {configured: true, apiKey: fakeKey, model: 'deepseek-flash'};
const chapterText = '阅读不是记住每一个字，而是找到值得继续思考的问题。\n一个观点成立，往往需要一定的条件。\n把阅读中的想法放回日常生活，观察它是否帮助了自己的选择。';
const input = (overrides = {}) => ({mode: 'topics', book: {id: 'book-1', title: '练习阅读', author: '示例作者'}, chapter: {id: 'chapter-1', title: '第一章', text: chapterText}, messages: [], ...overrides});
const chatInput = (overrides = {}) => input({mode: 'chat', messages: [{role: 'user', text: '这个观点什么时候可能不成立？'}], ...overrides});
const topics = () => ({topics: [
  {title: '找到问题', question: '怎样理解阅读与记忆的区别？', anchor: '找到值得继续思考的问题'},
  {title: '适用条件', question: '本章提到的条件可能有哪些？', anchor: '一个观点成立，往往需要一定的条件'},
  {title: '回到日常', question: '如果愿意，可以想想最近的一次选择。', anchor: '把阅读中的想法放回日常生活'}
]});
const completion = (value, patch = {}, finishReason = 'stop') => ({choices: [{finish_reason: finishReason, message: {role: 'assistant', content: JSON.stringify(value), ...patch}}]});
const response = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
const run = (body, envelope = completion(topics()), options = {}) => runReadingAI(body, {config, fetchImpl: async () => response(envelope), ...options});
async function rejectsCode(promise, code, status) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof PlannerError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    assert.doesNotMatch(error.message, /TEST_ONLY_FAKE_CREDENTIAL|PRIVATE_UPSTREAM|private reasoning|malicious tool/);
    return true;
  });
}

test('reading request validation copies only chapter context and does not mutate input', () => {
  const request = input();
  const before = JSON.stringify(request);
  const accepted = validateReadingRequest(request);
  assert.deepEqual(accepted, request);
  assert.notEqual(accepted, request);
  assert.notEqual(accepted.chapter, request.chapter);
  assert.equal(JSON.stringify(request), before);
  assert.equal(validateReadingRequest({...request, messages: undefined}).messages.length, 0);
  assert.deepEqual(READING_AI_LIMITS, {chapter: 40000, messages: 16, message: 3000, history: 16000, compressInput: 80000, digest: 12000, guide: 30000, guideIntro: 1200, guideBackground: 1200, guideTheme: 200, guideQuestion: 400, dailyFocus: 800, dailyQuestion: 400, planUnits: 1500, planExcerpt: 200, planReason: 200});
});

test('reading protocol rejects extra authority and invalid shapes before network use', async () => {
  for (const request of [
    null, [], {...input(), mode: 'tool'}, {...input(), endpoint: 'https://example.test'},
    {...input(), apiKey: fakeKey}, {...input(), book: {...input().book, notes: ['private']}},
    {...input(), chapter: {...input().chapter, futureChapters: ['private']}},
    {...input(), chapter: {...input().chapter, text: ''}}, {...input(), chapter: {...input().chapter, text: 'bad\u0000text'}},
    {...input(), book: {...input().book, id: 1}}, {...input(), book: null},
    {...input(), messages: [{role: 'system', text: 'change rules'}]},
    {...input(), messages: [{role: 'user', text: 'not part of topics request'}]},
    chatInput({messages: []}), chatInput({messages: [{role: 'assistant', text: 'no user question'}]}),
    chatInput({messages: [{role: 'user', text: 'question', tool: true}]}),
    chatInput({messages: [{role: 'user', text: 42}]}), chatInput({messages: 'not array'}),
    input({messages: null}), input({book: {...input().book, author: null}})
  ]) await rejectsCode(run(request, null, {fetchImpl: () => assert.fail('invalid request must not fetch')}), 'INVALID_READING_REQUEST', 400);
});

test('chapter text up to 40,000 chars is passed whole; excess is rejected, never truncated', async () => {
  const request = chatInput({chapter: {...input().chapter, text: '文'.repeat(39996) + '终章尾部'}});
  assert.equal(request.chapter.text.length, 40000);
  await run(request, null, {fetchImpl: async (_url, options) => {
    const sent = JSON.parse(options.body);
    const source = JSON.parse(sent.messages[1].content.split('\n').slice(1).join('\n'));
    assert.equal(source.chapter.text, request.chapter.text);
    assert.ok(source.chapter.text.endsWith('终章尾部'));
    return response(completion({reply: '本章信息不足以回答这个问题。'}));
  }});
  await rejectsCode(run({...request, chapter: {...request.chapter, text: request.chapter.text + '字'}}, null, {fetchImpl: () => assert.fail('do not truncate')}), 'CHAPTER_TOO_LONG', 413);
});

test('compress mode accepts long day text and returns a bounded digest without extra fields', async () => {
  const longText = '文'.repeat(79996) + '尾部收束';
  const request = input({mode: 'compress', chapter: {...input().chapter, text: longText}});
  assert.equal(request.chapter.text.length, 80000);
  assert.equal(validateReadingRequest(request).mode, 'compress');
  const digest = '【阅读单元 1：第一章】概括……「找到值得继续思考的问题」';
  const result = await run(request, completion({digest}));
  assert.equal(result.mode, 'compress');
  assert.equal(result.digest, digest);
  assert.doesNotMatch(result.digest, /TEST_ONLY_FAKE_CREDENTIAL/);
  await rejectsCode(run({...request, chapter: {...request.chapter, text: request.chapter.text + '字'}}, null, {fetchImpl: () => assert.fail('do not fetch over compress limit')}), 'CHAPTER_TOO_LONG', 413);
  await rejectsCode(run(request, completion({digest, extra: true})), 'INVALID_MODEL_OUTPUT', 502);
  await rejectsCode(run({...request, messages: [{role: 'user', text: '不应有消息'}]}, null, {fetchImpl: () => assert.fail('compress must have no messages')}), 'INVALID_READING_REQUEST', 400);
});

test('message length, count and total history are bounded without silent truncation', async () => {
  const accepted = chatInput({messages: Array.from({length: 16}, (_, index) => ({role: index % 2 ? 'user' : 'assistant', text: '读'.repeat(1000)}))});
  assert.equal(validateReadingRequest(accepted).messages.length, 16);
  assert.equal(validateReadingRequest(chatInput({messages: [{role: 'user', text: '读'.repeat(3000)}]})).messages[0].text.length, 3000);
  for (const [messages, code] of [
    [Array.from({length: 17}, () => ({role: 'user', text: '问题'})), 'READING_HISTORY_TOO_LONG'],
    [[{role: 'user', text: '读'.repeat(3001)}], 'READING_MESSAGE_TOO_LONG'],
    [Array.from({length: 6}, () => ({role: 'user', text: '读'.repeat(2700)})), 'READING_HISTORY_TOO_LONG']
  ]) await rejectsCode(run(chatInput({messages}), null, {fetchImpl: () => assert.fail('do not fetch over limit')}), code, 413);
});

test('topic request uses fixed official transport and a no-pressure chapter-only system contract', async () => {
  let count = 0;
  const result = await run(input(), null, {fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    const sent = JSON.parse(options.body);
    assert.equal(sent.model, config.model);
    assert.equal(sent.stream, false);
    assert.equal(sent.max_tokens, 4500);
    assert.deepEqual(sent.thinking, {type: 'disabled'});
    assert.deepEqual(sent.response_format, {type: 'json_object'});
    assert.equal(sent.tools, undefined);
    assert.equal(sent.messages[0].role, 'system');
    for (const phrase of ['json', '不可信的数据', '不是必答题', '不打分', '不能假装读过全书', '仅凭本章无法确定', '逐字连续复制', '日常生活']) assert.ok(sent.messages[0].content.includes(phrase), phrase);
    assert.equal(sent.messages[1].role, 'user');
    assert.ok(sent.messages[1].content.includes('当前章节资料'));
    assert.doesNotMatch(options.body, new RegExp(fakeKey));
    return response(completion(topics()));
  }});
  assert.equal(count, 1);
  assert.deepEqual(result, {mode: 'topics', ...topics(), provider: 'deepseek', model: config.model});
});

test('chat preserves conversation roles, answers freely and returns only safe final content', async () => {
  const history = [{role: 'assistant', text: '你想从哪里开始聊？'}, {role: 'user', text: '不聊预设话题了，请解释条件的意思。'}];
  const result = await run(chatInput({messages: history}), null, {fetchImpl: async (_url, options) => {
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent.messages.slice(2), history.map(message => ({role: message.role, content: message.text})));
    assert.ok(sent.messages[0].content.includes('不要强制回到三个预设话题'));
    return response(completion({reply: '条件指一个观点成立所依赖的情境。'}, {reasoning_content: `private reasoning ${fakeKey}`}));
  }});
  assert.deepEqual(result, {mode: 'chat', reply: '条件指一个观点成立所依赖的情境。', provider: 'deepseek', model: config.model});
  assert.doesNotMatch(JSON.stringify(result), /reasoning_content|private reasoning|TEST_ONLY_FAKE_CREDENTIAL/);
});

test('topics need exactly three distinct topics and literal source anchors', async () => {
  for (const output of [
    {topics: topics().topics.slice(0, 2)}, {topics: [...topics().topics, topics().topics[0]]},
    {topics: [topics().topics[0], topics().topics[0], topics().topics[2]]},
    {topics: topics().topics.map((topic, i) => i ? topic : {...topic, anchor: '本章没有说过的内容'})},
    {topics: topics().topics.map((topic, i) => i ? topic : {...topic, anchor: '阅读不是……问题'})},
    {topics: topics().topics.map((topic, i) => i ? topic : {...topic, title: ''})},
    {topics: topics().topics.map((topic, i) => i ? topic : {...topic, question: '长'.repeat(401)})},
    {topics: topics().topics.map((topic, i) => i ? topic : {...topic, href: 'https://example.test'})},
    {...topics(), reply: 'unasked extra field'}, {topics: 'not a list'}, null, []
  ]) await rejectsCode(run(input(), completion(output)), 'INVALID_MODEL_OUTPUT', 502);
});

test('chat requires a bounded nonempty reply and forbids extra model fields', async () => {
  for (const output of [null, [], {}, {reply: ''}, {reply: 2}, {reply: '文'.repeat(3001)}, {reply: 'ok', score: 100}, {reply: 'ok', tools: []}, {reply: 'bad\u0000text'}]) {
    await rejectsCode(run(chatInput(), completion(output)), 'INVALID_MODEL_OUTPUT', 502);
  }
});

test('even a successful model response cannot echo the configured server secret', async () => {
  await rejectsCode(run(chatInput(), completion({reply: `Do not reveal ${fakeKey}`})), 'INVALID_MODEL_OUTPUT', 502);
});

test('truncation, tool calls, reasoning-only replies and malformed envelopes are not accepted', async () => {
  for (const [envelope, expected] of [
    [completion(topics(), {}, 'length'), 'INCOMPLETE_RESPONSE'],
    [completion(topics(), {}, 'aborted'), 'INCOMPLETE_RESPONSE'],
    [completion(topics(), {}, 'tool_calls'), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {tool_calls: [{name: 'malicious tool'}]}), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {tool_calls: {name: 'malicious tool'}}), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {function_call: {name: 'malicious tool'}}), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {content: '', reasoning_content: 'private reasoning'}), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {content: null, reasoning_content: JSON.stringify(topics())}), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {content: '```json\n{}\n```'}), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {content: '{broken'}), 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {role: 'tool'}), 'INVALID_MODEL_OUTPUT'],
    [{choices: []}, 'INVALID_MODEL_OUTPUT'], [{choices: [null]}, 'INVALID_MODEL_OUTPUT'],
    [{choices: [completion(topics()).choices[0], completion(topics()).choices[0]]}, 'INVALID_MODEL_OUTPUT'],
    [completion(topics(), {refusal: 'PRIVATE_UPSTREAM'}), 'MODEL_REFUSAL'],
    [completion(topics(), {}, 'content_filter'), 'MODEL_REFUSAL']
  ]) await rejectsCode(run(input(), envelope), expected);
});

for (const [upstreamStatus, expectedStatus, code] of [[400, 503, 'DEEPSEEK_MODEL_UNAVAILABLE'], [401, 503, 'DEEPSEEK_AUTH_FAILED'], [402, 402, 'DEEPSEEK_BALANCE_INSUFFICIENT'], [403, 503, 'DEEPSEEK_ACCESS_DENIED'], [404, 503, 'DEEPSEEK_MODEL_UNAVAILABLE'], [422, 503, 'DEEPSEEK_MODEL_UNAVAILABLE'], [429, 429, 'DEEPSEEK_RATE_LIMITED'], [503, 502, 'DEEPSEEK_UNAVAILABLE']]) {
  test(`reading upstream ${upstreamStatus} maps safely, cancels body, and does not retry`, async () => {
    let count = 0, didCancel = false;
    await rejectsCode(run(input(), null, {fetchImpl: async () => {
      count++;
      return new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode(`PRIVATE_UPSTREAM ${fakeKey}`)); }, cancel() { didCancel = true; }}), {status: upstreamStatus});
    }}), code, expectedStatus);
    assert.equal(count, 1);
    assert.equal(didCancel, true);
  });
}

test('configuration must be supplied and no real credential source is inspected', async () => {
  for (const supplied of [undefined, {configured: false}, {...config, apiKey: ''}, {...config, apiKey: 'your_api_key'}]) {
    await rejectsCode(run(input(), null, {config: supplied, fetchImpl: () => assert.fail('no configured key')}), 'DEEPSEEK_NOT_CONFIGURED', 503);
  }
  for (const supplied of [{...config, model: 'https://model.invalid'}, {...config, apiKey: `${fakeKey}\r\nextra`}]) {
    await rejectsCode(run(input(), null, {config: supplied, fetchImpl: () => assert.fail('bad config')}), 'CONFIG_ERROR', 503);
  }
});

test('transport errors have fixed safe text and no retries', async () => {
  let count = 0;
  await rejectsCode(run(input(), null, {fetchImpl: async () => {count++; throw new Error(`PRIVATE_UPSTREAM ${fakeKey}`);}}), 'DEEPSEEK_NETWORK_ERROR', 502);
  assert.equal(count, 1);
});

test('oversized upstream content-length or streamed bytes is cancelled and rejected', async () => {
  for (const includeHeader of [true, false]) {
    let didCancel = false;
    const upstream = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(262145)); },
      cancel() { didCancel = true; }
    }), {headers: includeHeader ? {'Content-Length': '262145'} : {}});
    await rejectsCode(run(input(), null, {fetchImpl: async () => upstream}), 'INVALID_MODEL_OUTPUT', 502);
    assert.equal(didCancel, true);
  }
});

test('invalid upstream JSON and invalid UTF-8 fail closed', async () => {
  for (const body of ['{not-json', new Uint8Array([0xc0, 0xaf]), 'null']) {
    await rejectsCode(run(input(), null, {fetchImpl: async () => new Response(body)}), 'INVALID_MODEL_OUTPUT', 502);
  }
  await rejectsCode(run(input(), null, {fetchImpl: async () => new Response(null)}), 'INVALID_MODEL_OUTPUT', 502);
});

test('a pre-cancelled request is rejected without contacting upstream', async () => {
  const controller = new AbortController(); controller.abort();
  await rejectsCode(run(input(), null, {signal: controller.signal, fetchImpl: () => assert.fail('already aborted')}), 'REQUEST_CANCELLED', 499);
});

test('fetch cancellation uses the caller signal and does not expose abort reasons', async () => {
  const controller = new AbortController();
  let began;
  const started = new Promise(resolve => { began = resolve; });
  const pending = run(input(), null, {signal: controller.signal, fetchImpl: async (_url, {signal}) => {
    assert.equal(signal, controller.signal); began();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException(`PRIVATE_UPSTREAM ${fakeKey}`, 'AbortError')), {once: true}));
  }});
  const assertion = rejectsCode(pending, 'REQUEST_CANCELLED', 499);
  await started; controller.abort(); await assertion;
});

test('cancellation also releases a stalled upstream response stream', async () => {
  const controller = new AbortController();
  let readBegan, didCancel = false;
  const started = new Promise(resolve => { readBegan = resolve; });
  const pending = run(input(), null, {signal: controller.signal, fetchImpl: async () => new Response(new ReadableStream({
    pull() { readBegan(); }, cancel() { didCancel = true; }
  }))});
  const assertion = rejectsCode(pending, 'REQUEST_CANCELLED', 499);
  await started;
  // The response reader is installed in a microtask after fetch resolves.
  await Promise.resolve();
  controller.abort(); await assertion;
  assert.equal(didCancel, true);
});

// —— 第 3 阶段：全书导读 / 每日导读 / AI 语义拆分 ——
const guideInput = (overrides = {}) => input({mode: 'guide', messages: [], chapter: {id: 'guide-book-1', title: '全书导读资料', text: '序言：这是一本关于专注的书。\n目录：第一章 注意力\n正文摘要：注意力需要停留的地方。'}, ...overrides});
const dailyGuideInput = (overrides = {}) => input({mode: 'daily-guide', messages: [], chapter: {id: 'reading-day-1', title: '第 1 天 · 完整阅读范围', text: '【第一章】\n阅读帮助我们发现问题。'}, ...overrides});
const guide = () => ({guide: {intro: '这是一本温柔的小书。', background: '源于对日常专注的观察。', themes: ['注意力', '边界'], questions: ['你最想留住哪段自己的时间？', '什么是你愿意继续的小事？']}});
const dailyGuide = () => ({guide: {focus: '留意作者如何区分忙碌与专注。', question: '如果愿意，可以想想自己最近一次真正专注的时刻。'}});
const planUnits = () => Array.from({length: 14}, (_, i) => ({id: `u${i + 1}`, title: `单元 ${i + 1}`, level: 1, wordCount: 100 + i, excerpt: `摘录 ${i + 1}`}));
const planInput = (overrides = {}) => ({mode: 'plan', book: {id: 'book-1', title: '一本书', author: '作者'}, units: planUnits(), ...overrides});
const planDays = () => ({days: [
  {unitIds: ['u1', 'u2'], reason: '开篇主题'},
  {unitIds: ['u3', 'u4'], reason: '主题连贯'},
  {unitIds: ['u5', 'u6'], reason: '主题连贯'},
  {unitIds: ['u7', 'u8'], reason: '主题连贯'},
  {unitIds: ['u9', 'u10'], reason: '主题连贯'},
  {unitIds: ['u11', 'u12'], reason: '主题连贯'},
  {unitIds: ['u13', 'u14'], reason: '收束'}
]});
const runAny = (body, envelope, options = {}) => runReadingAI(body, {config, fetchImpl: async () => response(envelope), ...options});

test('guide mode accepts bounded source, returns 1-3 themes and 1-3 questions', async () => {
  const result = await runAny(guideInput(), completion(guide()));
  assert.deepEqual(result, {mode: 'guide', ...guide(), provider: 'deepseek', model: config.model});
});

test('guide mode rejects messages and malformed or over-sized output', async () => {
  await rejectsCode(runAny({...guideInput(), messages: [{role: 'user', text: '不应有消息'}]}, null, {fetchImpl: () => assert.fail('guide must have no messages')}), 'INVALID_READING_REQUEST', 400);
  for (const output of [
    null, {}, {guide: {intro: 'x'}}, {guide: {...guide().guide, themes: []}}, {guide: {...guide().guide, themes: ['a', 'b', 'c', 'd']}},
    {guide: {...guide().guide, questions: []}}, {guide: {...guide().guide, questions: ['a', 'b', 'c', 'd']}},
    {guide: {...guide().guide, themes: ['重复', '重复']}}, {guide: {...guide().guide, intro: '文'.repeat(1201)}},
    {guide: {...guide().guide, extra: true}}, {...guide(), reply: 'unasked'}, {guide: 'not object'}
  ]) await rejectsCode(runAny(guideInput(), completion(output)), 'INVALID_MODEL_OUTPUT', 502);
});

test('guide input over 30,000 chars is rejected, never truncated', async () => {
  await rejectsCode(runAny(guideInput({chapter: {...guideInput().chapter, text: '文'.repeat(30001)}}), null, {fetchImpl: () => assert.fail('do not truncate guide')}), 'CHAPTER_TOO_LONG', 413);
});

test('daily-guide returns a bounded focus and question only', async () => {
  const result = await runAny(dailyGuideInput(), completion(dailyGuide()));
  assert.deepEqual(result, {mode: 'daily-guide', ...dailyGuide(), provider: 'deepseek', model: config.model});
  await rejectsCode(runAny({...dailyGuideInput(), messages: [{role: 'user', text: 'x'}]}, null, {fetchImpl: () => assert.fail('no messages')}), 'INVALID_READING_REQUEST', 400);
  for (const output of [null, {}, {guide: {focus: ''}}, {guide: {focus: 'x', question: 'y', extra: 1}}, {guide: {focus: 'x'}}, {guide: {focus: 'x', question: '文'.repeat(401)}}, {...dailyGuide(), topics: []}]) {
    await rejectsCode(runAny(dailyGuideInput(), completion(output)), 'INVALID_MODEL_OUTPUT', 502);
  }
});

test('plan mode validates unit list and sends units (not chapter) to a fixed transport', async () => {
  const result = await runAny(planInput(), null, {fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const sent = JSON.parse(options.body);
    assert.equal(sent.max_tokens, 8192);
    assert.ok(sent.messages[1].content.includes('当前单元列表'));
    const source = JSON.parse(sent.messages[1].content.split('\n').slice(1).join('\n'));
    assert.deepEqual(source.units.map(u => u.id), planUnits().map(u => u.id));
    assert.ok(sent.messages[2].content.includes('七日'));
    return response(completion(planDays()));
  }});
  assert.deepEqual(result, {mode: 'plan', ...planDays(), provider: 'deepseek', model: config.model});
});

test('plan mode rejects non-7 groups, gaps, repeats, reorder and invented ids', async () => {
  const good = planDays().days;
  for (const days of [
    good.slice(0, 6), good.concat([{unitIds: ['u15'], reason: '多余'}]),
    good.map((d, i) => i === 0 ? {...d, unitIds: []} : d),
    good.map((d, i) => i === 0 ? {...d, unitIds: ['u2', 'u3']} : d),
    good.map((d, i) => i === 6 ? {...d, unitIds: ['u13']} : d),
    good.map((d, i) => i === 3 ? {...d, unitIds: ['u9', 'u8']} : d),
    good.map((d, i) => i === 0 ? {...d, unitIds: ['u1', 'u2'], reason: ''} : d),
    good.map((d, i) => i === 0 ? {...d, unitIds: ['u1', 'u2'], extra: 1} : d)
  ]) await rejectsCode(runAny(planInput(), completion({days})), 'INVALID_MODEL_OUTPUT', 502);
});

test('plan mode rejects invalid unit lists before network use', async () => {
  for (const request of [
    planInput({units: [...planUnits(), planUnits()[0]]}),
    planInput({units: planUnits().map(u => ({...u, id: ''}))}),
    planInput({units: planUnits().map(u => ({...u, level: 7}))}),
    planInput({units: planUnits().map(u => ({...u, wordCount: -1}))}),
    planInput({units: planUnits().map(u => ({...u, excerpt: '文'.repeat(201)}))}),
    {...planInput(), chapter: {id: 'c', title: 't', text: 'x'}}, {...planInput(), messages: []}
  ]) await rejectsCode(runAny(request, null, {fetchImpl: () => assert.fail('invalid plan must not fetch')}), 'INVALID_READING_REQUEST', 400);
  await rejectsCode(runAny(planInput({units: planUnits().slice(0, 6)}), null, {fetchImpl: () => assert.fail('too few units')}), 'PLAN_UNITS_INVALID', 413);
  await rejectsCode(runAny(planInput({units: Array.from({length: 1501}, (_, i) => ({id: `u${i}`, title: `t${i}`, excerpt: ''}))}), null, {fetchImpl: () => assert.fail('too many units')}), 'PLAN_UNITS_INVALID', 413);
});
