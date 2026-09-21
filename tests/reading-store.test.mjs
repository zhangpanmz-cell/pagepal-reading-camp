import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../reading-store.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const seed = () => ({
  version: 1, revision: 0, activeCamp: 'camp-1',
  books: [{id: 'book-1', title: '读书', units: [{id: 'unit-1', title: '段落', text: '完整正文'}]}],
  camps: [{id: 'camp-1', bookId: 'book-1', days: Array.from({length: 7}, (_, i) => ({day: i + 1})), notes: {}, drafts: {}}]
});

// Shared asynchronous exclusive-lock manager for separate VM "tabs". Storage
// itself has no lock, matching the separation of the two browser APIs.
function sharedBrowser() {
  const disk = new Map();
  const queue = new Map();
  const active = new Set();
  let writeCount = 0;
  const locks = {
    request(name, options, callback) {
      assert.equal(options.mode, 'exclusive');
      const previous = queue.get(name) || Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        assert.equal(active.has(name), false, 'exclusive callbacks must not overlap');
        active.add(name);
        try { return await callback({name, mode: options.mode}); }
        finally { active.delete(name); }
      });
      queue.set(name, next.catch(() => {}));
      return next;
    }
  };
  const localStorage = {
    getItem(key) {
      assert.equal(active.has(`${key}:write`), true, 'all store reads occur inside the write lock');
      return disk.get(key) ?? null;
    },
    setItem(key, value) {
      assert.equal(active.has(`${key}:write`), true, 'all store writes occur inside the write lock');
      writeCount += 1;
      disk.set(key, value);
    }
  };
  function tab({withLocks = true, storage = localStorage} = {}) {
    const context = vm.createContext({window: {}, navigator: withLocks ? {locks} : {}, localStorage: storage});
    vm.runInContext(source, context);
    return context.window.ReadingStore;
  }
  return {disk, locks, localStorage, tab, get writeCount() { return writeCount; }};
}

test('concurrent first loads run a single seed and share the same persisted camp', async () => {
  const browser = sharedBrowser();
  const first = browser.tab(), second = browser.tab();
  let calls = 0;
  const makeSeed = async () => {
    calls += 1;
    await Promise.resolve();
    return seed();
  };
  const firstLoad = first.load(makeSeed), secondLoad = second.load(makeSeed);
  assert.equal(typeof firstLoad.then, 'function');
  const [a, b] = await Promise.all([firstLoad, secondLoad]);
  assert.equal(calls, 1);
  assert.equal(browser.writeCount, 1);
  assert.deepEqual(plain(a), plain(b));
  assert.deepEqual(JSON.parse(browser.disk.get(first.key)), seed());
});

test('simultaneous old-revision writes serialize: one succeeds, the other rejects without overwriting', async () => {
  const browser = sharedBrowser();
  const first = browser.tab(), second = browser.tab();
  const original = await first.load(seed);
  const changeA = plain(original), changeB = plain(original);
  changeA.camps[0].drafts['3'] = 'A 窗口笔记';
  changeB.camps[0].drafts['4'] = 'B 窗口笔记';
  const result = await Promise.allSettled([first.save(changeA, 0), second.save(changeB, 0)]);
  assert.equal(result[0].status, 'fulfilled');
  assert.equal(result[1].status, 'rejected');
  assert.match(result[1].reason.message, /另一个窗口已更新/);
  const stored = JSON.parse(browser.disk.get(first.key));
  assert.equal(stored.revision, 1);
  assert.deepEqual(stored.camps[0].drafts, {'3': 'A 窗口笔记'});
  assert.equal(browser.writeCount, 2, 'seed plus successful write only');
  assert.deepEqual(changeB.camps[0].drafts, {'4': 'B 窗口笔记'}, 'rejected input remains available to copy');
});

