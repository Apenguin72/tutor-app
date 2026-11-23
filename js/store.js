// 資料讀寫、備份還原、資料版本遷移。
// 整份資料存在 localStorage 的單一 key：tutorApp.v1

export const STORAGE_KEY = 'tutorApp.v1';
export const DATA_VERSION = 1;

export function defaultData() {
  return {
    version: DATA_VERSION,
    settings: {
      visibleDays: [0, 1, 2, 3, 4, 5, 6],
      dayStart: '08:00',
      dayEnd: '22:00',
      lastBackupAt: null,
    },
    students: [],
    overrides: {},
    extras: [],
    stops: [],
    chat: [],
    log: [],
  };
}

/** 檢查資料格式，回傳錯誤訊息；沒問題回傳 null */
export function validate(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '檔案內容不是有效的資料。';
  if (typeof obj.version !== 'number') return '找不到資料版本，可能不是本 app 的備份檔。';
  if (obj.version > DATA_VERSION) return `備份檔的版本（${obj.version}）比 app 新，請先更新 app。`;
  for (const k of ['students', 'extras', 'stops']) {
    if (obj[k] !== undefined && !Array.isArray(obj[k])) return `資料欄位「${k}」格式錯誤。`;
  }
  if (obj.overrides !== undefined && (typeof obj.overrides !== 'object' || Array.isArray(obj.overrides))) {
    return '資料欄位「overrides」格式錯誤。';
  }
  for (const s of obj.students || []) {
    if (!s || !s.id || typeof s.code !== 'string' || !Array.isArray(s.slots || [])) return '學生資料格式錯誤。';
  }
  return null;
}

/** 把舊版或缺欄位的資料補齊成目前版本 */
export function migrate(raw) {
  const base = defaultData();
  const data = { ...base, ...raw };
  data.settings = { ...base.settings, ...(raw.settings || {}) };
  for (const k of ['students', 'extras', 'stops', 'chat', 'log']) {
    if (!Array.isArray(data[k])) data[k] = [];
  }
  if (!data.overrides || typeof data.overrides !== 'object') data.overrides = {};
  for (const s of data.students) {
    if (!Array.isArray(s.slots)) s.slots = [];
  }
  // 之後有 version 2 時，在這裡加上 if (data.version === 1) { ...; data.version = 2; }
  data.version = DATA_VERSION;
  return data;
}

let data = null;
const listeners = new Set();

export function load() {
  let raw = null;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch (e) {
    console.error('讀取資料失敗', e);
  }
  data = raw && !validate(raw) ? migrate(raw) : defaultData();
  return data;
}

export function getData() {
  return data || load();
}

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('儲存資料失敗', e);
    alert('資料儲存失敗：手機空間可能不足。');
  }
}

/** 修改資料：fn(data) 直接修改物件，完成後儲存並通知畫面 */
export function update(fn) {
  const d = getData();
  const result = fn(d);
  save();
  listeners.forEach((l) => l(d));
  return result;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportJSON() {
  return JSON.stringify(getData(), null, 2);
}

/** 還原：成功回傳 null，失敗回傳錯誤訊息 */
export function importJSON(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return '無法讀取檔案：不是有效的 JSON。';
  }
  const err = validate(obj);
  if (err) return err;
  data = migrate(obj);
  save();
  listeners.forEach((l) => l(data));
  return null;
}

export function clearAll() {
  data = defaultData();
  save();
  listeners.forEach((l) => l(data));
}

export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) {
    console.warn('persist() 失敗', e);
  }
  return false;
}

export function findStudentByCode(code, d = getData()) {
  return d.students.find((s) => s.code === code) || null;
}

export function findStudent(id, d = getData()) {
  return d.students.find((s) => s.id === id) || null;
}

export function addLog(d, entry) {
  d.log.push({ at: new Date().toISOString(), ...entry });
}
