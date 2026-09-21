import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {deflateRawSync} from 'node:zlib';

const source = await readFile(new URL('../reading-import.js', import.meta.url), 'utf8');
function harness(overrides = {}) {
  const context = vm.createContext({window: {}, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, DecompressionStream, ...overrides});
  vm.runInContext(source, context, {filename: 'reading-import.js'});
  return context.window.ReadingImport;
}
const api = harness();
function file(name, content, size) {
  const bytes = typeof content === 'string' ? Buffer.from(content) : content;
  return {name, size: size ?? bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
}
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zip(entries) {
  const locals = [];
  const directories = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.text || '');
    const data = entry.method === 8 ? deflateRawSync(raw) : raw;
    const size = entry.size ?? raw.length;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags || 0, 6);
    local.writeUInt16LE(entry.method || 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(entry.flags || 0, 8);
    directory.writeUInt16LE(entry.method || 0, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    directories.push(directory, name);
    offset += local.length + name.length + data.length;
  }
  const directoryData = Buffer.concat(directories);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryData, end]);
}
async function rejectsCode(promise, code) { await assert.rejects(promise, error => error.name === 'ReadingImportError' && error.code === code); }

test('TXT recognizes Chinese headings and preserves whole paragraphs', () => {
  const longParagraph = '完整的自然段不应被长度阈值拆开。'.repeat(600);
  const book = api.parseText(`序言原文。\n\n第一章 开始\n${longParagraph}\n\n下一段。\n第二章继续\n第二章正文。`, {title: '小书'});
  assert.equal(book.title, '小书');
  assert.equal(book.source, 'imported');
  assert.equal(book.units.length, 3);
  assert.equal(book.units[1].text, `${longParagraph}\n\n下一段。`);
  assert.equal(book.units[2].title, '第二章继续');
  assert.equal(book.prelude, '序言原文。');
  assert.equal(book.opening, null);
  assert.equal(book.segmentation, 'heading-rules');
  assert.match(book.warning, /不是 AI 语义拆分/);
});

test('Markdown sections preserve paragraphs, code fences and imported markup as text', async () => {
  const book = await api.parseFile(file('随笔.md', '# 早晨\n第一段。\n\n```md\n# 代码里的标题\n```\n\n<script>alert(1)</script>\n## 傍晚\n最后一段。'));
  assert.equal(book.format, 'MD');
  assert.equal(book.title, '随笔');
  assert.equal(book.units.length, 2);
  assert.match(book.units[0].text, /# 代码里的标题/);
  assert.match(book.units[0].text, /<script>alert\(1\)<\/script>/);
  assert.equal(book.units[1].text, '最后一段。');
});

test('unstructured text returns a single natural unit without invented AI content', () => {
  const input = '一整段文字。'.repeat(1500) + '\n\n第二段仍然完整。';
  const book = api.parseText(input, {title: '没有标题的书'});
  assert.equal(book.units.length, 1);
  assert.equal(book.units[0].text, input);
  assert.equal(book.opening, null);
  assert.equal(book.units[0].id, api.parseText(input, {title: '没有标题的书'}).units[0].id);
});

test('text and file size limits fail before parsing or reading an oversized file', async () => {
  assert.throws(() => api.parseText('中'.repeat(3 * 1024 * 1024)), error => error.code === 'FILE_TOO_LARGE');
  let read = false;
  await rejectsCode(api.parseFile({name: 'large.txt', size: 7 * 1024 * 1024, arrayBuffer() { read = true; }}), 'FILE_TOO_LARGE');
  assert.equal(read, false);
  await rejectsCode(api.parseFile(file('misreported.txt', Buffer.alloc(7 * 1024 * 1024), 1)), 'FILE_TOO_LARGE');
});

test('PDF, unknown formats, empty files and invalid encodings have explicit errors', async () => {
  await rejectsCode(api.parseFile(file('书.pdf', '%PDF')), 'PDF_UNSUPPORTED');
  await rejectsCode(api.parseFile(file('书.docx', 'words')), 'UNSUPPORTED_FORMAT');
  await rejectsCode(api.parseFile(file('书.txt', ' \n\t')), 'EMPTY_BOOK');
  await rejectsCode(api.parseFile(file('书.txt', Buffer.from([0xff]))), 'TEXT_ENCODING');
  assert.throws(() => api.parseText(null), error => error.code === 'INVALID_TEXT');
});

test('UTF-16 BOM text is decoded and more than 200 natural units are rejected', async () => {
  const book = await api.parseFile(file('书.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第一章 开篇\n完整正文。', 'utf16le')])));
  assert.equal(book.units[0].text, '完整正文。');
  const text = Array.from({length: 201}, (_, index) => `# 章节 ${index}\n正文`).join('\n');
  assert.throws(() => api.parseText(text), error => error.code === 'TOO_MANY_UNITS');
});

