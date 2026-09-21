/* Reading-camp rules. No persistence, network calls, or application state. */
(() => {
  'use strict';

  const DAYS = 7;
  const MIN_NOTE_WORDS = 400;
  const MAX_UNITS = 1500;
  const READING_CHARS_PER_MINUTE = 400;
  const CHARS_PER_PAGE = 800;
  const DAY_MS = 86400000;
  const dateFormatters = new Map();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const fail = message => { throw new Error(message); };

  // Count Unicode code points classified as letters or numbers. Spaces,
  // punctuation, emoji and combining marks do not earn a character credit.
  function countWords(text) {
    if (typeof text !== 'string') fail('请提供文字内容。');
    let count = 0;
    for (const character of text.replace(/\[\[IMG:[\s\S]*?\]\]/g, '')) if (/[\p{L}\p{N}]/u.test(character)) count += 1;
    return count;
  }

  function dateStamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期请使用有效的 YYYY-MM-DD 格式。');
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1000 || year > 9999) fail('日期年份请使用 1000 至 9999。');
    const stamp = Date.UTC(year, month - 1, day);
    if (new Date(stamp).toISOString().slice(0, 10) !== value) fail('这个日期不存在，请检查月份和天数。');
    return stamp;
  }

  function formatter(timezone) {
    if (!nonempty(timezone)) fail('请提供有效的营地时区。');
    if (!dateFormatters.has(timezone)) {
      try {
        const value = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
        });
        // Keep the pure module's cache bounded even with repeated imports.
        if (dateFormatters.size >= 32) dateFormatters.clear();
        dateFormatters.set(timezone, value);
      } catch { fail('营地时区无效，请使用 Asia/Shanghai 等有效时区。'); }
    }
    return dateFormatters.get(timezone);
  }

  function validNow(now) {
    if (Object.prototype.toString.call(now) !== '[object Date]' || !Number.isFinite(now.getTime())) fail('当前时间无效。');
    return now;
  }

  function localDate(now, timezone) {
    const parts = formatter(timezone).formatToParts(validNow(now));
    const part = type => parts.find(value => value.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function formatDateTime(value, timezone) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return value;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date(value));
      const get = type => parts.find(part => part.type === type)?.value || '';
      return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
    } catch { return value; }
  }

  function validateUnits(units) {
    if (!Array.isArray(units)) fail('书籍需要包含完整的阅读单元列表。');
    if (units.length < DAYS) fail('至少需要 7 个完整阅读单元，才能安排 7 天阅读。');
    if (units.length > MAX_UNITS) fail(`最多支持 ${MAX_UNITS} 个阅读单元，请合并相邻段落后重新导入。`);
    const ids = new Set();
    return units.map((unit, index) => {
      if (!isRecord(unit) || !nonempty(unit.id) || !nonempty(unit.title) || !nonempty(unit.text)) fail(`第 ${index + 1} 个阅读单元缺少有效的编号、标题或正文。`);
      if (ids.has(unit.id)) fail(`阅读单元编号重复：${unit.id}。`);
      ids.add(unit.id);
      for (const field of ['theme', 'intro', 'question']) {
        if (unit[field] !== undefined && typeof unit[field] !== 'string') fail(`第 ${index + 1} 个阅读单元的 ${field} 必须是文字。`);
      }
      if (unit.level !== undefined && (!Number.isInteger(unit.level) || unit.level < 1 || unit.level > 6)) fail(`第 ${index + 1} 个阅读单元的层级必须是 1 至 6 的整数。`);
      for (const field of ['part', 'chapter']) {
        if (unit[field] !== undefined && typeof unit[field] !== 'string') fail(`第 ${index + 1} 个阅读单元的 ${field} 必须是文字。`);
      }
      const weight = countWords(unit.text);
      if (!weight) fail(`第 ${index + 1} 个阅读单元没有可阅读的文字或数字。`);
      return weight;
    });
  }

  function segmentKey(unit, index) {
    if (unit.chapter) return `c:${unit.chapter}`;
    if (unit.part && unit.level === 1) return `p:${unit.part}`;
    return `u:${index}`;
  }

  function buildChapters(units) {
    const chapters = [];
    for (const unit of units) {
      const key = unit.chapter || unit.title;
      const last = chapters[chapters.length - 1];
      if (last && last.title === key) last.unitIds.push(unit.id);
      else chapters.push({part: unit.part, title: key, unitIds: [unit.id]});
    }
    return chapters;
  }

  function rangeLabel(chapters) {
    if (!chapters.length) return '';
    const titles = chapters.map(chapter => chapter.title);
    const core = titles[0] === titles[titles.length - 1] ? titles[0] : `${titles[0]} — ${titles[titles.length - 1]}`;
    const parts = [...new Set(chapters.map(chapter => chapter.part).filter(nonempty))];
    if (parts.length === 1) return `${parts[0]} · ${core}`;
    if (parts.length > 1) return `${parts[0]} … ${parts[parts.length - 1]} · ${core}`;
    return core;
  }

  function splitUnits(units, count = DAYS) {
    if (count !== DAYS) fail('一个阅读营固定安排 7 天阅读。');
    const weights = validateUnits(units);
    const n = units.length;
    const unitChars = new Float64Array(n + 1);
    for (let i = 0; i < n; i += 1) unitChars[i + 1] = unitChars[i] + weights[i];
    const pageAt = char => Math.max(1, Math.floor(char / CHARS_PER_PAGE) + 1);

    // Group contiguous units into chapters/parts when heading hierarchy exists.
    const segments = [];
    for (let i = 0; i < n; i += 1) {
      const key = segmentKey(units[i], i);
      const prev = segments[segments.length - 1];
      if (prev && prev.key === key) { prev.last = i; prev.weight += weights[i]; }
      else segments.push({key, first: i, last: i, weight: weights[i]});
    }
    const useSegments = segments.length >= DAYS;
    const m = useSegments ? segments.length : n;
    const itemWeight = i => useSegments ? segments[i].weight : weights[i];
    const itemTheme = i => units[useSegments ? segments[i].first : i].theme;

    const prefix = new Float64Array(m + 1);
    for (let i = 0; i < m; i += 1) prefix[i + 1] = prefix[i] + itemWeight(i);
    const target = prefix[m] / DAYS;
    const scale = target * target;

    // Exact contiguous partition DP over chapters (or units when fewer than 7
    // chapters). A small boundary cost prefers intact themes.
    const boundaryCost = new Float64Array(m + 1);
    for (let i = 1; i < m; i += 1) {
      const a = itemTheme(i - 1), b = itemTheme(i);
      if (nonempty(a) && a === b) boundaryCost[i] = 0.06;
    }
    let previous = new Float64Array(m + 1).fill(Infinity);
    previous[0] = 0;
    const parents = [null];
    for (let group = 1; group <= DAYS; group += 1) {
      const current = new Float64Array(m + 1).fill(Infinity);
      const parent = new Int32Array(m + 1).fill(-1);
      const last = m - (DAYS - group);
      for (let end = group; end <= last; end += 1) {
        for (let start = group - 1; start < end; start += 1) {
          if (!Number.isFinite(previous[start])) continue;
          const difference = prefix[end] - prefix[start] - target;
          const score = previous[start] + difference * difference / scale + boundaryCost[start];
          if (score < current[end]) {
            current[end] = score;
            parent[end] = start;
          }
        }
      }
      parents.push(parent);
      previous = current;
    }

    const ranges = [];
    let end = m;
    for (let group = DAYS; group > 0; group -= 1) {
      const start = parents[group][end];
      ranges.unshift([start, end]);
      end = start;
    }
    return ranges.map(([start, finish], index) => {
      const firstIndex = useSegments ? segments[start].first : start;
      const lastIndex = useSegments ? segments[finish - 1].last : finish - 1;
      const group = units.slice(firstIndex, lastIndex + 1);
      const wordCount = prefix[finish] - prefix[start];
      const startPage = pageAt(unitChars[firstIndex]);
      const endPage = pageAt(unitChars[lastIndex + 1]);
      const chapters = buildChapters(group);
      const title = rangeLabel(chapters);
      const questionUnit = [...group].reverse().find(unit => nonempty(unit.question));
      const introUnit = group.find(unit => nonempty(unit.intro));
      return {
        day: index + 1,
        unitIds: group.map(unit => unit.id),
        title,
        chapters,
        startPage,
        endPage,
        wordCount,
        readMinutes: Math.max(1, Math.ceil(wordCount / READING_CHARS_PER_MINUTE)),
        question: questionUnit?.question || '今天哪一段让你停下来？结合自己的经历，写下你的理解与疑问。',
        intro: introUnit?.intro || `今天阅读：${title}。读完后，记下一个与你有关的发现。`
      };
    });
  }

  function validateBook(book) {
    if (!isRecord(book) || !nonempty(book.id) || !nonempty(book.title)) fail('书籍缺少有效的编号或书名。');
    if (book.author !== undefined && typeof book.author !== 'string') fail('书籍作者信息必须是文字。');
  }

  function validateCamp(camp) {
    if (!isRecord(camp) || !nonempty(camp.id) || !nonempty(camp.bookId)) fail('阅读营数据无效。');
    dateStamp(camp.startDate);
    formatter(camp.timezone);
    if (typeof camp.demo !== 'boolean' || typeof camp.onboarded !== 'boolean') fail('阅读营的演示或开始状态无效。');
    if (camp.scheduleVersion !== undefined && camp.scheduleVersion !== 'opening-day' && camp.scheduleVersion !== 'seven-day') fail('阅读营的日程版本无效。');
    if (!Array.isArray(camp.days) || camp.days.length !== DAYS || camp.days.some((day, i) => !isRecord(day) || day.day !== i + 1 || !Array.isArray(day.unitIds) || !day.unitIds.length)) fail('阅读营必须包含顺序完整的 7 天阅读安排。');
    if (!isRecord(camp.notes) || !isRecord(camp.drafts)) fail('阅读营的笔记或草稿数据无效。');
    for (const key of Object.keys(camp.notes)) {
      const note = camp.notes[key];
      if (!/^[1-7]$/.test(key) || !isRecord(note) || typeof note.text !== 'string' || !['done', 'late'].includes(note.status) || !Number.isInteger(note.count) || note.count < MIN_NOTE_WORDS || countWords(note.text) !== note.count || typeof note.submittedAt !== 'string' || !Number.isFinite(Date.parse(note.submittedAt))) fail('已提交笔记数据无效，请检查营地记录。');
      if (note.editedAt !== undefined && (typeof note.editedAt !== 'string' || !Number.isFinite(Date.parse(note.editedAt)))) fail('笔记编辑记录无效，请检查营地记录。');
      if (note.editCount !== undefined && (!Number.isInteger(note.editCount) || note.editCount < 1)) fail('笔记编辑次数无效，请检查营地记录。');
    }
    for (const key of Object.keys(camp.drafts)) {
      if (!/^[1-7]$/.test(key) || typeof camp.drafts[key] !== 'string') fail('草稿数据无效，请检查营地记录。');
    }
    return camp;
  }

  function createCamp(book, startDate, {demo = false, timezone = 'Asia/Shanghai'} = {}) {
    validateBook(book);
    dateStamp(startDate);
    formatter(timezone);
    if (typeof demo !== 'boolean') fail('演示模式必须为 true 或 false。');
    // Reject starts that cannot represent the complete seven-calendar-day camp.
    if (new Date(dateStamp(startDate) + (DAYS - 1) * DAY_MS).getUTCFullYear() > 9999) fail('开始日期过晚，无法安排完整的 7 天阅读。');
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return {
      id: `reading-camp-${id}`, bookId: book.id, startDate, timezone, demo,
      scheduleVersion: 'seven-day', onboarded: false, days: splitUnits(book.units), notes: {}, drafts: {}
    };
  }

  // scheduleVersion 'opening-day' (legacy v28): day 0 is opening day, day 1 = startDate + 1, day 7 = startDate + 7.
  // scheduleVersion 'seven-day' (V1.2): no opening day; day 1 = startDate (D1) ... day 7 = startDate + 6.
  function dayDate(camp, day) {
    if (!isRecord(camp)) fail('阅读营数据无效。');
    const version = camp.scheduleVersion === undefined ? 'opening-day' : camp.scheduleVersion;
    if (version === 'seven-day') {
      if (!Number.isInteger(day) || day < 1 || day > DAYS) fail('日期序号必须是 1 至 7 的整数。');
      const result = new Date(dateStamp(camp.startDate) + (day - 1) * DAY_MS);
      if (result.getUTCFullYear() > 9999) fail('日期超出支持范围。');
      return result.toISOString().slice(0, 10);
    }
    if (version !== 'opening-day') fail('阅读营的日程版本无效。');
    if (!Number.isInteger(day) || day < 0 || day > DAYS + 1) fail('日期序号必须是 0 至 8 的整数。');
    const result = new Date(dateStamp(camp.startDate) + day * DAY_MS);
    if (result.getUTCFullYear() > 9999) fail('日期超出支持范围。');
    return result.toISOString().slice(0, 10);
  }

  function readingDay(day) {
    if (!Number.isInteger(day) || day < 1 || day > DAYS) fail('阅读日必须是 1 至 7 的整数。');
    return String(day);
  }

  function stateForDay(camp, day, now = new Date()) {
    validateCamp(camp);
    const key = readingDay(day);
    validNow(now);
    if (own(camp.notes, key)) return camp.notes[key].status;
    const date = localDate(now, camp.timezone);
    const scheduled = dayDate(camp, day);
    return date < scheduled ? 'future' : date === scheduled ? 'open' : 'missed';
  }

  function saveDraft(camp, day, text) {
    validateCamp(camp);
    const key = readingDay(day);
    if (typeof text !== 'string') fail('草稿必须是文字。');
    if (own(camp.notes, key)) fail('这一天已提交笔记，不能再保存草稿。');
    return {...camp, notes: {...camp.notes}, drafts: {...camp.drafts, [key]: text}};
  }

  function commitNote(camp, day, text, now = new Date()) {
    validateCamp(camp);
    const key = readingDay(day);
    validNow(now);
    if (!camp.onboarded) fail('请先开始阅读，再提交阅读笔记。');
    if (own(camp.notes, key)) fail('这一天的笔记已提交，不能重复提交或重复获得印记。');
    const state = stateForDay(camp, day, now);
    if (state === 'future') fail('这一天尚未开放，请在对应阅读日开始后提交。');
    const count = countWords(text);
    if (count < MIN_NOTE_WORDS) fail(`笔记至少需要 ${MIN_NOTE_WORDS} 个有效字，当前为 ${count} 字；空格和标点不计入。`);
    const note = {text, count, submittedAt: now.toISOString(), status: state === 'missed' ? 'late' : 'done'};
    const drafts = {...camp.drafts};
    delete drafts[key];
    return {...camp, notes: {...camp.notes, [key]: note}, drafts};
  }

  function editNote(camp, day, text, now = new Date()) {
    validateCamp(camp);
    const key = readingDay(day);
    validNow(now);
    if (typeof text !== 'string') fail('笔记必须是文字。');
    if (!own(camp.notes, key)) fail('这一天的笔记尚未提交，不能编辑。');
    const count = countWords(text);
    if (count < MIN_NOTE_WORDS) fail(`编辑后笔记仍需至少 ${MIN_NOTE_WORDS} 个有效字，当前为 ${count} 字；空格和标点不计入。`);
    const previous = camp.notes[key];
    const note = {...previous, text, count, editedAt: now.toISOString(), editCount: (previous.editCount || 0) + 1};
    return {...camp, notes: {...camp.notes, [key]: note}};
  }

  const inline = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1');

  function exportMarkdown(book, camp) {
    validateBook(book);
    validateCamp(camp);
    if (book.id !== camp.bookId) fail('书籍与当前阅读营不匹配，不能导出其他营地的笔记。');
    validateUnits(book.units);
    const units = new Map(book.units.map(unit => [unit.id, unit]));
    const scheduledIds = camp.days.flatMap(day => day.unitIds);
    if (scheduledIds.length !== book.units.length || scheduledIds.some((id, index) => id !== book.units[index].id)) fail('阅读安排与书籍单元不一致，请检查当前营地。');
    const sample = book.source === 'sample' || book.format === 'DEMO' || book.sample === true || book.isSample === true;
    const lines = [
      `# ${inline(book.title)} · 阅读营笔记`, '',
      `- 作者：${inline(book.author || '未提供')}`,
      `- 营地编号：${inline(camp.id)}`,
      `- 开始日期：${camp.startDate}`,
      `- 阅读日期：${dayDate(camp, 1)} 至 ${dayDate(camp, DAYS)}`,
      `- 营地时区：${inline(camp.timezone)}`,
      `- 已提交笔记：${Object.keys(camp.notes).length} / ${DAYS}`, ''
    ];
    if (camp.demo) lines.push('> 演示营地：以下记录可能包含预置演示笔记，不代表真实打卡或真实完成记录。', '');
    if (sample) lines.push(`> 演示书籍：${inline(book.notice || '原创演示内容，非出版物。')}`, '');
    else if (nonempty(book.notice)) lines.push(`> 来源说明：${inline(book.notice)}`, '');
    const submittedDays = camp.days.filter(day => own(camp.notes, String(day.day)));
    if (!submittedDays.length) lines.push('本营地尚未提交笔记。草稿不包含在导出中。', '');
    for (const day of submittedDays) {
      const note = camp.notes[String(day.day)];
      lines.push(
        `## 第 ${day.day} 天 · ${inline(day.title)}`, '',
        `- 阅读日期：${dayDate(camp, day.day)}`,
        `- 章节：${inline(day.title)}`,
        `- 页码：${day.startPage ? `第 ${day.startPage}~${day.endPage} 页` : '未记录'}`,
        `- 状态：${note.status === 'late' ? '补交（未按时完成）' : '按时完成'}`,
        `- 有效字数：${note.count}`,
        `- 提交时间：${formatDateTime(note.submittedAt, camp.timezone)}`, '',
        note.text, ''
      );
    }
    return lines.join('\n');
  }

  // `chapter` remains the transport field for compatibility; its payload now
  // contains every complete unit in a day's assigned reading, in plan order.
  function dailyDiscussionContext(book, day) {
    if (!book || !Array.isArray(book.units) || !day || !Number.isInteger(day.day) || day.day < 1 || day.day > 7 || !Array.isArray(day.unitIds) || !day.unitIds.length) fail('当天阅读范围不完整，无法开始讨论。');
    const units = day.unitIds.map(id => book.units.find(unit => unit.id === id));
    if (units.some(unit => !unit || typeof unit.title !== 'string' || typeof unit.text !== 'string' || !unit.text.trim())) fail('当天部分章节缺少正文，无法分析完整阅读范围。');
    const stripImages = value => String(value).replace(/\[\[IMG:[\s\S]*?\]\]/g, '');
    return {id: `reading-day-${day.day}`, title: `第 ${day.day} 天 · 完整阅读范围`, text: units.map(unit => `【${unit.title}】\n${stripImages(unit.text)}`).join('\n\n')};
  }

  // Deterministic content fingerprint for guide deduping; not a secret or an id.
  function contentFingerprint(book) {
    if (!isRecord(book) || !Array.isArray(book.units)) fail('书籍缺少可用的正文，无法生成导读。');
    const source = `${book.title || ''}\n${book.units.map(unit => `${unit.title || ''}\n${unit.text || ''}`).join('\n')}`;
    let result = 2166136261;
    for (let i = 0; i < source.length; i += 1) result = Math.imul(result ^ source.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  }

  // Turn an AI-proposed seven-day split (groups of unitIds) into day objects.
  // Rejects any proposal that misses, repeats, reorders units or is not 7 groups.
  function planDays(units, groups) {
    validateUnits(units);
    if (!Array.isArray(groups) || groups.length !== DAYS) fail('AI 拆分建议必须恰好包含 7 天。');
    const indexById = new Map(units.map((unit, index) => [unit.id, index]));
    const unitChars = new Float64Array(units.length + 1);
    for (let i = 0; i < units.length; i += 1) unitChars[i + 1] = unitChars[i] + countWords(units[i].text);
    const pageAt = char => Math.max(1, Math.floor(char / CHARS_PER_PAGE) + 1);
    const seen = new Set();
    let lastIndex = -1;
    const days = groups.map((group, dayIndex) => {
      if (!isRecord(group) || !Array.isArray(group.unitIds) || !group.unitIds.length) fail(`第 ${dayIndex + 1} 天的拆分建议缺少阅读单元。`);
      const items = group.unitIds.map(id => {
        const index = indexById.get(id);
        if (index === undefined || seen.has(id)) fail(`拆分建议中的单元 ${id} 缺失或重复。`);
        if (index < lastIndex) fail('拆分建议必须保持原文顺序，不能乱序。');
        seen.add(id);
        lastIndex = index;
        return units[index];
      });
      const firstIndex = indexById.get(group.unitIds[0]);
      const lastUnitIndex = indexById.get(group.unitIds[group.unitIds.length - 1]);
      const wordCount = items.reduce((sum, unit) => sum + countWords(unit.text), 0);
      const chapters = buildChapters(items);
      const title = rangeLabel(chapters);
      const questionUnit = [...items].reverse().find(unit => nonempty(unit.question));
      const introUnit = items.find(unit => nonempty(unit.intro));
      return {
        day: dayIndex + 1,
        unitIds: group.unitIds,
        title,
        chapters,
        startPage: pageAt(unitChars[firstIndex]),
        endPage: pageAt(unitChars[lastUnitIndex + 1]),
        wordCount,
        readMinutes: Math.max(1, Math.ceil(wordCount / READING_CHARS_PER_MINUTE)),
        question: questionUnit?.question || '今天哪一段让你停下来？结合自己的经历，写下你的理解与疑问。',
        intro: introUnit?.intro || `今天阅读：${title}。读完后，记下一个与你有关的发现。`
      };
    });
    if (seen.size !== units.length) fail('拆分建议没有覆盖全部阅读单元，不能采用。');
    return days;
  }

  const api = Object.freeze({
    DAYS, MIN_NOTE_WORDS, MAX_UNITS, READING_CHARS_PER_MINUTE,
    countWords, splitUnits, createCamp, dayDate, stateForDay,
    saveDraft, commitNote, editNote, exportMarkdown, dailyDiscussionContext, contentFingerprint, planDays, formatDateTime
  });
  globalThis.ReadingModel = api;
  if (typeof window !== 'undefined') window.ReadingModel = api;
})();
