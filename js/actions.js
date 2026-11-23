// 寫入異動（純函式：直接修改傳入的 data 物件，不碰 DOM／localStorage）。
// 課表頁的手動操作和訊息頁的「確認寫入」都用這裡的函式，確保寫入的是同一份資料。
import { uid } from './util.js';
import { addDays, fmtMDW, timeToMin, minToTime } from './dates.js';
import { getLessonsInRange, pendingLeaves } from './schedule.js';

const nowISO = () => new Date().toISOString();

export function isExtraKey(key) {
  return !String(key).includes('@');
}

/** 由 key 找出那一堂課（含已請假、停課、已改走） */
export function findLesson(d, key) {
  if (isExtraKey(key)) {
    const ex = d.extras.find((e) => e.id === key);
    if (!ex) return null;
    return getLessonsInRange(d, ex.date, ex.date, { studentId: ex.studentId }).find((l) => l.key === key) || null;
  }
  const date = key.split('@')[1];
  return getLessonsInRange(d, date, date).find((l) => l.key === key) || null;
}

export function lessonText(l) {
  return `${fmtMDW(l.date)}${l.start}`;
}

function inStopRange(d, studentId, date) {
  return d.stops.some((p) => p.studentId === studentId && p.from <= date && date <= p.to);
}

function log(d, studentId, summary, sourceText = '') {
  d.log.push({ at: nowISO(), studentId, summary, sourceText });
}

function setOverride(d, key, patch, meta = {}) {
  const prev = d.overrides[key] || {};
  const next = { ...prev, ...patch, updatedAt: nowISO() };
  if (meta.note !== undefined) next.note = meta.note;
  if (meta.sourceText) next.sourceText = meta.sourceText;
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  d.overrides[key] = next;
  return next;
}

/** 刪除加課／補課／改課後的新時間，並把關聯恢復 */
function removeExtra(d, ex) {
  d.extras = d.extras.filter((e) => e.id !== ex.id);
  if (ex.kind === 'moved' && ex.fromKey && d.overrides[ex.fromKey]?.movedToExtraId === ex.id) {
    delete d.overrides[ex.fromKey];
  }
  if (ex.kind === 'makeup' && ex.fromKey && d.overrides[ex.fromKey]?.status === 'leave') {
    d.overrides[ex.fromKey].makeupPending = true;
  }
}

/** 某堂固定課如果已經改走，刪掉新位置 */
function clearMove(d, key) {
  const ov = d.overrides[key];
  if (ov && ov.status === 'moved' && ov.movedToExtraId) {
    d.extras = d.extras.filter((e) => e.id !== ov.movedToExtraId);
  }
}

// ---------- 單堂操作 ----------

export function setLeave(d, key, { makeupPending = true, note, sourceText } = {}) {
  const l = findLesson(d, key);
  if (!l) return null;
  if (l.extraId) {
    const ex = d.extras.find((e) => e.id === l.extraId);
    if (ex.kind === 'moved' && ex.fromKey) {
      // 改課後的新時間請假 → 回到原本那堂並標記請假
      d.extras = d.extras.filter((e) => e.id !== ex.id);
      setOverride(d, ex.fromKey, { status: 'leave', makeupPending, movedToExtraId: undefined, start: undefined, duration: undefined }, { note, sourceText });
    } else {
      removeExtra(d, ex);
    }
  } else {
    clearMove(d, key);
    setOverride(d, key, { status: 'leave', makeupPending, movedToExtraId: undefined, start: undefined, duration: undefined, lateMin: undefined }, { note, sourceText });
  }
  const summary = `${lessonText(l)} 請假${makeupPending && !l.extraId ? '（待補課 +1）' : ''}`;
  log(d, l.studentId, summary, sourceText);
  return summary;
}

