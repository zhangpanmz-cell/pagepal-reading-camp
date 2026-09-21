(function (global) {
  'use strict';

  const LIMITS = Object.freeze({fileBytes: 6 * 1024 * 1024, expandedBytes: 4 * 1024 * 1024, entries: 1000, units: 200});
  const WARNING = '本地解析只按原文标题与章节边界分段，不是 AI 语义拆分，也不会生成 AI 导读。未上传文件，图片与链接不会导入。';
  const encoder = new TextEncoder();
  class ReadingImportError extends Error {
    constructor(code, message) { super(message); this.name = 'ReadingImportError'; this.code = code; }
  }
  function fail(code, message) { throw new ReadingImportError(code, message); }
  function clean(value) { return String(value || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim(); }
  function label(value, fallback = '') { return clean(value).replace(/\s+/g, ' ').slice(0, 180) || fallback; }
  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  }
  function toBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return btoa(binary);
  }
  function imageMime(path) {
    const ext = String(path).split('.').pop().toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  }
  function makeBook(sections, options) {
    const content = sections.filter(section => clean(section.text));
    if (!content.length) fail('EMPTY_BOOK', '文件里没有可读取的正文。');
    if (content.length > LIMITS.units) fail('TOO_MANY_UNITS', '文件包含超过 200 个章节，请先拆成较小的书籍文件。');
    const title = label(options.title, '导入的书');
    const id = `imported-${hash(title + '\n' + content.map(section => section.text).join('\n'))}`;
    return {
      id, title, author: label(options.author, '作者未标注'), subtitle: options.subtitle || `${options.format} · 本地导入`,
      source: 'imported', format: options.format, segmentation: 'heading-rules', warning: WARNING,
      prelude: options.prelude || '', opening: null,
      units: content.map((section, index) => {
        const unit = {id: `${id}-${index + 1}`, title: label(section.title, `章节 ${index + 1}`), text: clean(section.text), theme: 'paper'};
        if (section.level) unit.level = section.level;
        if (section.part) unit.part = section.part;
        if (section.chapter) unit.chapter = section.chapter;
        return unit;
      }),
    };
  }

  function heading(line) {
    const trimmed = line.trim();
    const markdown = /^(#{1,6})[\t ]+(.+?)\s*#*\s*$/.exec(trimmed);
    if (markdown) return label(markdown[2]);
    if (trimmed.length <= 120 && !/[。！？!?；;]/u.test(trimmed) && /^第[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟\d]+[章节卷篇部回集]/u.test(trimmed)) return trimmed;
    return null;
  }
  function parseText(text, {title = '导入的书', format = 'TXT'} = {}) {
    if (typeof text !== 'string') fail('INVALID_TEXT', '请提供有效的文本内容。');
    if (text.length > LIMITS.fileBytes || encoder.encode(text).byteLength > LIMITS.fileBytes) fail('FILE_TOO_LARGE', '文件超过 6 MB，请先缩小文件再导入。');
    const normalized = clean(text.replace(/^\uFEFF/, ''));
    if (!normalized) fail('EMPTY_BOOK', '文件里没有可读取的正文。');
    const sections = [];
    let current = {title: '开篇', lines: []};
    let prelude = '';
    let hasHeading = false;
    let fence = null;
    const flush = () => {
      const body = current.lines.join('\n').trim();
      if (body) sections.push({title: current.title, text: body});
      if (sections.length > LIMITS.units) fail('TOO_MANY_UNITS', '文件包含超过 200 个章节，请先拆成较小的书籍文件。');
    };
    for (const line of normalized.split('\n')) {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        if (!fence) fence = {character: fenceMatch[1][0], length: fenceMatch[1].length};
        else if (fence.character === fenceMatch[1][0] && fenceMatch[1].length >= fence.length) fence = null;
        current.lines.push(line);
        continue;
      }
      const sectionTitle = fence ? null : heading(line);
      if (sectionTitle) {
        if (!hasHeading) prelude = current.lines.join('\n').trim();
        hasHeading = true;
        flush();
        current = {title: sectionTitle, lines: []};
      } else current.lines.push(line);
    }
    flush();
    if (!hasHeading && sections[0]) sections[0].title = label(title, '正文');
    return makeBook(sections, {title, format, prelude});
  }

  function bytesFrom(buffer) {
    if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    try { return new Uint8Array(buffer); } catch (_) { fail('INVALID_ZIP', 'EPUB 文件不是有效的 ZIP 数据。'); }
  }
  function decode(bytes, description = '文件') {
    let encoding = 'utf-8';
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) encoding = 'utf-16le';
    else if (bytes[0] === 0xFE && bytes[1] === 0xFF) encoding = 'utf-16be';
    try { return new TextDecoder(encoding, {fatal: true}).decode(bytes); }
    catch (_) { fail('TEXT_ENCODING', `${description}的文字编码无法读取，请使用 UTF-8 或 UTF-16 编码。`); }
  }
  function archivePath(name) {
    if (!name || name.length > 1024 || /[\u0000-\u001f\u007f\\:?#]/u.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..')) {
      fail('UNSAFE_PATH', 'EPUB 含有不安全的路径或外部资源地址，无法导入。');
    }
    let decoded;
    try { decoded = decodeURIComponent(name); } catch (_) { fail('UNSAFE_PATH', 'EPUB 含有无效的资源路径。'); }
    if (decoded !== name && (/[\u0000-\u001f\u007f\\:?#]/u.test(decoded) || decoded.startsWith('/') || decoded.split('/').some(part => part === '.' || part === '..'))) fail('UNSAFE_PATH', 'EPUB 含有不安全的编码路径，无法导入。');
    return name;
  }
  function resolveResource(base, href) {
    if (!href || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(href) || /[\\\u0000-\u001f]/u.test(href)) fail('EXTERNAL_RESOURCE', 'EPUB 引用了外部资源或不安全的地址，无法导入。');
    let decoded;
    try { decoded = decodeURIComponent(href.split(/[?#]/)[0]); } catch (_) { fail('UNSAFE_PATH', 'EPUB 含有无效的资源路径。'); }
    if (!decoded || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(decoded) || /[\\\u0000-\u001f]/u.test(decoded)) fail('UNSAFE_PATH', 'EPUB 含有不安全的资源路径。');
    const parts = base ? base.split('/').slice(0, -1) : [];
    for (const part of decoded.split('/')) {
      if (part === '..') { if (!parts.length) fail('UNSAFE_PATH', 'EPUB 资源路径超出了书籍目录。'); parts.pop(); }
      else if (part && part !== '.') parts.push(part);
    }
    return archivePath(parts.join('/'));
  }
  const crcTable = Array.from({length: 256}, (_, byte) => {
    let value = byte;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  async function inflate(bytes, expected) {
    let decompressor;
    try { decompressor = new DecompressionStream('deflate-raw'); }
    catch (_) { fail('UNSUPPORTED_DEFLATE', '当前浏览器不支持 EPUB 解压，请使用新版 Chrome、Edge 或 Safari，或导入 TXT / Markdown。'); }
    const reader = new Blob([bytes]).stream().pipeThrough(decompressor).getReader();
    const pieces = [];
    let size = 0;
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > expected || size > LIMITS.expandedBytes) {
          await reader.cancel();
          fail('EXPANDED_TOO_LARGE', 'EPUB 解压内容超出声明大小或 4 MB 限制。');
        }
        pieces.push(value);
      }
    } catch (error) {
      if (error instanceof ReadingImportError) throw error;
      fail('INVALID_ZIP', 'EPUB 压缩数据损坏，无法解压。');
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const piece of pieces) { result.set(piece, offset); offset += piece.byteLength; }
    return result;
  }
  async function readZip(buffer) {
    const bytes = bytesFrom(buffer);
    if (bytes.byteLength > LIMITS.fileBytes) fail('FILE_TOO_LARGE', '文件超过 6 MB，请先缩小文件再导入。');
    if (bytes.byteLength < 22) fail('INVALID_ZIP', 'EPUB 压缩包不完整或已损坏。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054B50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
    }
    if (end < 0) fail('INVALID_ZIP', 'EPUB 压缩目录缺失或已损坏。');
    const count = view.getUint16(end + 10, true);
    const centralSize = view.getUint32(end + 12, true);
    const centralOffset = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) fail('UNSUPPORTED_ZIP', '不支持分卷或 ZIP64 格式的 EPUB。');
    if (count > LIMITS.entries) fail('TOO_MANY_ENTRIES', 'EPUB 包含超过 1000 个文件，请先缩小书籍。');
    if (!count || centralOffset + centralSize !== end) fail('INVALID_ZIP', 'EPUB 压缩目录无效。');
    let cursor = centralOffset;
    let expanded = 0;
    const entries = [];
    const names = new Set();
    const ranges = [];
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014B50) fail('INVALID_ZIP', 'EPUB 文件目录损坏。');
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const size = view.getUint32(cursor + 24, true);
      const nameSize = view.getUint16(cursor + 28, true);
      const extraSize = view.getUint16(cursor + 30, true);
      const commentSize = view.getUint16(cursor + 32, true);
      const disk = view.getUint16(cursor + 34, true);
      const attributes = view.getUint32(cursor + 38, true);
      const local = view.getUint32(cursor + 42, true);
      const next = cursor + 46 + nameSize + extraSize + commentSize;
      if (next > end) fail('INVALID_ZIP', 'EPUB 文件目录长度无效。');
      if (flags & (1 | 64)) fail('DRM_UNSUPPORTED', '这本 EPUB 包含加密或 DRM 保护，无法在本地导入。请使用有权阅读的无 DRM 版本。');
      if (method !== 0 && method !== 8) fail('UNSUPPORTED_COMPRESSION', 'EPUB 使用了不支持的压缩方式。');
      if (disk || local === 0xFFFFFFFF || size === 0xFFFFFFFF || compressedSize === 0xFFFFFFFF) fail('UNSUPPORTED_ZIP', '不支持分卷或 ZIP64 格式的 EPUB。');
      if (((attributes >>> 16) & 0xF000) === 0xA000) fail('UNSAFE_PATH', 'EPUB 含有符号链接，无法导入。');
      const name = archivePath(decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize), 'EPUB 路径'));
      if (names.has(name)) fail('INVALID_ZIP', 'EPUB 存在重复的资源路径。');
      names.add(name);
      expanded += size;
      if (expanded > LIMITS.expandedBytes) fail('EXPANDED_TOO_LARGE', 'EPUB 解压后超过 4 MB，请先缩小书籍文件。');
      if (local + 30 > centralOffset || view.getUint32(local, true) !== 0x04034B50) fail('INVALID_ZIP', 'EPUB 文件头损坏。');
      const localNameSize = view.getUint16(local + 26, true);
      const start = local + 30 + localNameSize + view.getUint16(local + 28, true);
      if (start + compressedSize > centralOffset || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || localNameSize !== nameSize || decode(bytes.subarray(local + 30, local + 30 + localNameSize), 'EPUB 路径') !== name) fail('INVALID_ZIP', 'EPUB 资源与目录不一致。');
      if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressedSize || view.getUint32(local + 22, true) !== size)) fail('INVALID_ZIP', 'EPUB 文件大小或校验信息不一致。');
      if (method === 0 && compressedSize !== size) fail('INVALID_ZIP', 'EPUB 未压缩资源大小无效。');
      ranges.push([local, start + compressedSize]);
      entries.push({name, method, crc, start, compressedSize, size});
      cursor = next;
    }
    if (cursor !== end) fail('INVALID_ZIP', 'EPUB 目录包含无法识别的数据。');
    ranges.sort((left, right) => left[0] - right[0]);
    if (ranges.some((range, index) => index && range[0] < ranges[index - 1][1])) fail('INVALID_ZIP', 'EPUB 资源区域发生重叠。');
    if (names.has('META-INF/encryption.xml') || names.has('META-INF/rights.xml')) fail('DRM_UNSUPPORTED', '这本 EPUB 包含加密资源或 DRM 信息，当前本地导入不支持。请使用有权阅读的无 DRM 版本。');
    const files = new Map();
    for (const entry of entries) {
      // Binary assets are validated against the total budget, but never extracted.
      if (entry.name.endsWith('/') || !(entry.name === 'mimetype' || /\.(?:xml|opf|xhtml|html|htm|txt|md|ncx|jpe?g|png|gif|webp|svg)$/i.test(entry.name))) continue;
      const compressed = bytes.subarray(entry.start, entry.start + entry.compressedSize);
      const result = entry.method === 0 ? compressed.slice() : await inflate(compressed, entry.size);
      if (result.byteLength !== entry.size || crc32(result) !== entry.crc) fail('INVALID_ZIP', 'EPUB 资源校验失败，文件可能已损坏。');
      files.set(entry.name, result);
    }
    return files;
  }

  function xml(files, name) {
    if (!files.has(name)) fail('MISSING_RESOURCE', 'EPUB 缺少必要的章节或目录文件。');
    let source = decode(files.get(name), 'EPUB 正文');
    if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(source)) fail('UNSAFE_XML', 'EPUB 包含不支持的 XML 实体定义。');
    // Parse XML inertly. Remove external DTD declarations before DOMParser sees them.
    source = source.replace(/<!DOCTYPE[^>]*>/gi, '');
    if (typeof DOMParser === 'undefined') fail('BROWSER_REQUIRED', 'EPUB 需要在浏览器中解析，请从阅读页面导入。');
    const parser = new DOMParser();
    const entities = new Map();
    source = source.replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (entity, entityName) => {
      if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(entityName)) return entity;
      if (!entities.has(entity)) {
        if (entities.size >= 128) fail('INVALID_EPUB', 'EPUB 章节包含过多无法识别的文字实体。');
        // Only a single entity token enters the HTML decoder; no markup or URL can enter it.
        const decoded = parser.parseFromString(entity, 'text/html').body.textContent;
        const numeric = decoded === entity ? entity : Array.from(decoded, character => `&#${character.codePointAt(0)};`).join('');
        entities.set(entity, numeric);
      }
      return entities.get(entity);
    });
    const document = parser.parseFromString(source, 'application/xml');
    if (document.getElementsByTagName('parsererror').length || document.getElementsByTagNameNS('*', 'parsererror').length) fail('INVALID_EPUB', 'EPUB 章节或目录的 XML 格式损坏。');
    return document;
  }
  function elements(parent, name) { return Array.from(parent.getElementsByTagNameNS('*', name)); }
  function extractSections(document, fallbackTitle, carryPart, resolveImage) {
    const ignored = new Set(['script', 'style', 'nav', 'head', 'iframe', 'object', 'embed', 'svg', 'image', 'form', 'noscript']);
    const blocks = new Set(['p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'blockquote', 'pre', 'table', 'tr', 'dl', 'dt', 'dd', 'figure', 'figcaption']);
    const sections = [];
    let title = fallbackTitle;
    let level = 0;
    let part = carryPart;
    let chapter;
    let pieces = [];
    const flush = () => {
      const text = pieces.join('').replace(/[\t ]+\n/g, '\n').replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (text) sections.push({title, text, level, part, chapter});
      pieces = [];
    };
    function plainText(node) {
      if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue;
      if (node.nodeType !== 1 || ignored.has(node.localName.toLowerCase())) return '';
      return Array.from(node.childNodes).map(plainText).join('');
    }
    function walk(node) {
      if (node.nodeType === 3 || node.nodeType === 4) { pieces.push(node.nodeValue.replace(/\s+/g, ' ')); return; }
      if (node.nodeType !== 1) return;
      const name = node.localName.toLowerCase();
      if (ignored.has(name) || node.getAttribute('hidden') !== null || node.getAttribute('aria-hidden') === 'true') return;
      if (/^h[1-3]$/.test(name)) {
        flush();
        const headingLevel = Number(name[1]);
        const headingTitle = label(plainText(node), fallbackTitle);
        if (headingLevel === 1) { part = headingTitle; chapter = undefined; }
        else if (headingLevel === 2) chapter = headingTitle;
        level = headingLevel;
        title = headingTitle;
        return;
      }
      if (/^h[4-6]$/.test(name)) { pieces.push('\n\n' + label(plainText(node), '') + '\n\n'); return; }
      if (name === 'img') {
        const src = node.getAttribute('src');
        if (src && resolveImage) {
          const dataUrl = resolveImage(src);
          if (dataUrl) pieces.push('\n\n[[IMG:' + dataUrl + ']]\n\n');
        }
        return;
      }
      if (name === 'br') { pieces.push('\n'); return; }
      if (blocks.has(name)) pieces.push('\n\n');
      for (const child of node.childNodes) walk(child);
      if (blocks.has(name)) pieces.push('\n\n');
    }
    const body = elements(document, 'body')[0];
    if (body) walk(body);
    flush();
    return {sections, part};
  }
  async function parseEpub(buffer, fallbackTitle) {
    const files = await readZip(buffer);
    if (!files.has('mimetype') || clean(decode(files.get('mimetype'))) !== 'application/epub+zip') fail('INVALID_EPUB', '文件缺少正确的 EPUB 类型标识。');
    const container = xml(files, 'META-INF/container.xml');
    const rootfile = elements(container, 'rootfile').find(element => element.getAttribute('media-type') === 'application/oebps-package+xml') || elements(container, 'rootfile')[0];
    if (!rootfile) fail('INVALID_EPUB', 'EPUB 缺少书籍目录。');
    const packagePath = resolveResource('', rootfile.getAttribute('full-path'));
    const packageDocument = xml(files, packagePath);
    const metadata = elements(packageDocument, 'metadata')[0];
    const title = metadata ? elements(metadata, 'title')[0]?.textContent : '';
    const author = metadata ? elements(metadata, 'creator').map(element => element.textContent).join('、') : '';
    const manifest = new Map();
    for (const item of elements(packageDocument, 'item')) {
      const id = item.getAttribute('id');
      if (!id || manifest.has(id)) fail('INVALID_EPUB', 'EPUB 资源标识缺失或重复。');
      manifest.set(id, {path: resolveResource(packagePath, item.getAttribute('href')), type: item.getAttribute('media-type'), properties: item.getAttribute('properties') || ''});
    }
    const spine = elements(packageDocument, 'spine')[0];
    if (!spine) fail('INVALID_EPUB', 'EPUB 缺少正文阅读顺序。');
    const sections = [];
    let part;
    for (const reference of elements(spine, 'itemref')) {
      if (reference.getAttribute('linear') === 'no') continue;
      const item = manifest.get(reference.getAttribute('idref'));
      if (!item) fail('MISSING_RESOURCE', 'EPUB 的阅读目录引用了缺失的章节。');
      if (item.properties.split(/\s+/).includes('nav')) continue;
      if (!['application/xhtml+xml', 'text/html'].includes(item.type)) continue;
      const itemPath = item.path;
      const result = extractSections(xml(files, item.path), `章节 ${sections.length + 1}`, part, src => {
        const imagePath = resolveResource(itemPath, src);
        const imageBytes = files.get(imagePath);
        if (!imageBytes) return null;
        return `data:${imageMime(imagePath)};base64,${toBase64(imageBytes)}`;
      });
      sections.push(...result.sections);
      part = result.part;
      if (sections.length > LIMITS.units) fail('TOO_MANY_UNITS', '文件包含超过 200 个章节，请先拆成较小的书籍文件。');
    }
    return makeBook(sections, {title: title || fallbackTitle, author, format: 'EPUB'});
  }
  async function parseFile(file) {
    if (!file || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size < 0) fail('INVALID_FILE', '请选择要导入的书籍文件。');
    if (file.size > LIMITS.fileBytes) fail('FILE_TOO_LARGE', '文件超过 6 MB，请先缩小文件再导入。');
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'pdf' || file.type === 'application/pdf') fail('PDF_UNSUPPORTED', '暂不支持 PDF。PDF 的排版或扫描页无法可靠还原章节，请导入 EPUB、TXT 或 Markdown 文件。');
    if (!['epub', 'txt', 'md', 'markdown'].includes(extension)) fail('UNSUPPORTED_FORMAT', '请选择 EPUB、TXT 或 Markdown 文件（暂不支持 PDF）。');
    let buffer;
    try { buffer = await file.arrayBuffer(); }
    catch (_) { fail('FILE_READ_FAILED', '无法读取这个文件，请重新选择后再试。'); }
    const bytes = bytesFrom(buffer);
    if (bytes.byteLength > LIMITS.fileBytes) fail('FILE_TOO_LARGE', '文件超过 6 MB，请先缩小文件再导入。');
    const title = label(file.name.replace(/\.[^.]+$/, ''), '导入的书');
    if (extension === 'epub') return parseEpub(bytes, title);
    return parseText(decode(bytes).replace(/^\uFEFF/, ''), {title, format: extension === 'txt' ? 'TXT' : 'MD'});
  }
  global.ReadingImport = Object.freeze({parseFile, parseText, readZip, limits: LIMITS, ReadingImportError});
})(window);
