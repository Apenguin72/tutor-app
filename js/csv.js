// 學生名單 CSV（純函式）
import { currentSlots, slotLabel } from './schedule.js';

export const CSV_HEADERS = ['代號', '學生姓名', '家長姓名', '電話', '年級', '地址', '科目', '每週上課時間', '費用', '備註'];

/** 開頭是 0 的純數字（代號、電話）用 ="..." 包起來，避免 Excel 吃掉前導 0 */
function keepText(v) {
  const s = String(v ?? '');
  return /^0[\d-]*$/.test(s) ? `="${s}"` : s;
}

function cell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function studentSubjects(student, today) {
  const set = new Set();
  for (const sl of currentSlots(student, today)) for (const sub of sl.subjects || []) set.add(sub);
  return [...set];
}

export function feeLabel(st) {
  if (st.fee == null || st.fee === '') return '';
  return `${st.fee}${st.feeUnit === 'lesson' ? '/堂' : '/小時'}`;
}

/** 回傳含 BOM 的 CSV 字串 */
export function buildStudentsCSV(data, today) {
  const rows = [CSV_HEADERS];
  const students = [...data.students].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hant', { numeric: true }));
  for (const st of students) {
    // 「目前有效」：今天落在 validFrom～validTo 之間
    const slots = currentSlots(st, today)
      .filter((s) => !s.validFrom || s.validFrom <= today)
      .sort((a, b) => a.wd - b.wd || a.start.localeCompare(b.start));
    rows.push([
      keepText(st.code), st.name, st.parentName, keepText(st.phone), st.grade, st.address,
      studentSubjects(st, today).join('、'),
      slots.map(slotLabel).join('；'),
      feeLabel(st),
      st.note,
    ]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
