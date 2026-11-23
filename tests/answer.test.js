// 追問回答（applyAnswer）的測試
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeData, NOW } from './fixture.js';
import { parse, applyAnswer } from '../js/parser.js';
import { getUpcomingLessons } from '../js/schedule.js';

function ctx(code) {
  const data = makeData();
  const student = data.students.find((s) => s.code === code);
  return { now: NOW, student, students: data.students, upcomingLessons: getUpcomingLessons(data, student.id, NOW.date, null, { includeAll: true }) };
}
const answer = (d, field, v, c) => applyAnswer(d, d.questions.find((x) => x.field === field).id, v, c);

test('選「全部」→ 兩堂都請假', () => {
  const c = ctx('001');
  const d = answer(parse('下週請假', c), 'target', 'all', c);
  assert.deepEqual(d.targets, ['t1a@2026-12-02', 't1b@2026-12-05']);
  assert.equal(d.questions.length, 0);
  assert.match(d.summary, /待補課 \+2/);
});

test('改天 → 選「先記請假，之後補課」變成請假', () => {
  const c = ctx('001');
  const d = answer(parse('這次能不能改天', c), 'to', 'leave', c);
  assert.equal(d.action, 'leave');
  assert.deepEqual(d.targets, ['t1a@2026-11-25']);
  assert.equal(d.questions.length, 0);
});

test('8 點追問 → 選 20:00', () => {
  const c = ctx('002');
  const d = answer(parse('明天改八點', c), 'to.start', '20:00', c);
  assert.deepEqual(d.to, { date: '2026-11-24', start: '20:00', duration: 60 });
});

test('提早幾分鐘 → 選 −30，算出新開始時間', () => {
  const c = ctx('001');
  const d = answer(parse('週三能早一點嗎', c), 'minutes', -30, c);
  assert.equal(d.minutes, -30);
  assert.equal(d.to.start, '17:30');
});

test('日期已過 → 改成下週', () => {
  const c = ctx('003');
  const d = answer(parse('11/16請假', c), 'confirmPast', '2026-11-23', c);
  assert.deepEqual(d.targets, ['t3a@2026-11-23']);
});

test('看不出意圖 → 指定動作後重新分析', () => {
  const c = ctx('001');
  const d = answer(parse('好的謝謝老師', c), 'action', 'leave', c);
  assert.equal(d.action, 'leave');
  assert.ok(d.questions.some((x) => x.field === 'target'));
});

test('永久改課選時段', () => {
  const c = ctx('001');
  const d = answer(parse('從下週開始改成每週四晚上6點', c), 'permanent.slotIds', 't1a', c);
  assert.deepEqual(d.permanent.slotIds, ['t1a']);
  assert.equal(d.questions.length, 0);
});
