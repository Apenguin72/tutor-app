// docs/parser-cases.md 的 120 條例句：node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeData, NOW } from './fixture.js';
import { parse, resolveStudent } from '../js/parser.js';
import { getUpcomingLessons } from '../js/schedule.js';

// ---------- 測試資料的前提 ----------
const SETUP = {
  // I. 補課：001 有一筆待補的請假（11/18 18:00）
  makeupPending(d) { d.overrides['t1a@2026-11-18'] = { status: 'leave', makeupPending: true }; },
  // J. 取消請假：這些課已經被標記為請假或停課
  marked(d) {
    d.overrides['t1a@2026-11-25'] = { status: 'leave', makeupPending: true };
    d.overrides['t1b@2026-11-28'] = { status: 'leave', makeupPending: true };
    d.overrides['t3a@2026-11-23'] = { status: 'leave', makeupPending: true };
    d.overrides['t2a@2026-11-24'] = { status: 'leave', makeupPending: true };
    d.stops.push({ id: 'p1', studentId: 's2', from: '2026-11-30', to: '2026-12-06', note: '' });
  },
};

// ---------- 120 條例句 ----------
// 日期寫 'M/D'（2026 年）或完整的 'YYYY-MM-DD'
// targets：['M/D HH:MM']；to：{ date, start, duration }；q：預期會出現的追問欄位
const CASES = [
  // A. 單次請假
  { n: 1, code: '001', text: '老師我今天要請假', action: 'leave', q: ['target'], opts: { target: ['11/25', '11/28', '12/2', '12/5'] } },
  { n: 2, code: '003', text: '老師今天要請假', action: 'leave', targets: ['11/23 17:30'] },
  { n: 3, code: '002', text: '小美明天請假', action: 'leave', targets: ['11/24 19:00'] },
  { n: 4, code: '001', text: '週三請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 5, code: '001', text: '星期三要請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 6, code: '001', text: '禮拜三沒辦法上課', action: 'leave', targets: ['11/25 18:00'] },
  { n: 7, code: '001', text: '下週三請假', action: 'leave', targets: ['12/2 18:00'] },
  { n: 8, code: '001', text: '下禮拜六不能上', action: 'leave', targets: ['12/5 14:00'] },
  { n: 9, code: '001', text: '下下週三請假', action: 'leave', targets: ['12/9 18:00'] },
  { n: 10, code: '001', text: '11/28請假', action: 'leave', targets: ['11/28 14:00'] },
  { n: 11, code: '001', text: '11月28日要請假', action: 'leave', targets: ['11/28 14:00'] },
  { n: 12, code: '001', text: '28號那天沒辦法', action: 'leave', targets: ['11/28 14:00'] },
  { n: 13, code: '001', text: '１１／２５請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 14, code: '001', text: '十一月二十五號請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 15, code: '001', text: '這次請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 16, code: '001', text: '下次的課要請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 17, code: '001', text: '下一堂先請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 18, code: '001', text: '後天請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 19, code: '003', text: '他發燒了今天先休息', action: 'leave', targets: ['11/23 17:30'] },
  { n: 20, code: '003', text: '小孩不舒服今天沒辦法去', action: 'leave', targets: ['11/23 17:30'] },
  { n: 21, code: '002', text: '學校有活動週四不能上', action: 'leave', targets: ['11/26 19:00'] },
  { n: 22, code: '002', text: '禮拜二要考試先請假一次', action: 'leave', targets: ['11/24 19:00'] },
  { n: 23, code: '003', text: '家裡臨時有事，今晚的課取消', action: 'leave', targets: ['11/23 17:30'] },
  { n: 24, code: '001', text: '週六要回老家，課先停一次', action: 'leave', targets: ['11/28 14:00'] },
  { n: 25, code: '001', text: '這週六畢業旅行不能上', action: 'leave', targets: ['11/28 14:00'] },
  { n: 26, code: '002', text: '感冒了明天請假', action: 'leave', targets: ['11/24 19:00'] },
  { n: 27, code: '001', text: '請假', action: 'leave', q: ['target'], qDefault: { target: '11/25' } },
  { n: 28, code: '001', text: '下週請假', action: 'leave', q: ['target'], opts: { target: ['12/2', '12/5', '全部'] } },
  { n: 29, code: '002', text: '明天晚上七點那堂請假', action: 'leave', targets: ['11/24 19:00'] },
  { n: 30, code: '002', text: '週二週四都請假', action: 'leave', targets: ['11/24 19:00', '11/26 19:00'] },

  // B. 區間停課
  { n: 31, code: '001', text: '這週都沒辦法上', action: 'stop_range', range: ['11/23', '11/29'] },
  { n: 32, code: '002', text: '下週都要請假', action: 'stop_range', range: ['11/30', '12/6'] },
  { n: 33, code: '001', text: '12/1到12/15先暫停', action: 'stop_range', range: ['12/1', '12/15'] },
  { n: 34, code: '001', text: '12月1日至12月15日停課', action: 'stop_range', range: ['12/1', '12/15'] },
  { n: 35, code: '002', text: '下個月先停課', action: 'stop_range', range: ['12/1', '12/31'] },
  { n: 36, code: '001', text: '段考週停一下', action: 'stop_range', q: ['range'] },
  { n: 37, code: '001', text: '寒假先暫停', action: 'stop_range', q: ['range'] },
  { n: 38, code: '002', text: '要出國兩週，先停兩個禮拜', action: 'stop_range', range: ['11/23', '12/6'] },
  { n: 39, code: '001', text: '接下來兩週都不能上', action: 'stop_range', range: ['11/23', '12/6'] },
  { n: 40, code: '001', text: '12/20開始停到1/5', action: 'stop_range', range: ['2026-12-20', '2027-01-05'] },
  { n: 41, code: '002', text: '這個月剩下的課都先不上', action: 'stop_range', range: ['11/23', '11/30'] },
  { n: 42, code: '001', text: '下週三跟週六都請假', action: 'leave', targets: ['12/2 18:00', '12/5 14:00'] },

  // C. 單次改課
  { n: 43, code: '001', text: '週三的課可以改到週五嗎', action: 'move', targets: ['11/25 18:00'], to: { date: '11/27', start: '18:00', duration: 90 } },
  { n: 44, code: '001', text: '週三改週五晚上七點', action: 'move', targets: ['11/25 18:00'], to: { date: '11/27', start: '19:00' } },
  { n: 45, code: '001', text: '這週六改到週日下午兩點', action: 'move', targets: ['11/28 14:00'], to: { date: '11/29', start: '14:00', duration: 120 } },
  { n: 46, code: '003', text: '今天的課改到明天', action: 'move', targets: ['11/23 17:30'], to: { date: '11/24', start: '17:30' } },
  { n: 47, code: '002', text: '明天可以換到後天嗎', action: 'move', targets: ['11/24 19:00'], to: { date: '11/25', start: '19:00' } },
  { n: 48, code: '002', text: '週四改成週五同一時間', action: 'move', targets: ['11/26 19:00'], to: { date: '11/27', start: '19:00' } },
  { n: 49, code: '001', text: '下週三改到下週四', action: 'move', targets: ['12/2 18:00'], to: { date: '12/3', start: '18:00' } },
  { n: 50, code: '001', text: '11/28的課改到11/29早上10點', action: 'move', targets: ['11/28 14:00'], to: { date: '11/29', start: '10:00' } },
  { n: 51, code: '001', text: '週六改成三點', action: 'move', targets: ['11/28 14:00'], to: { date: '11/28', start: '15:00' } },
  { n: 52, code: '002', text: '明天改八點', action: 'move', targets: ['11/24 19:00'], q: ['to.start'], opts: { 'to.start': ['08:00', '20:00'] } },
  { n: 53, code: '001', text: '週三可以改時間嗎', action: 'move', targets: ['11/25 18:00'], q: ['to'] },
  { n: 54, code: '001', text: '這次能不能改天', action: 'move', targets: ['11/25 18:00'], q: ['to'], optLabels: { to: ['先記請假，之後補課'] } },
  { n: 55, code: '002', text: '禮拜四的課調到禮拜六下午4點', action: 'move', targets: ['11/26 19:00'], to: { date: '11/28', start: '16:00' } },
  { n: 56, code: '001', text: '週三挪到週四晚上6點半', action: 'move', targets: ['11/25 18:00'], to: { date: '11/26', start: '18:30' } },
  { n: 57, code: '003', text: '今天改成晚上7點', action: 'move', targets: ['11/23 17:30'], to: { date: '11/23', start: '19:00' } },

  // D. 永久改課
  { n: 58, code: '002', text: '以後週四都改成週五', action: 'permanent', perm: { slotIds: ['t2b'], wd: 4, start: '19:00', effectiveFrom: '11/23' } },
  { n: 59, code: '001', text: '之後每週三改成晚上7點', action: 'permanent', perm: { slotIds: ['t1a'], wd: 2, start: '19:00', effectiveFrom: '11/23' } },
  { n: 60, code: '001', text: '從下週開始改成每週四晚上6點', action: 'permanent', q: ['permanent.slotIds'], perm: { wd: 3, start: '18:00', effectiveFrom: '11/30' } },
  { n: 61, code: '001', text: '下個月開始週六改到週日', action: 'permanent', perm: { slotIds: ['t1b'], wd: 6, start: '14:00', effectiveFrom: '12/1' } },
  { n: 62, code: '003', text: '以後固定改禮拜二', action: 'permanent', perm: { slotIds: ['t3a'], wd: 1, start: '17:30', effectiveFrom: '11/23' } },
  { n: 63, code: '002', text: '12/1起週二的課固定改成晚上8點', action: 'permanent', perm: { slotIds: ['t2a'], wd: 1, start: '20:00', effectiveFrom: '12/1' } },
  { n: 64, code: '001', text: '以後都改成一次兩小時', action: 'permanent', q: ['permanent.slotIds'], perm: { duration: 120 } },
  { n: 65, code: '002', text: '之後週二週四都改晚上7點半', action: 'permanent', perm: { slotIds: ['t2a', 't2b'], start: '19:30', effectiveFrom: '11/23' } },

  // E. 延後或提早開始
  { n: 66, code: '003', text: '今天晚半小時開始', action: 'shift', targets: ['11/23 17:30'], minutes: 30, to: { start: '18:00' } },
  { n: 67, code: '003', text: '今天可以延後30分鐘嗎', action: 'shift', minutes: 30 },
  { n: 68, code: '002', text: '明天延後一小時', action: 'shift', targets: ['11/24 19:00'], minutes: 60, to: { start: '20:00' } },
  { n: 69, code: '001', text: '週三提早半小時', action: 'shift', targets: ['11/25 18:00'], minutes: -30, to: { start: '17:30' } },
  { n: 70, code: '001', text: '週六提前一個小時', action: 'shift', targets: ['11/28 14:00'], minutes: -60, to: { start: '13:00' } },
  { n: 71, code: '002', text: '明天往後延15分鐘', action: 'shift', minutes: 15, to: { start: '19:15' } },
  { n: 72, code: '001', text: '週三能早一點嗎', action: 'shift', targets: ['11/25 18:00'], q: ['minutes'] },
  { n: 73, code: '003', text: '今天延後一點點', action: 'shift', targets: ['11/23 17:30'], q: ['minutes'] },

  // F. 遲到
  { n: 74, code: '003', text: '今天會晚15分鐘到', action: 'late', targets: ['11/23 17:30'], minutes: 15 },
  { n: 75, code: '003', text: '塞車了會晚點到', action: 'late', targets: ['11/23 17:30'], q: ['minutes'], optLabels: { minutes: ['不確定'] } },
  { n: 76, code: '002', text: '明天遲到半小時', action: 'late', targets: ['11/24 19:00'], minutes: 30 },
  { n: 77, code: '003', text: '補習班下課比較晚，大概晚10分到', action: 'late', targets: ['11/23 17:30'], minutes: 10 },
  { n: 78, code: '001', text: '週三會晚二十分鐘到喔', action: 'late', targets: ['11/25 18:00'], minutes: 20 },

  // G. 延長或縮短
  { n: 79, code: '003', text: '今天可以上兩小時嗎', action: 'duration', targets: ['11/23 17:30'], newDuration: 120 },
  { n: 80, code: '001', text: '週三延長半小時', action: 'duration', targets: ['11/25 18:00'], newDuration: 120 },
  { n: 81, code: '001', text: '週六只能上一個小時', action: 'duration', targets: ['11/28 14:00'], newDuration: 60 },
  { n: 82, code: '002', text: '明天縮短成40分鐘', action: 'duration', newDuration: 40 },
  { n: 83, code: '003', text: '今天要提早下課，上一小時就好', action: 'duration', newDuration: 60 },
  { n: 84, code: '001', text: '週三多上半小時', action: 'duration', newDuration: 120 },
  { n: 85, code: '002', text: '明天上一個半小時', action: 'duration', newDuration: 90 },

  // H. 加課
  { n: 86, code: '001', text: '段考前想多加一堂，週五晚上7點', action: 'add', to: { date: '11/27', start: '19:00', duration: 90 }, subjects: ['數學'] },
  { n: 87, code: '002', text: '下週六下午2點加課', action: 'add', to: { date: '12/5', start: '14:00', duration: 60 } },
  { n: 88, code: '001', text: '這週可以多上一次嗎', action: 'add', q: ['to'] },
  { n: 89, code: '003', text: '12/5早上10點加一堂兩小時', action: 'add', to: { date: '12/5', start: '10:00', duration: 120 } },
  { n: 90, code: '002', text: '週日加開一堂', action: 'add', to: { date: '11/29' }, q: ['to.start'] },
  { n: 91, code: '001', text: '明天晚上7點到9點加課', action: 'add', to: { date: '11/24', start: '19:00', duration: 120 } },
  { n: 92, code: '001', text: '再上一堂，週五六點', action: 'add', to: { date: '11/27', start: '18:00' } },

  // I. 補課（前提：001 有一筆待補的請假 11/18 18:00）
  { n: 93, code: '001', text: '上次請假的補在週日下午3點', action: 'makeup', setup: 'makeupPending', to: { date: '11/29', start: '15:00', duration: 90 } },
  { n: 94, code: '002', text: '補課時間訂週六晚上7點', action: 'makeup', setup: 'makeupPending', to: { date: '11/28', start: '19:00', duration: 60 } },
  { n: 95, code: '001', text: '可以補在下週五嗎', action: 'makeup', setup: 'makeupPending', to: { date: '12/4' }, q: ['to.start'], qDefault: { 'to.start': '18:00' } },
  { n: 96, code: '003', text: '補上次的課，明天五點半', action: 'makeup', setup: 'makeupPending', to: { date: '11/24', start: '17:30', duration: 90 } },
  { n: 97, code: '001', text: '要補課', action: 'makeup', setup: 'makeupPending', q: ['to'] },
  { n: 98, code: '002', text: '把上週請假的補回來，12/3晚上8點', action: 'makeup', setup: 'makeupPending', to: { date: '12/3', start: '20:00' } },

  // J. 取消請假、恢復上課（前提：這些課已經被標記為請假或停課）
  { n: 99, code: '001', text: '週三不用請假了，照常上', action: 'undo', setup: 'marked', targets: ['11/25 18:00'] },
  { n: 100, code: '003', text: '剛剛說的請假取消，今天還是可以上', action: 'undo', setup: 'marked', targets: ['11/23 17:30'] },
  { n: 101, code: '002', text: '明天可以上了', action: 'undo', setup: 'marked', targets: ['11/24 19:00'] },
  { n: 102, code: '001', text: '週六照常', action: 'undo', setup: 'marked', targets: ['11/28 14:00'] },
  { n: 103, code: '002', text: '下週恢復上課', action: 'undo', setup: 'marked', range: ['11/30', '12/6'] },

  // K. 結束課程
  { n: 104, code: '003', text: '下個月開始先不上了', action: 'end', endDate: '11/30' },
  { n: 105, code: '002', text: '這週上完就先停了，謝謝老師', action: 'end', endDate: '11/29' },
  { n: 106, code: '001', text: '12/19是最後一堂', action: 'end', endDate: '12/19' },
  { n: 107, code: '001', text: '之後不繼續上了', action: 'end', q: ['endDate'], qDefault: { endDate: '11/23' } },

  // L. 詢問
  { n: 108, code: '001', text: '這週有上課嗎？', action: 'inquiry', lessons: ['11/25 18:00', '11/28 14:00'] },
  { n: 109, code: '002', text: '下次上課是幾點', action: 'inquiry', lessons: ['11/24 19:00-20:00'] },
  { n: 110, code: '001', text: '週六是幾點開始？', action: 'inquiry', lessons: ['11/28 14:00-16:00'] },
  { n: 111, code: '003', text: '今天有課嗎', action: 'inquiry', lessons: ['11/23 17:30-19:00'] },

  // M. 特殊與不明確的情況
  { n: 112, code: '004', text: '明天請假', error: true },
  { n: 113, code: '001', text: '好的謝謝老師', action: 'unknown', q: ['action'] },
  { n: 114, code: '003', text: '11/16請假', action: 'leave', targets: ['11/16 17:30'], q: ['confirmPast'] },
  { n: 115, code: '001', text: '週三或週六請假一天', action: 'leave', q: ['target'], opts: { target: ['11/25', '11/28'] } },
  { n: 116, code: '002', text: '下週二改', action: 'move', targets: ['12/1 19:00'], q: ['to'] },
  { n: 117, code: '', text: '００１　老師週三請假', action: 'leave', student: '001', targets: ['11/25 18:00'] },
  { n: 118, code: '001', text: '週３請假', action: 'leave', targets: ['11/25 18:00'] },
  { n: 119, code: '001', text: '禮拜天加課下午兩點', action: 'add', to: { date: '11/29', start: '14:00', duration: 90 } },
  { n: 120, code: '002', text: '星期日晚上7點補課', action: 'makeup', to: { date: '11/29', start: '19:00', duration: 60 } },
];

