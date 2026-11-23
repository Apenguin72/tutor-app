// 把分析結果（Draft）寫入資料（純函式：直接修改傳入的 data）
import * as A from './actions.js';
import { timeToMin, minToTime } from './dates.js';

/** 檢查 Draft 是否可以寫入；回傳缺少的說明，沒問題回傳 null */
export function missingFor(draft) {
  if (draft.questions && draft.questions.length) return '請先回答上面的問題';
  const t = draft.targets || [];
  const to = draft.to || {};
  switch (draft.action) {
    case 'leave': return t.length ? null : '請選擇要請假的課';
    case 'undo': return draft.range || t.length ? null : '請選擇要恢復的課';
    case 'stop_range': return draft.range?.from && draft.range?.to ? (draft.range.from <= draft.range.to ? null : '起始日期不能晚於結束日期') : '請選擇停課區間';
    case 'move': return !t.length ? '請選擇原本那堂' : to.date && to.start ? null : '請填新的日期和時間';
    case 'shift': return !t.length ? '請選擇是哪一堂' : draft.minutes ? null : '請填要延後或提早幾分鐘';
    case 'late': return !t.length ? '請選擇是哪一堂' : draft.minutes != null ? null : '請填遲到幾分鐘';
    case 'duration': return !t.length ? '請選擇是哪一堂' : draft.newDuration > 0 ? null : '請填改成上多久';
    case 'add':
    case 'makeup': return to.date && to.start ? null : '請填日期和時間';
    case 'permanent': {
      const p = draft.permanent;
      if (!p || !p.slotIds.length) return '請選擇要改的固定時段';
      if (p.wd == null && !p.start && !p.duration) return '請填要改成星期幾、幾點或多久';
      return p.effectiveFrom ? null : '請填生效日';
    }
    case 'end': return draft.endDate ? null : '請填最後一天';
    case 'inquiry': return '詢問不需要寫入';
    default: return '請選擇動作';
  }
}

/** 寫入資料，回傳每一筆的摘要 */
export function commitDraft(d, draft) {
  const src = { sourceText: draft.text || '' };
  const out = [];
  const push = (s) => { if (s) out.push(s); };
  const sid = draft.studentId;
  switch (draft.action) {
    case 'leave':
      for (const k of draft.targets) push(A.setLeave(d, k, { makeupPending: true, ...src }));
      break;
    case 'undo':
      if (draft.range) push(A.resumeRange(d, { studentId: sid, ...draft.range, ...src }));
      else for (const k of draft.targets) push(A.undoLesson(d, k, src));
      break;
    case 'stop_range':
      push(A.addStop(d, { studentId: sid, from: draft.range.from, to: draft.range.to, ...src }));
      break;
    case 'move':
      push(A.moveLesson(d, draft.targets[0], draft.to, src));
      break;
    case 'shift':
      for (const k of draft.targets) {
        const l = A.findLesson(d, k);
        if (!l) continue;
        const m = draft.minutes;
        push(A.changeLesson(d, k, { start: minToTime(timeToMin(l.start) + m) }, { ...src, label: m > 0 ? `延後 ${m} 分，改為` : `提早 ${-m} 分，改為` }));
      }
      break;
    case 'late':
      for (const k of draft.targets) push(A.setLate(d, k, draft.minutes, src));
      break;
    case 'duration':
      for (const k of draft.targets) {
        const l = A.findLesson(d, k);
        if (!l) continue;
        push(A.changeLesson(d, k, { duration: draft.newDuration }, { ...src, label: draft.newDuration > l.duration ? '延長為' : '縮短為' }));
      }
      break;
    case 'add':
    case 'makeup':
      push(A.addExtra(d, { studentId: sid, kind: draft.action, ...draft.to, subjects: draft.subjects, ...src }));
      break;
    case 'permanent': {
      const p = draft.permanent;
      const change = {};
      if (p.wd != null) change.wd = p.wd;
      if (p.start) change.start = p.start;
      if (p.duration) change.duration = p.duration;
      push(A.permanentChange(d, sid, p.slotIds, change, p.effectiveFrom, src));
      break;
    }
    case 'end':
      push(A.endCourse(d, sid, draft.endDate, src));
      break;
    default:
      break;
  }
  return out;
}