export function toggleMakeupPending(d, key) {
  const ov = d.overrides[key];
  if (!ov || ov.status !== 'leave') return null;
  ov.makeupPending = !ov.makeupPending;
  ov.updatedAt = nowISO();
  const l = findLesson(d, key);
  const summary = `${lessonText(l)} ${ov.makeupPending ? '改為待補課' : '改為不用補課'}`;
  log(d, l.studentId, summary);
  return summary;
}

/** 改這一次的時間。日期相同時只改開始時間或時長。 */
export function moveLesson(d, key, { date, start, duration }, { note, sourceText } = {}) {
  const l = findLesson(d, key);
  if (!l) return null;
  const dur = duration || l.duration;
  const newDate = date || l.date;
  const newStart = start || l.start;
  let summary;
  if (l.extraId) {
    const ex = d.extras.find((e) => e.id === l.extraId);
    Object.assign(ex, { date: newDate, start: newStart, duration: dur });
    if (sourceText) ex.sourceText = sourceText;
    summary = `${lessonText(l)} 改到 ${fmtMDW(newDate)}${newStart}`;
  } else if (newDate === l.date) {
    clearMove(d, key);
    const slot = findSlot(d, l.slotId);
    const patch = { status: 'changed', start: newStart, duration: dur, movedToExtraId: undefined };
    if (slot && slot.start === newStart && slot.duration === dur) {
      // 回到原本的時間 → 等於恢復
      delete d.overrides[key];
    } else {
      setOverride(d, key, patch, { note, sourceText });
    }
    summary = `${lessonText({ ...l, start: findSlot(d, l.slotId)?.start || l.start })} 改成 ${newStart}–${minToTime(timeToMin(newStart) + dur)}`;
  } else {
    clearMove(d, key);
    const ex = {
      id: uid('e'), studentId: l.studentId, kind: 'moved', date: newDate, start: newStart, duration: dur,
      subjects: [...(l.subjects || [])], fromKey: key, lateMin: null, note: note || '', sourceText: sourceText || '',
    };
    d.extras.push(ex);
    setOverride(d, key, { status: 'moved', movedToExtraId: ex.id, start: undefined, duration: undefined }, { note, sourceText });
    summary = `${lessonText(l)} 改到 ${fmtMDW(newDate)}${newStart}`;
  }
  log(d, l.studentId, summary, sourceText);
  return summary;
}

/** 改開始時間及／或時長（延後、提早、延長、縮短） */
export function changeLesson(d, key, { start, duration }, { note, sourceText, label } = {}) {
  const l = findLesson(d, key);
  if (!l) return null;
  const newStart = start || l.start;
  const newDur = duration || l.duration;
  if (l.extraId) {
    const ex = d.extras.find((e) => e.id === l.extraId);
    ex.start = newStart;
    ex.duration = newDur;
  } else {
    const slot = findSlot(d, l.slotId);
    if (slot && slot.start === newStart && slot.duration === newDur && d.overrides[key]?.status === 'changed') {
      const { lateMin } = d.overrides[key];
      delete d.overrides[key];
      if (lateMin != null) setOverride(d, key, { status: 'normal', lateMin });
    } else {
      setOverride(d, key, { status: 'changed', start: newStart, duration: newDur }, { note, sourceText });
    }
  }
  const summary = `${lessonText(l)} ${label || '改為'} ${newStart}–${minToTime(timeToMin(newStart) + newDur)}`;
  log(d, l.studentId, summary, sourceText);
  return summary;
}

export function setLate(d, key, lateMin, { sourceText } = {}) {
  const l = findLesson(d, key);
  if (!l) return null;
  const ov = d.overrides[key];
  if (l.extraId) {
    d.extras.find((e) => e.id === l.extraId).lateMin = lateMin;
  } else if (lateMin == null) {
    if (ov) {
      delete ov.lateMin;
      // 只為了遲到才建立的 normal override，清掉遲到後就不需要了（停課區間內的 normal 要保留）
      if (ov.status === 'normal' && !inStopRange(d, l.studentId, l.date)) delete d.overrides[key];
    }
  } else {
    // lateMin 為 0 代表「會晚到，分鐘數不確定」
    setOverride(d, key, { status: ov?.status || 'normal', lateMin }, { sourceText });
  }
  const summary = lateMin == null ? `${lessonText(l)} 取消遲到標記`
    : lateMin === 0 ? `${lessonText(l)} 會晚到` : `${lessonText(l)} 晚到 ${lateMin} 分`;
  log(d, l.studentId, summary, sourceText);
  return summary;
}