test('refreshing after conflict permits a new revision without losing prior notes or drafts', async () => {
  const browser = sharedBrowser();
  const first = browser.tab(), second = browser.tab();
  const original = await first.load(seed);
  const note = {text: '读'.repeat(400), count: 400, submittedAt: '2026-09-13T10:00:00Z', status: 'done'};
  const changeA = plain(original);
  changeA.camps[0].notes['1'] = note;
  changeA.camps[0].drafts['3'] = '第一窗口草稿';
  await first.save(changeA, 0);
  await assert.rejects(second.save(original, 0), /另一个窗口已更新/);
  const refreshed = await second.load(() => { throw new Error('should not seed existing data'); });
  refreshed.camps[0].drafts['4'] = '第二窗口草稿';
  const result = await second.save(refreshed, refreshed.revision);
  assert.equal(result.revision, 2);
  assert.deepEqual(plain(result.camps[0].notes['1']), note);
  assert.deepEqual(plain(result.camps[0].drafts), {'3': '第一窗口草稿', '4': '第二窗口草稿'});
});

test('a pending save snapshots its payload and does not mutate caller objects', async () => {
  const browser = sharedBrowser();
  const store = browser.tab();
  const original = await store.load(seed);
  const next = plain(original);
  next.camps[0].drafts['3'] = '提交时内容';
  let unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const blocking = browser.locks.request(store.lockName, {mode: 'exclusive'}, () => barrier);
  const saving = store.save(next, 0);
  next.camps[0].drafts['3'] = '等待锁时继续输入的内容';
  unblock();
  await blocking;
  const saved = await saving;
  assert.equal(saved.camps[0].drafts['3'], '提交时内容');
  assert.equal(next.camps[0].drafts['3'], '等待锁时继续输入的内容');
  assert.equal(next.revision, 0);
  saved.camps[0].drafts['3'] = '修改返回值';
  assert.equal(JSON.parse(browser.disk.get(store.key)).camps[0].drafts['3'], '提交时内容');
});

test('missing Web Locks rejects initialization and saves without touching existing data', async () => {
  const browser = sharedBrowser();
  const store = browser.tab({withLocks: false, storage: {
    getItem() { throw new Error('must not read'); },
    setItem() { throw new Error('must not write'); }
  }});
  let seedCalled = false;
  await assert.rejects(store.load(() => { seedCalled = true; return seed(); }), /Web Locks.*localhost/);
  await assert.rejects(store.save(seed(), 0), /Web Locks.*localhost/);
  assert.equal(seedCalled, false);
  assert.equal(browser.writeCount, 0);
});

test('invalid or missing persisted data never gets replaced by save or reseeded by load', async () => {
  const browser = sharedBrowser();
  const store = browser.tab();
  browser.disk.set(store.key, '{invalid-json');
  await assert.rejects(store.load(seed), /原数据未被覆盖/);
  await assert.rejects(store.save(seed(), 0), /本地数据已变化或不可读取/);
  assert.equal(browser.disk.get(store.key), '{invalid-json');
  browser.disk.delete(store.key);
  await assert.rejects(store.save(seed(), 0), /本地数据已变化或不可读取/);
  assert.equal(browser.disk.has(store.key), false);
});

test('failed writes preserve previous revision and release the lock for later retry', async () => {
  const browser = sharedBrowser();
  const initialStore = browser.tab();
  const original = await initialStore.load(seed);
  let failWrite = true;
  const store = browser.tab({storage: {
    getItem: browser.localStorage.getItem,
    setItem(key, value) {
      if (failWrite) throw new Error('quota exceeded');
      browser.localStorage.setItem(key, value);
    }
  }});
  const next = plain(original);
  next.camps[0].drafts['3'] = '仍在输入框中的文字';
  await assert.rejects(store.save(next, 0), /本地存储空间不足/);
  assert.deepEqual(JSON.parse(browser.disk.get(store.key)), seed());
  failWrite = false;
  const retried = await store.save(next, 0);
  assert.equal(retried.revision, 1);
  assert.equal(retried.camps[0].drafts['3'], '仍在输入框中的文字');
});

test('invalid expected revision or input rejects before persistence', async () => {
  const browser = sharedBrowser();
  const store = browser.tab();
  await store.load(seed);
  for (const revision of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(store.save(seed(), revision), /版本无效/);
  }
  await assert.rejects(store.save({...seed(), revision: 1}, 0), /预期版本不一致/);
  await assert.rejects(store.save({...seed(), books: [{id: 'bad', title: '错误', units: [null]}]}, 0), /书籍数据格式不完整/);
  assert.equal(browser.writeCount, 1);
});
