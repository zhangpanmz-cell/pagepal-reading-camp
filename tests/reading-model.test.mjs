import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({window: {}, Intl, Date});
vm.runInContext(readFileSync(new URL('../reading-model.js', import.meta.url), 'utf8'), context);
const model = context.ReadingModel;
const units = Array.from({length: 14}, (_, i) => ({
  id: `unit-${i + 1}`, title: `章节 ${i + 1}`, text: `段落${'读'.repeat(98)}\n\n完整段落${'书'.repeat(96)}`,
  theme: `主题 ${Math.floor(i / 2) + 1}`, intro: `导读 ${i + 1}`, question: `问题 ${i + 1}？`
}));
const book = {id: 'book-one', title: '慢慢读', author: '作者', units};
const camp = () => ({...model.createCamp(book, '2026-09-13'), onboarded: true});
const onDayOne = () => new Date('2026-09-13T10:00:00+08:00');
const noteText = '读'.repeat(400);
const plain = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  Object.freeze(value);
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object') freeze(nested);
  return value;
}

test('browser and global API match; Unicode letters/numbers count, punctuation does not', () => {
  assert.equal(context.window.ReadingModel, model);
  assert.equal(model.countWords('中文， A 9！\n\t😀'), 4);
  assert.equal(model.countWords('é e\u0301 𐐀 𝟠'), 4);
  assert.equal(model.countWords('，。！？ — … 😀\n\t'), 0);
  assert.equal(model.countWords(''), 0);
  assert.throws(() => model.countWords(null), /文字/);
});

test('image markers inside text never count toward valid character totals', () => {
  assert.equal(model.countWords('正文[[IMG:data:image/jpeg;base64,AAA111BBB222]]结束'), 4);
  assert.equal(model.countWords('[[IMG:data:image/png;base64,/9j/4AAQ]]'), 0);
});