/** 恢復原狀：清掉這堂的 override；加課／補課則刪除這堂 */
export function restoreLesson(d, key) {
  const l = findLesson(d, key);
  if (!l) return null;
  let summary;
  if (l.extraId) {
    const ex = d.extras.find((e) => e.id === l.extraId);
    removeExtra(d, ex);
    summary = ex.kind === 'moved' ? `${lessonText(l)}（改課）取消，恢復原本時間` : `刪除 ${lessonText(l)} 的${ex.kind === 'makeup' ? '補課' : '加課'}`;
  } else {
    clearMove(d, key);
    delete d.overrides[key];
    summary = `${lessonText({ ...l, start: findSlot(d, l.slotId)?.start || l.start })} 恢復原狀`;
  }
  log(d, l.studentId, summary);
  return summary;
}

/** 取消請假或停課，讓這堂照常上 */
export function undoLesson(d, key, { sourceText } = {}) {
  const l = findLesson(d, key);
  if (!l) return null;
  if (l.extraId) return null;
  const ov = d.overrides[key];
  const inStop = inStopRange(d, l.studentId, l.date);
  clearMove(d, key);
  if (inStop) {
    d.overrides[key] = { status: 'normal', updatedAt: nowISO(), ...(sourceText ? { sourceText } : {}) };
  } else if (ov) {
    delete d.overrides[key];
  }
  const summary = `${lessonText({ ...l, start: findSlot(d, l.slotId)?.start || l.start })} 照常上課`;
  log(d, l.studentId, summary, sourceText);
  return summary;
}

// ---------- 新增課程 ----------

/** 加課或補課。補課會自動對應最早一筆還沒補的請假。 */
export function addExtra(d, { studentId, kind, date, start, duration, subjects, note = '', sourceText = '' }) {
  const st = d.students.find((s) => s.id === studentId);
  const first = st?.slots?.[0];
  const ex = {
    id: uid('e'), studentId, kind, date, start,
    duration: duration || first?.duration || 60,
    subjects: subjects && subjects.length ? subjects : [...(first?.subjects || [])],
    fromKey: null, lateMin: null, note, sourceText,
  };
  let matched = '';
  if (kind === 'makeup') {
    const pend = pendingLeaves(d, studentId)[0];
    if (pend) {
      ex.fromKey = pend;
      d.overrides[pend].makeupPending = false;
      d.overrides[pend].updatedAt = nowISO();
      const [, pdate] = pend.split('@');
      matched = `（補 ${fmtMDW(pdate)} 的請假）`;
    }
  }
  d.extras.push(ex);
  const summary = `${kind === 'makeup' ? '補課' : '加課'} ${fmtMDW(date)}${start}–${minToTime(timeToMin(start) + ex.duration)}${matched}`;
  log(d, studentId, summary, sourceText);
  return summary;
}

// ---------- 區間 ----------

export function addStop(d, { studentId, from, to, note = '', sourceText = '' }) {
  d.stops.push({ id: uid('p'), studentId, from, to, note });
  const summary = `停課 ${fmtMDW(from)}～${fmtMDW(to)}${note ? `（${note}）` : ''}`;
  log(d, studentId, summary, sourceText);
  return summary;
}

