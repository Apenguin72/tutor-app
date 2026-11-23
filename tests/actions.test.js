// 課表計算與異動寫入的測試：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeData } from './fixture.js';
import { getLessons, getUpcomingLessons, pendingLeaves } from '../js/schedule.js';
import * as A from '../js/actions.js';

const W = '2026-11-23';
const find = (d, key) => getLessons(d, W).concat(getLessons(d, '2026-11-30')).find((l) => l.key === key);

test('getLessons：固定課表展開成本週的課', () => {
  const d = makeData();
  const list = getLessons(d, W);
  assert.deepEqual(list.map((l) => `${l.code} ${l.date} ${l.start}-${l.end}`), [
    '003 2026-11-23 17:30-19:00',
    '002 2026-11-24 19:00-20:00',
    '001 2026-11-25 18:00-19:30',
    '002 2026-11-26 19:00-20:00',
    '001 2026-11-28 14:00-16:00',
  ]);
});

test('validFrom／validTo 限制時段有效期間', () => {
  const d = makeData();
  d.students[0].slots[0].validTo = '2026-11-24';
  d.students[0].slots[1].validFrom = '2026-11-29';
  assert.equal(getLessons(d, W).filter((l) => l.code === '001').length, 0);
});

test('請假、待補課、補課自動對應最早的請假', () => {
  const d = makeData();
  A.setLeave(d, 't1a@2026-11-25');
  A.setLeave(d, 't1b@2026-11-28');
  assert.equal(find(d, 't1a@2026-11-25').status, 'leave');
  assert.deepEqual(pendingLeaves(d, 's1'), ['t1a@2026-11-25', 't1b@2026-11-28']);
  A.addExtra(d, { studentId: 's1', kind: 'makeup', date: '2026-11-29', start: '15:00' });
  const ex = d.extras[0];
  assert.equal(ex.fromKey, 't1a@2026-11-25');
  assert.equal(ex.duration, 90);
  assert.deepEqual(ex.subjects, ['數學']);
  assert.deepEqual(pendingLeaves(d, 's1'), ['t1b@2026-11-28']);
  // 刪除補課 → 那筆請假恢復待補
  A.restoreLesson(d, ex.id);
  assert.equal(pendingLeaves(d, 's1').length, 2);
  assert.equal(d.log.length, 4);
});

test('改課到別天：原位置 moved，新位置是 extras(kind=moved)；恢復原狀會刪掉新位置', () => {
  const d = makeData();
  A.moveLesson(d, 't1a@2026-11-25', { date: '2026-11-27', start: '19:00' });
  const orig = find(d, 't1a@2026-11-25');
  assert.equal(orig.status, 'moved');
  assert.deepEqual(orig.movedTo, { date: '2026-11-27', start: '19:00', extraId: d.extras[0].id });
  const nu = getLessons(d, W).find((l) => l.kind === 'moved');
  assert.equal(nu.date, '2026-11-27');
  assert.equal(nu.duration, 90);
  A.restoreLesson(d, 't1a@2026-11-25');
  assert.equal(d.extras.length, 0);
  assert.equal(find(d, 't1a@2026-11-25').status, 'normal');
});

test('同一天改時間 → changed；改回原時間 → 清掉 override', () => {
  const d = makeData();
  A.moveLesson(d, 't1b@2026-11-28', { date: '2026-11-28', start: '15:00' });
  const l = find(d, 't1b@2026-11-28');
  assert.equal(l.status, 'changed');
  assert.equal(l.start, '15:00');
  assert.equal(l.end, '17:00');
  A.moveLesson(d, 't1b@2026-11-28', { date: '2026-11-28', start: '14:00' });
  assert.equal(d.overrides['t1b@2026-11-28'], undefined);
});

test('延長、延後、遲到', () => {
  const d = makeData();
  A.changeLesson(d, 't3a@2026-11-23', { duration: 120 });
  A.changeLesson(d, 't3a@2026-11-23', { start: '18:00' });
  A.setLate(d, 't3a@2026-11-23', 15);
  const l = find(d, 't3a@2026-11-23');
  assert.equal(l.start, '18:00');
  assert.equal(l.duration, 120);
  assert.equal(l.lateMin, 15);
  assert.equal(l.status, 'changed');
  A.setLate(d, 't2a@2026-11-24', 10);
  assert.equal(find(d, 't2a@2026-11-24').status, 'normal');
  A.setLate(d, 't2a@2026-11-24', null);
  assert.equal(d.overrides['t2a@2026-11-24'], undefined);
});

test('區間停課、單堂照常上、恢復上課（裁切區間）', () => {
  const d = makeData();
  A.addStop(d, { studentId: 's2', from: '2026-11-23', to: '2026-12-13' });
  assert.equal(find(d, 't2a@2026-11-24').status, 'stop');
  A.undoLesson(d, 't2b@2026-11-26');
  assert.equal(find(d, 't2b@2026-11-26').status, 'normal');
  A.resumeRange(d, { studentId: 's2', from: '2026-11-30', to: '2026-12-06' });
  assert.deepEqual(d.stops.map((p) => [p.from, p.to]), [['2026-11-23', '2026-11-29'], ['2026-12-07', '2026-12-13']]);
  assert.equal(find(d, 't2a@2026-12-01').status, 'normal');
  A.resumeRange(d, { studentId: 's2', from: '2026-11-01', to: '2026-12-31' });
  assert.equal(d.stops.length, 0);
});

test('永久改課：舊時段 validTo＝生效日前一天，新增新時段；同星期的異動搬過去', () => {
  const d = makeData();
  A.setLeave(d, 't1a@2026-12-09');
  A.permanentChange(d, 's1', ['t1a'], { start: '19:00' }, '2026-11-30');
  const st = d.students[0];
  assert.equal(st.slots[0].validTo, '2026-11-29');
  const nu = st.slots[2];
  assert.equal(nu.validFrom, '2026-11-30');
  assert.equal(nu.start, '19:00');
  assert.equal(getLessons(d, W).find((l) => l.code === '001' && l.date === '2026-11-25').start, '18:00');
  assert.equal(getLessons(d, '2026-11-30').find((l) => l.code === '001' && l.date === '2026-12-02').start, '19:00');
  assert.ok(d.overrides[`${nu.id}@2026-12-09`]);
  assert.equal(d.overrides['t1a@2026-12-09'], undefined);
});

test('結束課程與 getUpcomingLessons', () => {
  const d = makeData();
  A.endCourse(d, 's1', '2026-11-29');
  assert.equal(getUpcomingLessons(d, 's1', '2026-11-23', 10).length, 2);
  A.setLeave(d, 't1a@2026-11-25');
  assert.deepEqual(getUpcomingLessons(d, 's1', '2026-11-23', 10).map((l) => l.date), ['2026-11-28']);
});
