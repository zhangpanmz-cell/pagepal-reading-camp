import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({window: {}, Intl, Date, TextEncoder, Uint8Array, DataView});
for (const file of ['reading-model.js', 'reading-export.js']) vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
const model = context.ReadingModel, exports = context.ReadingExport;
const units = Array.from({length: 14}, (_, i) => ({id: `unit-${i}`, title: `章节 ${i + 1}`, text: '完整内容'.repeat(50)}));
const book = {id: 'original', title: '《慢读》 & 思考', author: '作者甲', units, source: 'local', format: 'EPUB', notice: '用户持有的书籍文件'};
const makeCamp = () => ({...model.createCamp(book, '2026-09-13'), onboarded: true});
const content = '我读到了一个有趣的观点。'.repeat(50) + '\n\n第二段\t包括制表符，还有𐐀😀。';
const makeSubmitted = () => model.commitNote(makeCamp(), 1, content, new Date('2026-09-14T10:00:00+08:00'));

// Independent bit-by-bit CRC and ZIP parser: check both local and central
// records rather than accepting a file with only a ZIP signature.
function checksum(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}
function unzipStored(bytes) {
  const buffer = Buffer.from(bytes), entries = new Map();
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054B50);
  assert.equal(buffer.readUInt16LE(end + 4), 0);
  assert.equal(buffer.readUInt16LE(end + 6), 0);
  const count = buffer.readUInt16LE(end + 10);
  assert.equal(buffer.readUInt16LE(end + 8), count);
  let central = buffer.readUInt32LE(end + 16);
  assert.equal(central + buffer.readUInt32LE(end + 12), end);
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(central), 0x02014B50);
    assert.equal(buffer.readUInt16LE(central + 8), 0x0800);
    assert.equal(buffer.readUInt16LE(central + 10), 0);
    const crc = buffer.readUInt32LE(central + 16), length = buffer.readUInt32LE(central + 20);
    assert.equal(length, buffer.readUInt32LE(central + 24));
    const nameLength = buffer.readUInt16LE(central + 28), offset = buffer.readUInt32LE(central + 42);
    const name = buffer.subarray(central + 46, central + 46 + nameLength).toString('utf8');
    assert.equal(buffer.readUInt32LE(offset), 0x04034B50);
    assert.equal(buffer.readUInt32LE(offset + 14), crc);
    assert.equal(buffer.readUInt32LE(offset + 18), length);
    assert.equal(buffer.readUInt16LE(offset + 26), nameLength);
    assert.equal(buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), name);
    const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length);
    assert.equal(checksum(data), crc);
    entries.set(name, data.toString('utf8'));
    central += 46 + nameLength + buffer.readUInt16LE(central + 30) + buffer.readUInt16LE(central + 32);
  }
  assert.equal(central, end);
  return entries;
}