test('daily discussion context excludes inline image markers', () => {
  const book2 = {id: 'b2', title: '图文书', author: '作者', units: [
    {id: 'u1', title: '第一章', text: '正文一[[IMG:data:image/jpeg;base64,AAAA]]结束'},
    {id: 'u2', title: '第二章', text: '正文二'}
  ]};
  const context = model.dailyDiscussionContext(book2, {day: 1, unitIds: ['u1', 'u2']});
  assert.doesNotMatch(context.text, /\[\[IMG:/);
  assert.match(context.text, /正文一/);
  assert.match(context.text, /正文二/);
});

test('daily discussion context uses section titles instead of internal unit numbers', () => {
  const book2 = {id: 'b3', title: '标题书', author: '作者', units: [
    {id: 'u1', title: '家族秘史', text: '正文一'},
    {id: 'u2', title: '思考的代价', text: '正文二'}
  ]};
  const context = model.dailyDiscussionContext(book2, {day: 1, unitIds: ['u1', 'u2']});
  assert.match(context.text, /【家族秘史】/);
  assert.doesNotMatch(context.text, /阅读单元/);
});

test('partition keeps exactly seven contiguous nonempty groups, unit and paragraph integrity', () => {
  const input = freeze(plain(units));
  const snapshot = JSON.stringify(input);
  const days = model.splitUnits(input);
  assert.equal(days.length, 7);
  assert.deepEqual(plain(days.map(day => day.day)), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(plain(days.flatMap(day => day.unitIds)), units.map(unit => unit.id));
  assert.ok(days.every(day => day.unitIds.length === 2));
  assert.equal(days.reduce((sum, day) => sum + day.wordCount, 0), units.reduce((sum, unit) => sum + model.countWords(unit.text), 0));
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(days[0].intro, '导读 1');
  assert.equal(days[0].question, '问题 2？');
  assert.equal(days[0].readMinutes, Math.ceil(days[0].wordCount / 400));
});

test('partition balances varied weights and prefers theme boundaries when practical', () => {
  const varied = Array.from({length: 21}, (_, i) => ({
    id: String(i), title: '完整单元', text: '文'.repeat([10, 25, 65][i % 3]), theme: `主题${Math.floor(i / 3)}`
  }));
  const days = model.splitUnits(varied);
  assert.deepEqual(plain(days.map(day => day.wordCount)), Array(7).fill(100));
  assert.ok(days.every(day => day.unitIds.length === 3));
  const single = model.splitUnits(varied.slice(0, 7));
  assert.ok(single.every(day => day.unitIds.length === 1));
});

test('partition rejects missing/duplicate/empty/malformed units and unsupported count', () => {
  assert.throws(() => model.splitUnits(units.slice(0, 6)), /至少需要 7/);
  assert.throws(() => model.splitUnits(null), /单元列表/);
  assert.throws(() => model.splitUnits(units, 6), /固定安排 7/);
  assert.throws(() => model.splitUnits([{...units[0], id: units[1].id}, ...units.slice(1)]), /编号重复/);
  assert.throws(() => model.splitUnits([{...units[0], text: '。😀'}, ...units.slice(1)]), /没有可阅读/);
  assert.throws(() => model.splitUnits([{...units[0], title: ''}, ...units.slice(1)]), /缺少有效/);
  assert.throws(() => model.splitUnits([{...units[0], theme: {}}, ...units.slice(1)]), /theme/);
});

test('1500-unit supported ceiling remains bounded and retains all input units', () => {
  const many = Array.from({length: 1500}, (_, i) => ({id: `u-${i}`, title: '段落', text: '文'}));
  const days = model.splitUnits(many);
  assert.equal(days.length, 7);
  assert.deepEqual(plain(days.flatMap(day => day.unitIds)), many.map(unit => unit.id));
  assert.ok(Math.max(...days.map(day => day.wordCount)) - Math.min(...days.map(day => day.wordCount)) <= 1);
  assert.throws(() => model.splitUnits([...many, {id: 'last', title: '段落', text: '文'}]), /最多支持 1500/);
});

test('hierarchical units split by chapter without breaking a chapter across days', () => {
  const units = [];
  for (let i = 1; i <= 10; i += 1) {
    const chapter = `第${i}章`;
    units.push({id: `c${i}`, title: chapter, text: '章首'.repeat(50), level: 2, part: '第一部分', chapter});
    units.push({id: `s${i}a`, title: `${chapter}·小节一`, text: '读'.repeat(300), level: 3, part: '第一部分', chapter});
    units.push({id: `s${i}b`, title: `${chapter}·小节二`, text: '读'.repeat(300), level: 3, part: '第一部分', chapter});
  }
  const days = model.splitUnits(units);
  assert.equal(days.length, 7);
  assert.deepEqual(plain(days.flatMap(day => day.unitIds)), units.map(unit => unit.id));
  const seen = new Set();
  for (const day of days) for (const chapter of day.chapters) { assert.ok(!seen.has(chapter.title), `${chapter.title} 被拆到了多天`); seen.add(chapter.title); }
  assert.equal(seen.size, 10);
  assert.match(days[0].title, /第/);
});

test('creation initializes isolated camp data, preserving supplied timezone and demo mode', () => {
  const first = model.createCamp(book, '2026-09-13', {demo: true, timezone: 'UTC'});
  const second = model.createCamp(book, '2026-09-13');
  assert.notEqual(first.id, second.id);
  assert.equal(first.bookId, book.id);
  assert.equal(first.demo, true);
  assert.equal(first.onboarded, false);
  assert.equal(first.scheduleVersion, 'seven-day');
  assert.equal(first.timezone, 'UTC');
  assert.deepEqual(plain(first.notes), {});
  assert.deepEqual(plain(first.drafts), {});
  assert.notEqual(first.notes, second.notes);
  assert.throws(() => model.createCamp({}, '2026-09-13'), /书籍/);
  assert.throws(() => model.createCamp(book, '2026-02-29'), /日期不存在/);
  assert.throws(() => model.createCamp(book, '2026-9-13'), /格式/);
  assert.throws(() => model.createCamp(book, '2026-09-13', {timezone: 'Moon/Nowhere'}), /时区无效/);
  assert.throws(() => model.createCamp(book, '2026-09-13', {demo: 'true'}), /演示模式/);
});

test('seven-day rule: day 1 is startDate (D1) and day 7 is startDate + 6, no day 0', () => {
  const current = camp();
  assert.equal(model.dayDate(current, 1), '2026-09-13');
  assert.equal(model.dayDate(current, 7), '2026-09-19');
  assert.equal(model.dayDate({...current, startDate: '2028-02-28'}, 7), '2028-03-05');
  assert.equal(model.dayDate({...current, startDate: '2026-12-28'}, 7), '2027-01-03');
  for (const invalid of [0, 8, -1, 9, 1.5, '1']) assert.throws(() => model.dayDate(current, invalid), /整数/);
});

test('legacy opening-day camps keep the original eight-day arithmetic without migration', () => {
  const legacy = {...camp(), scheduleVersion: 'opening-day'};
  assert.equal(model.dayDate(legacy, 0), '2026-09-13');
  assert.equal(model.dayDate(legacy, 1), '2026-09-14');
  assert.equal(model.dayDate(legacy, 7), '2026-09-20');
  assert.equal(model.dayDate(legacy, 8), '2026-09-21');
  assert.equal(model.dayDate({...camp(), scheduleVersion: undefined}, 1), '2026-09-14');
  assert.throws(() => model.dayDate({...camp(), scheduleVersion: 'unknown'}, 1), /版本/);
});

test('state changes exactly at local midnight and supports timezones across DST', () => {
  const current = camp();
  assert.equal(model.stateForDay(current, 1, new Date('2026-09-12T15:59:59.999Z')), 'future');
  assert.equal(model.stateForDay(current, 1, new Date('2026-09-12T16:00:00.000Z')), 'open');
  assert.equal(model.stateForDay(current, 1, new Date('2026-09-13T15:59:59.999Z')), 'open');
  assert.equal(model.stateForDay(current, 1, new Date('2026-09-13T16:00:00.000Z')), 'missed');
  const dst = {...model.createCamp(book, '2026-03-08', {timezone: 'America/New_York'}), onboarded: true};
  assert.equal(model.dayDate(dst, 1), '2026-03-08');
  assert.equal(model.stateForDay(dst, 1, new Date('2026-03-08T04:59:59Z')), 'future');
  assert.equal(model.stateForDay(dst, 1, new Date('2026-03-08T05:00:00Z')), 'open');
  assert.equal(model.stateForDay(dst, 1, new Date('2026-03-09T04:00:00Z')), 'missed');
});

test('399 valid characters fail, 400 pass, spaces/punctuation never meet threshold', () => {
  const current = camp();
  assert.throws(() => model.commitNote(current, 1, '读'.repeat(399) + '，。 \n😀', onDayOne()), /当前为 399/);
  const updated = model.commitNote(current, 1, '读'.repeat(399) + '9，\n ', onDayOne());
  assert.equal(updated.notes['1'].count, 400);
  assert.equal(updated.notes['1'].status, 'done');
  assert.equal(updated.notes['1'].text, '读'.repeat(399) + '9，\n ');
  assert.equal(updated.notes['1'].submittedAt, '2026-09-13T02:00:00.000Z');
  assert.deepEqual(plain(current.notes), {});
});

test('draft saves never submit and submission immutably clears only the same draft', () => {
  const original = freeze(camp());
  const firstDraft = model.saveDraft(original, 1, noteText);
  const secondDraft = model.saveDraft(firstDraft, 2, '另一天的草稿');
  assert.deepEqual(plain(secondDraft.notes), {});
  assert.equal(model.stateForDay(secondDraft, 1, onDayOne()), 'open');
  freeze(secondDraft);
  const submitted = model.commitNote(secondDraft, 1, noteText, onDayOne());
  assert.equal(submitted.drafts['1'], undefined);
  assert.equal(submitted.drafts['2'], '另一天的草稿');
  assert.equal(secondDraft.drafts['1'], noteText);
  assert.equal(submitted.notes['1'].count, 400);
  const later = model.commitNote(freeze(submitted), 2, '二'.repeat(400), new Date('2026-09-14T10:00:00+08:00'));
  assert.equal(later.notes['1'], submitted.notes['1']);
  assert.equal(later.notes['2'].status, 'done');
  assert.equal(Object.keys(submitted.notes).length, 1);
});

test('unopened camps, early submission, duplicate submission, invalid day and invalid time fail', () => {
  const current = camp();
  assert.throws(() => model.commitNote({...current, onboarded: false}, 1, noteText, onDayOne()), /先开始阅读/);
  assert.throws(() => model.commitNote(current, 2, noteText, onDayOne()), /尚未开放/);
  assert.throws(() => model.commitNote(current, 0, noteText, onDayOne()), /1 至 7/);
  assert.throws(() => model.commitNote(current, 8, noteText, onDayOne()), /1 至 7/);
  assert.throws(() => model.commitNote(current, 1, noteText, new Date('invalid')), /时间无效/);
  const submitted = model.commitNote(current, 1, noteText, onDayOne());
  assert.throws(() => model.commitNote(submitted, 1, '改'.repeat(400), new Date('2026-09-18T10:00:00+08:00')), /不能重复提交/);
  assert.throws(() => model.saveDraft(submitted, 1, '新草稿'), /已提交/);
  assert.equal(submitted.notes['1'].text, noteText);
});

test('late work stays late forever and on-time submissions stay done after the deadline', () => {
  const current = camp();
  const late = model.commitNote(current, 1, noteText, new Date('2026-09-15T00:00:00+08:00'));
  assert.equal(late.notes['1'].status, 'late');
  assert.equal(model.stateForDay(late, 1, new Date('2026-10-20T00:00:00+08:00')), 'late');
  assert.equal(model.stateForDay(late, 1, onDayOne()), 'late');
  assert.throws(() => model.commitNote(late, 1, noteText, onDayOne()), /不能重复提交/);
  const done = model.commitNote(current, 1, noteText, onDayOne());
  assert.equal(model.stateForDay(done, 1, new Date('2026-10-20T00:00:00+08:00')), 'done');
});

test('editing a submitted note keeps original submittedAt/status and records the edit', () => {
  const submitted = model.commitNote(camp(), 1, noteText, onDayOne());
  assert.equal(submitted.notes['1'].submittedAt, '2026-09-13T02:00:00.000Z');
  assert.equal(submitted.notes['1'].status, 'done');
  assert.equal(submitted.notes['1'].editCount, undefined);
  const edited = model.editNote(submitted, 1, '编'.repeat(500), new Date('2026-09-16T10:00:00+08:00'));
  assert.equal(edited.notes['1'].text, '编'.repeat(500));
  assert.equal(edited.notes['1'].count, 500);
  assert.equal(edited.notes['1'].submittedAt, '2026-09-13T02:00:00.000Z');
  assert.equal(edited.notes['1'].status, 'done');
  assert.equal(edited.notes['1'].editedAt, '2026-09-16T02:00:00.000Z');
  assert.equal(edited.notes['1'].editCount, 1);
  const twice = model.editNote(edited, 1, '又'.repeat(401), new Date('2026-09-17T10:00:00+08:00'));
  assert.equal(twice.notes['1'].editCount, 2);
  assert.equal(twice.notes['1'].status, 'done');
});

test('editing a late note keeps late forever, and edit rejects unsubmitted days or short text', () => {
  const late = model.commitNote(camp(), 1, noteText, new Date('2026-09-15T00:00:00+08:00'));
  assert.equal(late.notes['1'].status, 'late');
  const edited = model.editNote(late, 1, '改'.repeat(400), onDayOne());
  assert.equal(edited.notes['1'].status, 'late');
  assert.throws(() => model.editNote(camp(), 1, '改'.repeat(400), onDayOne()), /尚未提交/);
  assert.throws(() => model.editNote(late, 1, '短'.repeat(399), onDayOne()), /仍需至少 400/);
  assert.throws(() => model.editNote(late, 0, '改'.repeat(400), onDayOne()), /1 至 7/);
});

test('malformed camp and note data are rejected rather than credited', () => {
  const current = camp();
  assert.throws(() => model.stateForDay(null, 1), /阅读营数据/);
  assert.throws(() => model.stateForDay({...current, days: current.days.slice(1)}, 1), /7 天/);
  assert.throws(() => model.saveDraft({...current, drafts: []}, 1, '文'), /草稿数据/);
  assert.throws(() => model.saveDraft(current, 1, {}), /草稿必须是文字/);
  assert.throws(() => model.stateForDay({...current, notes: {'1': {text: '伪造', status: 'done', count: 400, submittedAt: onDayOne().toISOString()}}}, 1), /已提交笔记数据/);
  assert.throws(() => model.stateForDay({...current, notes: {'8': {}}}, 1), /已提交笔记数据/);
  assert.throws(() => model.stateForDay({...current, notes: {'1': {text: noteText, status: 'done', count: 400, submittedAt: onDayOne().toISOString(), editCount: 0}}}, 1), /编辑次数/);
  assert.throws(() => model.stateForDay({...current, scheduleVersion: 'unknown'}, 1), /版本/);
});

test('Markdown exports only submitted current-camp notes with book/chapter metadata and honest labels', () => {
  const current = model.commitNote(camp(), 1, noteText, onDayOne());
  const withDraft = model.saveDraft(current, 2, '不应该导出的草稿');
  const sampleBook = {...book, source: 'sample', format: 'DEMO', notice: '原创演示小书，非出版物'};
  const markdown = model.exportMarkdown(sampleBook, {...withDraft, demo: true});
  assert.match(markdown, /慢慢读/);
  assert.match(markdown, /章节 1 — 章节 2/);
  assert.match(markdown, /演示营地/);
  assert.match(markdown, /原创演示小书，非出版物/);
  assert.match(markdown, /有效字数：400/);
  assert.match(markdown, new RegExp(noteText));
  assert.doesNotMatch(markdown, /不应该导出的草稿/);
  assert.doesNotMatch(markdown, /## 第 2 天/);
  assert.doesNotMatch(markdown, new RegExp(units[0].text));
  assert.throws(() => model.exportMarkdown({...book, id: 'other'}, withDraft), /不匹配/);
  const empty = model.exportMarkdown(book, camp());
  assert.match(empty, /尚未提交笔记/);
  const late = model.exportMarkdown(book, model.commitNote(camp(), 1, noteText, new Date('2026-09-20T10:00:00+08:00')));
  assert.match(late, /补交（未按时完成）/);
});

test('contentFingerprint is deterministic and sensitive to正文内容', () => {
  const a = model.contentFingerprint(book);
  const b = model.contentFingerprint(book);
  assert.equal(a, b);
  assert.match(a, /^[a-z0-9]+$/);
  const changed = model.contentFingerprint({...book, units: book.units.map((u, i) => i === 0 ? {...u, text: u.text + '改动'} : u)});
  assert.notEqual(a, changed);
  assert.throws(() => model.contentFingerprint({id: 'x', title: 'y'}), /正文/);
});

test('planDays builds 7 days from an AI proposal and rejects bad proposals', () => {
  const ids = units.map(u => u.id);
  const groups = Array.from({length: 7}, (_, i) => ({unitIds: ids.slice(i * 2, i * 2 + 2), reason: `第 ${i + 1} 天理由`}));
  const days = model.planDays(book.units, groups);
  assert.equal(days.length, 7);
  assert.deepEqual(days.flatMap(d => d.unitIds), ids);
  assert.equal(days[0].day, 1);
  assert.equal(days[0].wordCount, model.countWords(units[0].text) + model.countWords(units[1].text));
  assert.ok(days.every(d => d.title && d.readMinutes >= 1 && d.wordCount > 0));
  assert.throws(() => model.planDays(book.units, groups.slice(0, 6)), /恰好包含 7 天/);
  assert.throws(() => model.planDays(book.units, groups.map((g, i) => i === 0 ? {...g, unitIds: []} : g)), /缺少阅读单元/);
  assert.throws(() => model.planDays(book.units, groups.map((g, i) => i === 6 ? {...g, unitIds: [g.unitIds[0]]} : g)), /没有覆盖全部/);
  assert.throws(() => model.planDays(book.units, groups.map((g, i) => i === 0 ? {...g, unitIds: ['unit-999']} : g)), /缺失或重复/);
  assert.throws(() => model.planDays(book.units, groups.map((g, i) => i === 0 ? {...g, unitIds: ['unit-3', 'unit-4']} : g)), /顺序|缺失或重复/);
});