test('ZIP reader extracts text and images but skips unrelated binary assets', async () => {
  const files = await api.readZip(zip([{name: 'mimetype', text: 'application/epub+zip'}, {name: 'OEBPS/chapter.xhtml', text: '<html>正文</html>', method: 8}, {name: 'cover.jpg', text: 'binary'}, {name: 'font.ttf', text: 'binary'}]));
  assert.equal(new TextDecoder().decode(files.get('mimetype')), 'application/epub+zip');
  assert.equal(new TextDecoder().decode(files.get('OEBPS/chapter.xhtml')), '<html>正文</html>');
  assert.equal(files.has('cover.jpg'), true);
  assert.equal(files.has('font.ttf'), false);
});

test('ZIP reader rejects malformed directories, payload corruption, and duplicate names', async () => {
  await rejectsCode(api.readZip(Buffer.from('not a zip')), 'INVALID_ZIP');
  const truncated = zip([{name: 'a.txt', text: 'hello'}]).subarray(0, 35);
  await rejectsCode(api.readZip(truncated), 'INVALID_ZIP');
  const damaged = zip([{name: 'a.txt', text: 'hello'}]);
  damaged[35] ^= 1;
  await rejectsCode(api.readZip(damaged), 'INVALID_ZIP');
  await rejectsCode(api.readZip(zip([{name: 'a.txt', text: 'a'}, {name: 'a.txt', text: 'b'}])), 'INVALID_ZIP');
});

test('ZIP reader rejects path traversal, encoded traversal and external paths', async () => {
  for (const name of ['../book.txt', '/book.txt', 'A/../book.txt', 'A\\book.txt', '%2e%2e/book.txt', 'https://example.com/book.txt']) {
    await rejectsCode(api.readZip(zip([{name, text: 'no'}])), 'UNSAFE_PATH');
  }
});

test('ZIP reader enforces entry count and declared expanded size before decompression', async () => {
  await rejectsCode(api.readZip(zip(Array.from({length: 1001}, (_, index) => ({name: `file-${index}.txt`, text: ''})))), 'TOO_MANY_ENTRIES');
  await rejectsCode(api.readZip(zip([{name: 'large.txt', text: '', method: 8, size: 5 * 1024 * 1024}])), 'EXPANDED_TOO_LARGE');
  await rejectsCode(api.readZip(zip([{name: 'a.txt', text: '', method: 8, size: 3 * 1024 * 1024}, {name: 'b.txt', text: '', method: 8, size: 2 * 1024 * 1024}])), 'EXPANDED_TOO_LARGE');
});

test('ZIP reader stops dishonest raw-deflate output beyond the declared size', async () => {
  await rejectsCode(api.readZip(zip([{name: 'bomb.txt', text: 'x'.repeat(100000), method: 8, size: 10}])), 'EXPANDED_TOO_LARGE');
});

test('encrypted and unsupported EPUB compression fail with specific errors', async () => {
  await rejectsCode(api.readZip(zip([{name: 'book.txt', text: 'locked', flags: 1}])), 'DRM_UNSUPPORTED');
  await rejectsCode(api.readZip(zip([{name: 'META-INF/encryption.xml', text: '<encryption/>'}])), 'DRM_UNSUPPORTED');
  await rejectsCode(api.readZip(zip([{name: 'book.txt', text: 'data', method: 12}])), 'UNSUPPORTED_COMPRESSION');
  await rejectsCode(harness({DecompressionStream: undefined}).readZip(zip([{name: 'book.txt', text: 'data', method: 8}])), 'UNSUPPORTED_DEFLATE');
});
