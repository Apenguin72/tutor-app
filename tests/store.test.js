// 資料存取：備份 → 清除 → 還原，資料要完全一樣（驗收標準 6）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeData } from './fixture.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import('../js/store.js');
const A = await import('../js/actions.js');

test('備份、清除、還原後資料完全一樣', () => {
  const seed = makeData();
  mem.set(store.STORAGE_KEY, JSON.stringify(seed));
  store.load();
  store.update((d) => {
    A.setLeave(d, 't1a@2026-11-25', { sourceText: '週三請假' });
    A.addExtra(d, { studentId: 's1', kind: 'makeup', date: '2026-11-29', start: '15:00' });
    A.addStop(d, { studentId: 's2', from: '2026-12-01', to: '2026-12-15', note: '段考' });
    d.chat.push({ id: 'c1', text: '週三請假', status: 'done' });
  });
  const backup = store.exportJSON();
  store.clearAll();
  assert.equal(store.getData().students.length, 0);
  assert.equal(store.importJSON(backup), null);
  assert.equal(store.exportJSON(), backup);
  assert.equal(mem.get(store.STORAGE_KEY), JSON.stringify(JSON.parse(backup)));
});

test('還原前檢查格式與版本', () => {
  assert.match(store.importJSON('不是 json'), /JSON/);
  assert.match(store.importJSON('{"a":1}'), /版本/);
  assert.match(store.importJSON('{"version":99}'), /比 app 新/);
  assert.match(store.importJSON('{"version":1,"students":{}}'), /students/);
});

test('舊資料缺欄位時自動補齊', () => {
  const d = store.migrate({ version: 1, students: [{ id: 's', code: '1', name: 'a' }] });
  assert.deepEqual(d.students[0].slots, []);
  assert.deepEqual(d.settings.visibleDays, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(d.overrides, {});
});