// ---------- 工具 ----------
const iso = (md) => {
  if (/^\d{4}-/.test(md)) return md;
  const [m, d] = md.split('/').map(Number);
  return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const md = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return y === 2026 ? `${m}/${d}` : isoDate;
};

function slotOf(data, slotId) {
  for (const s of data.students) for (const sl of s.slots) if (sl.id === slotId) return sl;
  return null;
}
/** 'slotId@date' → 'M/D HH:MM' */
function keyLabel(data, key) {
  const [slotId, date] = key.split('@');
  return `${md(date)} ${slotOf(data, slotId).start}`;
}
function optionDate(data, v) {
  if (v === 'all') return '全部';
  return md(String(v).split('@')[1]);
}

function run(c) {
  const data = makeData();
  if (c.setup) SETUP[c.setup](data);
  const r = resolveStudent({ code: c.code, text: c.text, students: data.students });
  if (c.error) return { data, r };
  assert.ok(r.student, `找不到學生：${r.error}`);
  const upcomingLessons = getUpcomingLessons(data, r.student.id, NOW.date, null, { includeAll: true });
  const draft = parse(c.text, { now: NOW, student: r.student, students: data.students, upcomingLessons });
  return { data, r, draft };
}

for (const c of CASES) {
  test(`#${c.n} [${c.code || '空白'}] ${c.text}`, () => {
    const { data, r, draft } = run(c);
    if (c.error) {
      assert.equal(r.student, null);
      assert.match(r.error, /找不到代號 004/);
      return;
    }
    if (c.student) assert.equal(r.student.code, c.student);
    const info = `\n  draft: ${JSON.stringify({ ...draft, _lessons: undefined, text: undefined })}`;

    assert.equal(draft.action, c.action, `動作${info}`);
    if (c.targets) assert.deepEqual(draft.targets.map((k) => keyLabel(data, k)), c.targets, `目標${info}`);
    if (c.to) {
      assert.ok(draft.to, `沒有 to${info}`);
      if (c.to.date) assert.equal(draft.to.date, iso(c.to.date), `to.date${info}`);
      if (c.to.start) assert.equal(draft.to.start, c.to.start, `to.start${info}`);
      if (c.to.duration) assert.equal(draft.to.duration, c.to.duration, `to.duration${info}`);
    }
    if (c.minutes !== undefined) assert.equal(draft.minutes, c.minutes, `minutes${info}`);
    if (c.newDuration !== undefined) assert.equal(draft.newDuration, c.newDuration, `newDuration${info}`);
    if (c.range) assert.deepEqual([draft.range?.from, draft.range?.to], c.range.map(iso), `range${info}`);
    if (c.endDate) assert.equal(draft.endDate, iso(c.endDate), `endDate${info}`);
    if (c.subjects) assert.deepEqual(draft.subjects, c.subjects, `subjects${info}`);
    if (c.q) {
      const fields = draft.questions.map((x) => x.field);
      for (const f of c.q) assert.ok(fields.includes(f), `應該追問 ${f}，實際：${fields.join(',')}${info}`);
    } else if (!c.opts) {
      assert.deepEqual(draft.questions.map((x) => x.field), [], `不應該有追問${info}`);
    }
    for (const [field, exp] of Object.entries(c.opts || {})) {
      const qq = draft.questions.find((x) => x.field === field);
      const vals = qq.options.map((o) => (field === 'target' ? optionDate(data, o.value) : o.value));
      assert.deepEqual(vals, exp, `${field} 的選項${info}`);
    }
    for (const [field, labels] of Object.entries(c.optLabels || {})) {
      const qq = draft.questions.find((x) => x.field === field);
      for (const l of labels) assert.ok(qq.options.some((o) => o.label === l), `${field} 應包含選項「${l}」${info}`);
    }
    for (const [field, exp] of Object.entries(c.qDefault || {})) {
      const qq = draft.questions.find((x) => x.field === field);
      const v = field === 'target' ? optionDate(data, qq.default) : field === 'endDate' ? md(qq.default) : qq.default;
      assert.equal(v, exp, `${field} 的預設值${info}`);
    }
    if (c.perm) {
      const p = draft.permanent;
      assert.ok(p, `沒有 permanent${info}`);
      if (c.perm.effectiveFrom) assert.equal(p.effectiveFrom, iso(c.perm.effectiveFrom), `生效日${info}`);
      if (c.perm.slotIds) assert.deepEqual(p.slotIds, c.perm.slotIds, `slotIds${info}`);
      // 新時段：沒有寫的欄位沿用舊時段
      const olds = (c.perm.slotIds || []).map((id) => slotOf(data, id));
      for (const k of ['wd', 'start', 'duration']) {
        if (c.perm[k] === undefined) continue;
        if (olds.length) for (const o of olds) assert.equal(p[k] ?? o[k], c.perm[k], `新時段 ${k}${info}`);
        else assert.equal(p[k], c.perm[k], `新時段 ${k}${info}`);
      }
    }
    if (c.lessons) {
      const got = draft.lessons.map((l) => (c.lessons[0].includes('-') ? `${md(l.date)} ${l.start}-${l.end}` : `${md(l.date)} ${l.start}`));
      assert.deepEqual(got, c.lessons, `詢問結果${info}`);
    }
    assert.ok(draft.summary, '要有判斷結果');
  });
}

test('例句共 120 條', () => {
  assert.equal(CASES.length, 120);
  assert.deepEqual(CASES.map((c) => c.n), Array.from({ length: 120 }, (_, i) => i + 1));
});
