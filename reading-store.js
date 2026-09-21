/* Pagepal reading data stays in its own versioned browser storage. */
(() => {
  'use strict';
  const key = 'pagepal-reading-demo-v1';
  const lockName = `${key}:write`;
  function validate(value) {
    if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.books) || !Array.isArray(value.camps)) throw new Error('读书数据暂时无法读取。原数据已保留，请勿清理浏览器存储。');
    if (value.books.length > 30 || value.camps.length > 30) throw new Error('本地 demo 最多保存 30 本书。请先导出笔记。');
    for (const book of value.books) if (!book || typeof book.id !== 'string' || typeof book.title !== 'string' || !Array.isArray(book.units) || book.units.some(u => !u || typeof u.id !== 'string' || typeof u.text !== 'string')) throw new Error('书籍数据格式不完整，未覆盖原数据。');
    for (const camp of value.camps) if (!camp || !value.books.some(b => b.id === camp.bookId) || !Array.isArray(camp.days) || camp.days.length !== 7 || !camp.notes || !camp.drafts) throw new Error('读书营数据格式不完整，未覆盖原数据。');
    return value;
  }

  function withWriteLock(task) {
    if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') throw new Error('此浏览器不支持安全保存。请使用支持 Web Locks 的新版浏览器，并通过 localhost 打开；未覆盖已有数据。');
    // All tabs use this same origin-scoped, exclusive lock. A localStorage
    // revision check alone is not atomic across tabs; never fall back to it.
    return navigator.locks.request(lockName, {mode: 'exclusive'}, task);
  }

  function snapshot(value) {
    validate(value);
    try { return validate(JSON.parse(JSON.stringify(value))); }
    catch { throw new Error('读书数据无法完整保存，原数据未被覆盖。'); }
  }

  async function load(seed) {
    return withWriteLock(async () => {
      let raw;
      try { raw = localStorage.getItem(key); }
      catch { throw new Error('浏览器未能读取读书数据。请允许本地存储后重新打开。'); }
      if (raw !== null) {
        try { return validate(JSON.parse(raw)); }
        catch (e) { throw new Error(/^(读书|书籍|本地 demo)/.test(e.message) ? e.message : '本地读书数据损坏，原数据未被覆盖。'); }
      }
      if (typeof seed !== 'function') throw new Error('缺少读书营初始化内容，尚未写入数据。');
      // Holding the same lock throughout initialization ensures concurrent
      // first visits share one seed instead of replacing one another's camp.
      const initial = snapshot(await seed());
      try { localStorage.setItem(key, JSON.stringify(initial)); }
      catch { throw new Error('浏览器未能保存读书数据。请允许本地存储后再打开 demo。'); }
      return initial;
    });
  }

  async function save(next, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('读书数据版本无效，本次内容未保存。请保留笔记文本后刷新。');
    // Capture the intended write before waiting for another tab's lock. The
    // caller may continue editing while the promise is pending.
    const pending = snapshot(next);
    if (pending.revision !== expectedRevision) throw new Error('保存内容与预期版本不一致，本次内容未保存。请保留笔记文本后刷新。');
    return withWriteLock(() => {
      let previous;
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) throw new Error();
        previous = validate(JSON.parse(raw));
      } catch { throw new Error('本地数据已变化或不可读取，本次内容未保存。请保留笔记文本后刷新。'); }
      if (previous.revision !== expectedRevision) throw new Error('另一个窗口已更新读书营。本次内容未保存，请复制草稿后刷新。');
      const value = validate({...pending, revision: expectedRevision + 1});
      try { localStorage.setItem(key, JSON.stringify(value)); }
      catch { throw new Error('本地存储空间不足，本次内容未保存。请先复制或导出笔记。'); }
      return value;
    });
  }
  Object.assign(window, {ReadingStore: Object.freeze({key, lockName, load, save, validate})});
})();
