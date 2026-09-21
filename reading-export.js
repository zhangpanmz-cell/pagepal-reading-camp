/* Pure, offline note exports. Loading this module never writes files, opens apps,
 * changes the clipboard, or includes drafts / chapter conversations. */
(() => {
  'use strict';

  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const MAX_URI_LENGTH = 8000;
  const MAX_ZIP_BYTES = 64 * 1024 * 1024;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const fail = message => { throw new Error(message); };
  const clean = value => String(value ?? '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');
  const xml = value => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const inline = value => clean(value).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
  const sampleBook = book => book.source === 'sample' || book.format === 'DEMO' || book.sample === true || book.isSample === true;

  function collect(book, camp) {
    const model = globalThis.ReadingModel;
    if (!model) fail('请先加载阅读营规则，再导出笔记。');
    // Reuse the existing model's complete book / camp / note / unit validation.
    // Its string is deliberately not used as DOCX XML or embedded markdown.
    model.exportMarkdown(book, camp);
    return {
      model,
      submitted: camp.days.filter(day => own(camp.notes, String(day.day))).map(day => ({
        day, note: camp.notes[String(day.day)], date: model.dayDate(camp, day.day),
        chapters: day.title,
        pages: day.startPage ? `第 ${day.startPage}~${day.endPage} 页` : '未记录',
        submittedAt: model.formatDateTime(camp.notes[String(day.day)].submittedAt, camp.timezone)
      })),
      metadata: [
        ['作者', book.author || '未提供'], ['营地编号', camp.id], ['开始日期', camp.startDate],
        ['阅读日期', `${model.dayDate(camp, 1)} 至 ${model.dayDate(camp, model.DAYS)}`],
        ['营地时区', camp.timezone], ['已提交笔记', `${Object.keys(camp.notes).length} / ${model.DAYS}`],
        ['来源', book.source || '用户导入'], ['格式', book.format || '未标注']
      ],
      notices: [
        ...(camp.demo ? ['演示营地：以下记录可能包含预置演示笔记，不代表真实打卡或真实完成记录。'] : []),
        ...(sampleBook(book) ? [`演示书籍：${book.notice || '原创演示内容，非出版物。'}`] : book.notice ? [`来源说明：${book.notice}`] : []),
        '仅包含已提交的读书笔记；不包含草稿和 AI 章节对话。'
      ]
    };
  }

  function safeFileName(value, fallback = '阅读笔记') {
    const sanitize = input => Array.from(clean(input).normalize('NFC')
      .replace(/[<>:"/\\|?*%\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '-')
      .replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '')).slice(0, 80).join('').replace(/[. ]+$/g, '');
    let name = sanitize(value) || sanitize(fallback) || '阅读笔记';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `笔记-${name}`;
    return name;
  }

  const crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    crcTable[index] = value >>> 0;
  }
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Small ZIP32 writer, using the standard uncompressed method. All generated
  // entries are known package paths; no user-supplied archive names are accepted.
  function zip(entries) {
    const encoder = new TextEncoder();
    const files = entries.map(([path, content]) => ({name: encoder.encode(path), data: encoder.encode(content)}));
    const size = files.reduce((sum, file) => sum + 30 + file.name.length + file.data.length + 46 + file.name.length, 22);
    if (size > MAX_ZIP_BYTES) fail('笔记导出文件超过 64 MB，请按单个阅读营导出。');
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    let offset = 0;
    const u16 = value => { view.setUint16(offset, value, true); offset += 2; };
    const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
    const put = value => { bytes.set(value, offset); offset += value.length; };
    for (const file of files) {
      file.offset = offset;
      file.crc = crc32(file.data);
      u32(0x04034B50); u16(20); u16(0x0800); u16(0); u16(0); u16(0x0021);
      u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.name.length); u16(0);
      put(file.name); put(file.data);
    }
    const centralOffset = offset;
    for (const file of files) {
      u32(0x02014B50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(0x0021);
      u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.name.length);
      u16(0); u16(0); u16(0); u16(0); u32(0); u32(file.offset); put(file.name);
    }
    const centralSize = offset - centralOffset;
    u32(0x06054B50); u16(0); u16(0); u16(files.length); u16(files.length);
    u32(centralSize); u32(centralOffset); u16(0);
    return bytes;
  }

  function paragraph(text, style = 'Normal') {
    const runs = clean(text).split('\t').map((part, index) => `${index ? '<w:r><w:tab/></w:r>' : ''}<w:r><w:t xml:space="preserve">${xml(part)}</w:t></w:r>`).join('');
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs}</w:p>`;
  }
  const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const STYLES = `${XML_HEADER}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="300"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
  </w:styles>`;

  function createDocx(book, camp) {
    const record = collect(book, camp);
    const body = [paragraph(`${inline(book.title)} · 阅读营笔记`, 'Title')];
    for (const [label, value] of record.metadata) body.push(paragraph(`${label}：${inline(value)}`, 'Metadata'));
    for (const notice of record.notices) body.push(paragraph(inline(notice), 'Metadata'));
    if (!record.submitted.length) body.push(paragraph('本营地尚未提交笔记。草稿不包含在导出中。'));
    for (const {day, note, date, chapters, pages, submittedAt} of record.submitted) {
      body.push(paragraph(`第 ${day.day} 天 · ${inline(day.title)}`, 'Heading1'));
      for (const line of [
        `阅读日期：${date}`, `章节：${inline(chapters)}`, `页码：${inline(pages)}`,
        `状态：${note.status === 'late' ? '补交（未按时完成）' : '按时完成'}`,
        `有效字数：${note.count}`, `提交时间：${submittedAt}`
      ]) body.push(paragraph(line, 'Metadata'));
      for (const line of note.text.replace(/\r\n?/g, '\n').split('\n')) body.push(paragraph(line));
    }
    const document = `${XML_HEADER}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    return zip([
      ['[Content_Types].xml', `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
      ['_rels/.rels', `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
      ['word/document.xml', document], ['word/styles.xml', STYLES],
      ['word/_rels/document.xml.rels', `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['docProps/core.xml', `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(book.title)} · 阅读营笔记</dc:title><dc:creator>页伴</dc:creator><dc:description>${xml(`营地 ${camp.id}；仅包含已提交笔记。`)}</dc:description></cp:coreProperties>`]
    ]);
  }

  // Notes are plain text in this app. Escape both markdown operators and HTML
  // so user text cannot turn into embeds, links, HTML, or plugin code blocks.
  const markdownText = value => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~=$^-])/g, '\\$1');
  const markdownInline = value => markdownText(inline(value));
  const yamlString = value => JSON.stringify(clean(value)).replace(/[\u007F-\u009F\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

  function toObsidianMarkdown(book, camp) {
    const record = collect(book, camp);
    const properties = [
      ['title', `${book.title} · 阅读营笔记`], ['author', book.author || '未提供'], ['book_id', book.id],
      ['camp_id', camp.id], ['start_date', camp.startDate], ['timezone', camp.timezone],
      ['source', book.source || '用户导入'], ['format', book.format || '未标注']
    ];
    const lines = ['---', ...properties.map(([key, value]) => `${key}: ${yamlString(value)}`),
      `demo_camp: ${camp.demo}`, `sample_book: ${sampleBook(book)}`, `submitted_notes: ${record.submitted.length}`,
      'tags:', '  - reading', '  - pagepal', '---', '', `# ${markdownInline(book.title)} · 阅读营笔记`, ''];
    for (const [label, value] of record.metadata) lines.push(`- ${label}：${markdownInline(value)}`);
    lines.push('');
    for (const notice of record.notices) lines.push(`> ${markdownInline(notice)}`, '');
    if (!record.submitted.length) lines.push('本营地尚未提交笔记。草稿不包含在导出中。', '');
    for (const {day, note, date, chapters, pages, submittedAt} of record.submitted) {
      lines.push(`## 第 ${day.day} 天 · ${markdownInline(day.title)}`, '',
        `- 阅读日期：${date}`, `- 章节：${markdownInline(chapters)}`, `- 页码：${markdownInline(pages)}`,
        `- 状态：${note.status === 'late' ? '补交（未按时完成）' : '按时完成'}`,
        `- 有效字数：${note.count}`, `- 提交时间：${markdownInline(submittedAt)}`, '', markdownText(note.text), '');
    }
    return lines.join('\n');
  }

  function buildObsidianUri(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) fail('请提供 Obsidian 导出设置。');
    if (Object.keys(options).some(key => !['vault', 'file', 'content', 'clipboard'].includes(key))) fail('Obsidian 导出只支持新建笔记，不支持追加、覆盖或绝对路径。');
    const {vault, file, content, clipboard = false} = options;
    if (typeof vault !== 'string' || !vault.trim() || vault !== vault.trim() || vault.length > 128 || /[\/\\:\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(vault) || ['.', '..'].includes(vault)) fail('请输入有效的 Obsidian 仓库名称或仓库 ID，不要填写文件路径。');
    if (typeof file !== 'string' || !file || file.length > 240 || /[<>:"\\|?*\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(file) || /%[0-9a-f]{2}/i.test(file)) fail('请输入库内的笔记文件名，可使用普通子文件夹，不要填写绝对路径。');
    const segments = file.split('/');
    if (segments.some(segment => !segment || segment !== segment.trim() || segment.startsWith('.') || segment.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) fail('笔记路径不能越出仓库、指向隐藏配置或包含无效名称。');
    if (typeof clipboard !== 'boolean') fail('clipboard 必须是 true 或 false。');
    if (!clipboard && typeof content !== 'string') fail('请提供笔记正文，或选择剪贴板导入。');
    if (content !== undefined && typeof content !== 'string') fail('笔记正文必须是文字。');
    const filename = /\.md$/i.test(file) ? file : `${file}.md`;
    const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const uri = `obsidian://new?vault=${encode(vault)}&file=${encode(filename)}&${clipboard ? 'clipboard=true' : `content=${encode(content)}`}`;
    if (uri.length > MAX_URI_LENGTH) fail('笔记内容较长，请使用剪贴板导入或下载 Markdown 文件。');
    return uri;
  }

  const api = Object.freeze({DOCX_MIME, MAX_URI_LENGTH, createDocx, toObsidianMarkdown, buildObsidianUri, safeFileName});
  globalThis.ReadingExport = api;
  if (typeof window !== 'undefined') window.ReadingExport = api;
})();