test('exports work in browser and Node without browser side effects', () => {
  assert.equal(context.window.ReadingExport, exports);
  assert.equal(exports.DOCX_MIME, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const source = readFileSync(new URL('../reading-export.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|window\.open|location\s*=|navigator\.clipboard|fetch\(/);
});

test('DOCX is a complete CRC-valid ZIP OOXML document with Letter pages and Chinese 11pt body', () => {
  const bytes = exports.createDocx(book, makeSubmitted());
  assert.ok(bytes instanceof Uint8Array);
  const entries = unzipStored(bytes);
  assert.deepEqual([...entries.keys()].sort(), ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'].sort());
  assert.match(entries.get('[Content_Types].xml'), /PartName="\/word\/document.xml"/);
  assert.match(entries.get('_rels/.rels'), /Target="word\/document.xml"/);
  assert.match(entries.get('word/_rels/document.xml.rels'), /Target="styles.xml"/);
  const document = entries.get('word/document.xml');
  assert.match(document, /<w:pgSz w:w="12240" w:h="15840"/);
  assert.match(document, /<w:pgMar w:top="1440"/);
  assert.match(document, /第 1 天 · 章节 1 — 章节 2/);
  assert.match(document, /章节：章节 1 — 章节 2/);
  assert.match(document, /有效字数：\d+/);
  assert.match(document, /来源：local/);
  assert.match(document, /来源说明：用户持有的书籍文件/);
  assert.match(document, /2026-09-14 10:00/);
  assert.match(document, /<w:tab\/>/);
  assert.match(document, /𐐀😀/);
  const styles = entries.get('word/styles.xml');
  assert.match(styles, /w:eastAsia="Microsoft YaHei"/);
  assert.match(styles, /w:sz w:val="22"/);
  assert.match(styles, /w:color w:val="000000"/);
  assert.doesNotMatch([...entries.values()].join(''), /<script|TargetMode="External"|w:altChunk/);
});

test('DOCX escapes XML, removes illegal control/surrogate code points, and keeps note text literal', () => {
  const attack = '读'.repeat(400) + '\n<script>& "\' </w:t><w:instrText>BAD</w:instrText>\u0000\u0001\u000B\uFFFE\uFFFF\uD800😀';
  const current = model.commitNote(makeCamp(), 1, attack, new Date('2026-09-14T10:00:00+08:00'));
  const entries = unzipStored(exports.createDocx({...book, title: '<w:evil> & "Title"'}, current));
  const document = entries.get('word/document.xml');
  assert.match(document, /&lt;script&gt;&amp; &quot;&apos;/);
  assert.match(document, /&lt;\/w:t&gt;&lt;w:instrText&gt;BAD/);
  assert.match(document, /&lt;w:evil&gt; &amp; &quot;Title&quot;/);
  assert.doesNotMatch(document, /<w:instrText>|<w:evil>|[\u0000\u0001\u000B\uFFFE\uFFFF\uD800]/);
  assert.match(document, /😀/);
});

test('both exports include demo/source/late notices and exclude draft and AI conversations', () => {
  const sample = {...book, source: 'sample', format: 'DEMO', notice: '原创演示，非出版物'};
  const demo = {...model.createCamp(sample, '2026-09-13', {demo: true}), onboarded: true};
  let current = model.commitNote(demo, 1, content, new Date('2026-09-15T10:00:00+08:00'));
  current = model.saveDraft(current, 2, '不可导出的私密草稿');
  current.chapterChats = {one: [{role: 'user', content: '不可导出的AI聊天'}]};
  const snapshot = JSON.stringify(current);
  for (const output of [unzipStored(exports.createDocx(sample, current)).get('word/document.xml'), exports.toObsidianMarkdown(sample, current)]) {
    assert.match(output, /演示营地/);
    assert.match(output, /演示书籍：原创演示，非出版物/);
    assert.match(output, /补交（未按时完成）/);
    assert.doesNotMatch(output, /不可导出的私密草稿|不可导出的AI聊天/);
    assert.doesNotMatch(output, /第 2 天 ·/);
  }
  assert.equal(JSON.stringify(current), snapshot);
});

test('empty camps export truthful empty-state text, while corrupt or mismatched camps fail', () => {
  const empty = makeCamp();
  for (const output of [unzipStored(exports.createDocx(book, empty)).get('word/document.xml'), exports.toObsidianMarkdown(book, empty)]) assert.match(output, /本营地尚未提交笔记/);
  for (const format of [exports.createDocx, exports.toObsidianMarkdown]) {
    assert.throws(() => format({...book, id: 'wrong'}, empty), /不匹配/);
    assert.throws(() => format(book, {...empty, notes: {'1': {text: '假的', count: 500, submittedAt: 'today', status: 'done'}}}), /已提交笔记数据无效/);
    assert.throws(() => format({...book, units: [...units].reverse()}, empty), /阅读安排/);
  }
});

test('Obsidian frontmatter quotes all user strings and body neutralizes HTML, embeds, code, and markdown', () => {
  const attackBook = {...book, title: '标题"\n---\nmalicious: true\u2028<evil>', author: '!!tag & ref\u0085'};
  const attackText = content + '\n---\n<script>alert(1)</script>\n![embed](https://bad)\n[[secret]]\n```dataviewjs\napp.delete()\n```';
  const current = model.commitNote(makeCamp(), 1, attackText, new Date('2026-09-14T10:00:00+08:00'));
  const output = exports.toObsidianMarkdown(attackBook, current);
  const lines = output.split('\n');
  const end = lines.indexOf('---', 1);
  assert.ok(end > 1);
  assert.equal(lines.filter(line => line === '---').length, 2);
  assert.equal(JSON.parse(lines.find(line => line.startsWith('title: ')).slice(7)), attackBook.title + ' · 阅读营笔记');
  assert.equal(JSON.parse(lines.find(line => line.startsWith('author: ')).slice(8)), attackBook.author);
  assert.doesNotMatch(lines.slice(end + 1).join('\n'), /<script>|<evil>|```|!\[embed\]|\[\[secret\]\]/);
  assert.match(output, /&lt;script&gt;/);
  assert.match(output, /\\!\\\[embed\\\]/);
  assert.match(output, /\\`\\`\\`dataviewjs/);
  assert.match(output, /第 1 天/);
});

test('safe filenames retain Chinese but remove path/control/reserved filename hazards', () => {
  assert.equal(exports.safeFileName(' 阅读/笔记\\新章:*?<>|% '), '阅读-笔记-新章-------');
  assert.equal(exports.safeFileName('...'), '阅读笔记');
  assert.equal(exports.safeFileName('CON'), '笔记-CON');
  assert.equal(exports.safeFileName('LPT1.txt'), '笔记-LPT1.txt');
  assert.equal(exports.safeFileName('正常文件.md'), '正常文件.md');
  assert.equal(Array.from(exports.safeFileName('𐐀'.repeat(100))).length, 80);
});

test('Obsidian URIs encode vault, folder, filename and text without append/overwrite/path modes', () => {
  const uri = exports.buildObsidianUri({vault: '我的书房 & study', file: '阅读笔记/慢读 #1', content: '内容\n&overwrite=true #甲'});
  assert.ok(uri.startsWith('obsidian://new?'));
  const parsed = new URL(uri);
  assert.equal(parsed.searchParams.get('vault'), '我的书房 & study');
  assert.equal(parsed.searchParams.get('file'), '阅读笔记/慢读 #1.md');
  assert.equal(parsed.searchParams.get('content'), '内容\n&overwrite=true #甲');
  for (const key of ['path', 'append', 'overwrite', 'x-success']) assert.equal(parsed.searchParams.has(key), false);
  assert.match(uri, /%2F/);
  assert.match(uri, /%20/);
});

test('Obsidian clipboard mode omits body and long content must use clipboard or Markdown', () => {
  const long = '中文'.repeat(30000);
  assert.throws(() => exports.buildObsidianUri({vault: '书房', file: '阅读', content: long}), /内容较长/);
  const uri = exports.buildObsidianUri({vault: '书房', file: '阅读', content: long, clipboard: true});
  const parsed = new URL(uri);
  assert.equal(parsed.searchParams.get('clipboard'), 'true');
  assert.equal(parsed.searchParams.has('content'), false);
  assert.ok(uri.length < 200);
  assert.throws(() => exports.buildObsidianUri({vault: '书房', file: '阅读', clipboard: 'true'}), /clipboard/);
});

test('Obsidian rejects invalid vaults, traversal, absolute paths, config files and alternate action options', () => {
  for (const vault of ['', ' .. ', '..', '/书房', 'C:\\书房', 'bad\nname', 'a'.repeat(129)]) assert.throws(() => exports.buildObsidianUri({vault, file: '笔记', content: '内容'}), /仓库/);
  for (const file of ['../x', '/etc/passwd', 'C:\\x', 'books/../x', '.obsidian/config', 'books//x', 'books/./x', '%2E%2E/x', 'books/%2Fetc', 'notes/CON', 'notes/x.', 'a\n.md']) assert.throws(() => exports.buildObsidianUri({vault: '书房', file, content: '内容'}), /路径|笔记/);
  for (const key of ['append', 'overwrite', 'path', 'action', 'x-success']) assert.throws(() => exports.buildObsidianUri({vault: '书房', file: '笔记', content: '内容', [key]: 'bad'}), /只支持新建/);
});