/** 恢復上課：把停課區間扣掉 [from, to]（整段被涵蓋就刪除，部分重疊就縮短或拆成兩段），並取消區間內的請假 */
export function resumeRange(d, { studentId, from, to, sourceText = '' }) {
  const next = [];
  for (const p of d.stops) {
    if (p.studentId !== studentId || p.to < from || p.from > to) { next.push(p); continue; }
    if (p.from < from) next.push({ ...p, id: uid('p'), to: addDays(from, -1) });
    if (p.to > to) next.push({ ...p, id: uid('p'), from: addDays(to, 1) });
  }
  d.stops = next;
  for (const l of getLessonsInRange(d, from, to, { studentId })) {
    if (l.extraId) continue;
    const ov = d.overrides[l.key];
    if (ov && (ov.status === 'leave' || ov.status === 'normal')) delete d.overrides[l.key];
  }
  const summary = `${fmtMDW(from)}～${fmtMDW(to)} 恢復上課`;
  log(d, studentId, summary, sourceText);
  return summary;
}

// ---------- 固定時段 ----------

export function findSlot(d, slotId) {
  for (const s of d.students) for (const sl of s.slots) if (sl.id === slotId) return sl;
  return null;
}

/**
 * 永久改課：舊時段的 validTo 設為生效日前一天，再新增一個 validFrom 為生效日的新時段。
 * change：{ wd?, start?, duration? }（沒給的沿用舊時段）
 */
export function permanentChange(d, studentId, slotIds, change, effectiveFrom, { sourceText = '' } = {}) {
  const st = d.students.find((s) => s.id === studentId);
  const parts = [];
  for (const slotId of slotIds) {
    const old = st.slots.find((s) => s.id === slotId);
    if (!old) continue;
    const nu = {
      ...old,
      id: uid('t'),
      wd: change.wd ?? old.wd,
      start: change.start ?? old.start,
      duration: change.duration ?? old.duration,
      subjects: [...(old.subjects || [])],
      validFrom: effectiveFrom,
      validTo: old.validTo,
    };
    if (old.validFrom && old.validFrom >= effectiveFrom) {
      // 舊時段還沒開始 → 直接修改
      Object.assign(old, { wd: nu.wd, start: nu.start, duration: nu.duration });
    } else {
      old.validTo = addDays(effectiveFrom, -1);
      st.slots.push(nu);
      // 生效日之後的異動：星期不變就搬到新時段，否則刪除（那些課已不存在）
      for (const key of Object.keys(d.overrides)) {
        const [sid, date] = key.split('@');
        if (sid !== slotId || date < effectiveFrom) continue;
        const ov = d.overrides[key];
        delete d.overrides[key];
        if (nu.wd === old.wd) {
          if (ov.status === 'changed' && ov.start === nu.start && ov.duration === nu.duration) continue;
          d.overrides[`${nu.id}@${date}`] = ov;
          const ex = ov.movedToExtraId && d.extras.find((e) => e.id === ov.movedToExtraId);
          if (ex) ex.fromKey = `${nu.id}@${date}`;
        } else if (ov.movedToExtraId) {
          d.extras = d.extras.filter((e) => e.id !== ov.movedToExtraId);
        }
      }
    }
    parts.push(`${slotDesc(old, true)} → ${slotDesc(nu)}`);
  }
  const summary = `永久改課：${parts.join('；')}，${fmtMDW(effectiveFrom)}起生效`;
  log(d, studentId, summary, sourceText);
  return summary;
}

function slotDesc(s, original = false) {
  const WD = ['一', '二', '三', '四', '五', '六', '日'];
  return `週${WD[s.wd]} ${s.start}${original ? '' : `（${s.duration} 分）`}`;
}

/** 結束課程：所有時段的 validTo 設為 endDate */
export function endCourse(d, studentId, endDate, { sourceText = '' } = {}) {
  const st = d.students.find((s) => s.id === studentId);
  for (const sl of st.slots) {
    if (!sl.validTo || sl.validTo > endDate) sl.validTo = endDate;
  }
  const summary = `結束課程，最後一天 ${fmtMDW(endDate)}`;
  log(d, studentId, summary, sourceText);
  return summary;
}
