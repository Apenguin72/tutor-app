// 由固定課表與異動算出某一週的課（純函式，不碰 DOM／localStorage）
import { addDays, weekday, timeToMin, minToTime, fmtMD, WD_NAMES } from './dates.js';

/** 某個固定時段在某天是否有效 */
export function slotActiveOn(slot, date) {
  if (slot.validFrom && date < slot.validFrom) return false;
  if (slot.validTo && date > slot.validTo) return false;
  return true;
}

/** 目前（含未來）仍有效的時段：validTo 為空或 >= today */
export function currentSlots(student, today) {
  return (student.slots || []).filter((s) => !s.validTo || s.validTo >= today);
}

export function slotLabel(slot) {
  return `週${WD_NAMES[slot.wd]} ${slot.start}-${minToTime(timeToMin(slot.start) + slot.duration)}`;
}

/** 找出日期是否落在學生的停課區間 */
function inStop(data, studentId, date) {
  return data.stops.some((p) => p.studentId === studentId && p.from <= date && date <= p.to);
}

function baseKey(slotId, date) {
  return `${slotId}@${date}`;
}

/**
 * 回傳 [from, to] 日期區間（含）內所有的課，依日期、時間排序。
 * 輸出：{ key, studentId, code, name, date, start, end, duration, subjects, status, kind, lateMin, note, ... }
 */
export function getLessonsInRange(data, from, to, { studentId = null } = {}) {
  const out = [];
  const students = studentId ? data.students.filter((s) => s.id === studentId) : data.students;
  const byId = new Map(data.students.map((s) => [s.id, s]));

  for (const st of students) {
    for (const slot of st.slots || []) {
      // 找出區間內所有 wd 相同的日期
      let d = addDays(from, (slot.wd - weekday(from) + 7) % 7);
      for (; d <= to; d = addDays(d, 7)) {
        if (!slotActiveOn(slot, d)) continue;
        const key = baseKey(slot.id, d);
        const ov = data.overrides[key] || null;
        const lesson = {
          key,
          slotId: slot.id,
          studentId: st.id,
          code: st.code,
          name: st.name,
          date: d,
          start: slot.start,
          duration: slot.duration,
          subjects: slot.subjects || [],
          status: 'normal',
          kind: 'base',
          lateMin: null,
          note: '',
          makeupPending: false,
          movedTo: null,
          override: ov,
        };
        if (inStop(data, st.id, d) && !(ov && ov.status === 'normal')) lesson.status = 'stop';
        if (ov) {
          if (ov.status === 'leave') {
            lesson.status = 'leave';
            lesson.makeupPending = !!ov.makeupPending;
          } else if (ov.status === 'moved') {
            lesson.status = 'moved';
            const ex = data.extras.find((e) => e.id === ov.movedToExtraId);
            if (ex) lesson.movedTo = { date: ex.date, start: ex.start, extraId: ex.id };
          } else if (ov.status === 'changed') {
            if (lesson.status !== 'stop') lesson.status = 'changed';
            if (ov.start) lesson.start = ov.start;
            if (ov.duration) lesson.duration = ov.duration;
          }
          if (ov.lateMin != null) lesson.lateMin = ov.lateMin;
          if (ov.note) lesson.note = ov.note;
        }
        lesson.end = minToTime(timeToMin(lesson.start) + lesson.duration);
        out.push(lesson);
      }
    }
  }

  for (const ex of data.extras) {
    if (studentId && ex.studentId !== studentId) continue;
    if (ex.date < from || ex.date > to) continue;
    const st = byId.get(ex.studentId);
    if (!st) continue;
    out.push({
      key: ex.id,
      extraId: ex.id,
      studentId: st.id,
      code: st.code,
      name: st.name,
      date: ex.date,
      start: ex.start,
      duration: ex.duration,
      end: minToTime(timeToMin(ex.start) + ex.duration),
      subjects: ex.subjects || [],
      status: 'normal',
      kind: ex.kind,
      lateMin: ex.lateMin ?? null,
      note: ex.note || '',
      fromKey: ex.fromKey || null,
    });
  }

  out.sort((a, b) => (a.date === b.date ? timeToMin(a.start) - timeToMin(b.start) : a.date < b.date ? -1 : 1));
  return out;
}

/** 這一週（weekMonday 起 7 天）所有的課 */
export function getLessons(data, weekMonday) {
  return getLessonsInRange(data, weekMonday, addDays(weekMonday, 6));
}

/** 某個學生從 fromDate 起接下來的 n 堂「會上的」課（排除請假、停課、已改走） */
export function getUpcomingLessons(data, studentId, fromDate, n = 4, { weeks = 8, includeAll = false } = {}) {
  const list = getLessonsInRange(data, fromDate, addDays(fromDate, weeks * 7 - 1), { studentId });
  const filtered = includeAll ? list : list.filter((l) => l.status !== 'leave' && l.status !== 'stop' && l.status !== 'moved');
  return n == null ? filtered : filtered.slice(0, n);
}

/** 待補課的請假（依日期排序） */
export function pendingLeaves(data, studentId) {
  const slotIds = new Set((data.students.find((s) => s.id === studentId)?.slots || []).map((s) => s.id));
  return Object.entries(data.overrides)
    .filter(([key, ov]) => ov.status === 'leave' && ov.makeupPending && slotIds.has(key.split('@')[0]))
    .map(([key]) => key)
    .sort((a, b) => (a.split('@')[1] < b.split('@')[1] ? -1 : 1));
}

export function lessonLabel(l) {
  return `${fmtMD(l.date)}（${WD_NAMES[weekday(l.date)]}）${l.start}`;
}
