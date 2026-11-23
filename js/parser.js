// 訊息分析引擎（純函式：不碰 DOM／localStorage，「現在時間」由參數傳入）
//
// parse(text, { now, student, students, upcomingLessons }) → Draft
// resolveStudent({ code, text, students }) → { student, error, matchedText }
// applyAnswer(draft, questionId, value, ctx) → 新的 Draft
import { toHalfWidth, normalizeCode } from './util.js';
import {
  addDays, weekday, mondayOf, endOfMonth, firstOfNextMonth, parseISO, toISO,
  isValidDate, diffDays, fmtMD, fmtMDW, timeToMin, minToTime, WD_NAMES,
} from './dates.js';

// ============================================================
// 學生
// ============================================================

/** 依代號找學生；代號空白時從訊息裡找代號、學生姓名或家長姓名 */
export function resolveStudent({ code, text, students }) {
  const c = normalizeCode(code);
  if (c) {
    const st = students.find((s) => s.code === c);
    return st ? { student: st } : { student: null, error: `找不到代號 ${c}，請先到「學生」新增`, code: c };
  }
  const t = toHalfWidth(text || '');
  const byCode = students.filter((s) => s.code && new RegExp(`(?<![\\d/:.])${escapeRe(s.code)}(?![\\d/:.])`).test(t));
  if (byCode.length === 1) return { student: byCode[0], matchedText: byCode[0].code };
  const byName = students.filter((s) => {
    const names = [s.name, s.name && s.name.length >= 3 ? s.name.slice(1) : null, s.parentName].filter((n) => n && n.length >= 2);
    return names.some((n) => t.includes(n));
  });
  if (byName.length === 1) return { student: byName[0] };
  if (byCode.length > 1 || byName.length > 1) {
    return { student: null, error: '訊息裡提到不只一位學生，請輸入學生代號', candidates: byCode.length > 1 ? byCode : byName };
  }
  return { student: null, error: '請輸入學生代號，或在訊息裡寫出代號或姓名' };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// 前處理
// ============================================================

const WD_CHAR = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnToNumber(s) {
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    const tens = a ? cnToNumber(a) : 1;
    const ones = b ? cnToNumber(b) : 0;
    return tens * 10 + ones;
  }
  return Number([...s].map((c) => CN_DIGIT[c]).join(''));
}

export function preprocess(raw) {
  let t = toHalfWidth(raw).replace(/[\r\n]+/g, '，').replace(/\s+/g, ' ');
  // 1. 星期說法先標記成〔W0〕～〔W6〕（0＝一），避免被中文數字轉換掉
  t = t.replace(/(?:週|周|星期|禮拜|礼拜)([一二三四五六日天1-7])(?![次堂])/g, (m, c) => `〔W${WD_CHAR[c]}〕`);
  // 「早一點」「延後一點點」是「一些」，不是一點鐘
  t = t.replace(/(早|晚|後|前|慢|快)(?:一|1)點點?(?![半\d])/g, '$1些');
  // 2. 中文數字轉阿拉伯數字
  t = t.replace(/[零〇一二兩三四五六七八九十]+/g, (m) => String(cnToNumber(m)));
  // 3. 去掉語助詞和稱呼
  t = t.replace(/老師|謝謝|謝啦|感謝|喔|哦|唷|呦|哈+|啦|耶|嗯/g, '');
  t = t.replace(/~+(?![\d〔])/g, '');
  return t.trim();
}

// ============================================================
// 日期
// ============================================================

function weekdayDate(today, wd, prefix) {
  const mon = mondayOf(today);
  if (!prefix) return addDays(today, (wd - weekday(today) + 7) % 7);
  if (prefix.startsWith('下下')) return addDays(mon, 14 + wd);
  if (prefix.startsWith('下')) return addDays(mon, 7 + wd);
  return addDays(mon, wd); // 這、本、這個
}

function monthDayDate(today, m, d) {
  const { y } = parseISO(today);
  if (!isValidDate(y, m, d)) return null;
  let iso = toISO(y, m, d);
  if (diffDays(today, iso) >= 30) iso = toISO(y + 1, m, d);
  return iso;
}

function dayOnlyDate(today, d) {
  const { y, m, d: td } = parseISO(today);
  if (d >= td && isValidDate(y, m, d)) return toISO(y, m, d);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return isValidDate(ny, nm, d) ? toISO(ny, nm, d) : null;
}

/**
 * 找出所有日期說法：
 * kind: date（單一日期）| range（區間）| next（下一堂）| weekend | vague（段考、寒假…）| ignore（上次、上週）
 */
export function extractDates(t, today) {
  const marks = [];
  const used = new Array(t.length).fill(false);
  const take = (re, fn) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const s = m.index, e = s + m[0].length;
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (used.slice(s, e).some(Boolean)) continue;
      const mark = fn(m);
      if (!mark) continue;
      for (let i = s; i < e; i++) used[i] = true;
      marks.push({ pos: s, end: e, text: m[0], ...mark });
    }
  };
  const mon = mondayOf(today);

  take(/上(?:次|週|周|禮拜|星期|個禮拜)|剛剛|剛才|昨天|前天/g, () => ({ kind: 'ignore' }));
  take(/這個?月剩下的?|這個?月底前/g, () => ({ kind: 'range', from: today, to: endOfMonth(today), sub: 'monthrest' }));
  take(/下個?月/g, () => {
    const from = firstOfNextMonth(today);
    return { kind: 'range', from, to: endOfMonth(from), sub: 'month' };
  });
  take(/(\d{1,2})(?:\/|月)(\d{1,2})(?:日|號)?/g, (m) => {
    const date = monthDayDate(today, Number(m[1]), Number(m[2]));
    return date && { kind: 'date', date };
  });
  take(/(?<![\d/月:])(\d{1,2})(?:號|日)/g, (m) => {
    const date = dayOnlyDate(today, Number(m[1]));
    return date && { kind: 'date', date };
  });
  take(/大後天|後天|明天|明日|明晚|今天|今日|今晚/g, (m) => {
    const off = { 大後天: 3, 後天: 2, 明天: 1, 明日: 1, 明晚: 1, 今天: 0, 今日: 0, 今晚: 0 }[m[0]];
    return { kind: 'date', date: addDays(today, off), evening: /晚/.test(m[0]) };
  });
  take(/(下下個?|下個?|這個?|本)?〔W(\d)〕/g, (m) => {
    const wd = Number(m[2]);
    return { kind: 'date', wd, prefix: m[1] || '', date: weekdayDate(today, wd, m[1] || '') };
  });
  take(/這次|這堂|下次|下1堂|下堂/g, () => ({ kind: 'next' }));
  take(/(下下|下個?|這個?|本)(?:週|周|禮拜|星期)/g, (m) => {
    const off = m[1].startsWith('下下') ? 14 : m[1].startsWith('下') ? 7 : 0;
    return { kind: 'range', from: addDays(mon, off), to: addDays(mon, off + 6), sub: 'week' };
  });
  take(/(?:接下來|未來|之後的?)?(\d+)個?(?:週|周|禮拜|星期)/g, (m) => {
    const n = Number(m[1]);
    return { kind: 'range', from: today, to: addDays(today, n * 7 - 1), sub: 'weeks', weeks: n };
  });
  take(/週末|周末/g, () => ({ kind: 'weekend', dates: [addDays(mon, 5), addDays(mon, 6)] }));
  take(/段考週?|期中考|期末考|寒假|暑假/g, () => ({ kind: 'vague' }));

  marks.sort((a, b) => a.pos - b.pos);

  // 星期沿用前綴：「下週三跟週六」的週六沿用「下週」
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1], b = marks[i];
    if (a.wd != null && b.wd != null && a.prefix && !b.prefix) {
      const gap = t.slice(a.end, b.pos);
      if (/^(跟|和|、|還有|及|與|,|，)?$/.test(gap)) {
        b.prefix = a.prefix;
        b.date = weekdayDate(today, b.wd, a.prefix);
      }
    }
  }

  // 「A 到 B」合併成區間
  const merged = [];
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    if (b && a.kind === 'date' && b.kind === 'date') {
      const gap = t.slice(a.end, b.pos);
      if (/^(到|至|~|-|—|開始停到|開始到|起到|停到|開始.{0,4}到)$/.test(gap)) {
        merged.push({ kind: 'range', from: a.date, to: b.date, pos: a.pos, end: b.end, text: t.slice(a.pos, b.end), sub: 'explicit' });
        i++;
        continue;
      }
    }
    merged.push(a);
  }

  // 生效日：「X 開始」「X 起」「從 X」
  for (const mk of merged) {
    const after = t.slice(mk.end);
    const before = t.slice(Math.max(0, mk.pos - 1), mk.pos);
    if (/^(的課)?(開始|起(?!來))/.test(after) || before === '從') mk.effective = true;
  }
  return merged;
}

// ============================================================
// 時間與時長
// ============================================================

const EVENING = /下午|傍晚|晚上|晚間|今晚|明晚/;

function resolveHour(h, mod) {
  if (mod) {
    if (/早上|上午/.test(mod)) return { h };
    if (/中午/.test(mod)) return { h: h === 12 ? 12 : h < 12 ? h + 12 : h };
    if (EVENING.test(mod)) return { h: h < 12 ? h + 12 : h };
  }
  if (h >= 12 || h === 0) return { h };
  if (h >= 1 && h <= 7) return { h: h + 12 };
  return { h, ambiguous: true }; // 8–11 點
}

export function extractTimes(t) {
  const out = [];
  const re = /(早上|上午|中午|下午|傍晚|晚上|晚間|今晚|明晚)?(\d{1,2})(?::(\d{2})|點(?:(半)|(\d{1,2})分?)?|時(?!間))/g;
  let m;
  while ((m = re.exec(t))) {
    const hRaw = Number(m[2]);
    if (hRaw > 24) continue;
    const min = m[3] ? Number(m[3]) : m[4] ? 30 : m[5] ? Number(m[5]) : 0;
    if (min > 59) continue;
    const r = m[3] && hRaw >= 13 ? { h: hRaw } : resolveHour(hRaw, m[1]);
    const item = {
      pos: m.index, end: m.index + m[0].length, text: m[0],
      start: `${String(r.h % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      ambiguous: !!r.ambiguous,
      alt: r.ambiguous ? [`${String(hRaw).padStart(2, '0')}:${String(min).padStart(2, '0')}`, `${String(hRaw + 12).padStart(2, '0')}:${String(min).padStart(2, '0')}`] : null,
      hasMod: !!m[1],
    };
    out.push(item);
  }
  // 時間區間：「7點到9點」
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    if (!/^(到|至|~|-)$/.test(t.slice(a.end, b.pos))) continue;
    let s = timeToMin(a.ambiguous ? a.alt[1] : a.start);
    let e = timeToMin(b.start);
    if (!b.hasMod) {
      const bh = Number(b.text.match(/\d{1,2}/)[0]);
      e = (bh % 12) * 60 + (e % 60);
      while (e <= s) e += 12 * 60;
    }
    if (a.ambiguous && b.hasMod === false && e - s > 0) {
      // 「8點到10點」這種兩邊都沒修飾詞的，保留追問
    }
    a.duration = e - s;
    a.rangeEnd = b.end;
    out.splice(i + 1, 1);
  }
  return out;
}

export function extractDurations(t) {
  const out = [];
  const used = new Array(t.length).fill(false);
  const take = (re, fn) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      const s = m.index, e = s + m[0].length;
      if (used.slice(s, e).some(Boolean)) continue;
      for (let i = s; i < e; i++) used[i] = true;
      out.push({ pos: s, end: e, minutes: fn(m) });
    }
  };
  take(/(\d+)個?半(?:小時|鐘頭)/g, (m) => Number(m[1]) * 60 + 30);
  take(/(\d+)個?(?:小時|鐘頭)/g, (m) => Number(m[1]) * 60);
  take(/半個?(?:小時|鐘頭)/g, () => 30);
  take(/(?<![點\d:])(\d+)分(?:鐘)?/g, (m) => Number(m[1]));
  return out.sort((a, b) => a.pos - b.pos);
}

// ============================================================
// 意圖判斷（由上往下，第一個符合的就決定）
// ============================================================

const RE = {
  undo: /不用請假|不請假了|請假取消|取消請假|照常|照舊|可以上了|還是可以上|恢復上課|正常上課/,
  end: /不上了|先不上|不繼續|停止上課|結束課程|上完就先停|上完就停|最後(?:1|一)(?:堂|次)/,
  permanentWhen: /以後|之後|往後|固定|每〔W\d〕|每(?:週|周|個?禮拜|星期)|長期/,
  change: /改|換|調/,
  duration: /上\d+個?半?(?:小時|鐘頭|分鐘|分)|上半個?(?:小時|鐘頭)|延長|縮短|多上(?!(?:1|一)(?:堂|次))|少上|只能上|提早下課|早點下課|上[^，,。]{0,8}就好/,
  late: /遲到|晚點到|慢點到|晚到|(?<![今明])晚(?!上|間)[^，,。]{0,8}?到/,
  shift: /延後|往後延|(?<![今明])晚(?:半個?(?:小時|鐘頭)|\d+個?(?:小時|鐘頭|分鐘?)|些)(?:開始|上)|提早|提前|早(?:半個?(?:小時|鐘頭)|\d+個?(?:小時|鐘頭|分鐘?)|些)|往前/,
  makeup: /補課|補上次|補回來|補在|補上|補(?:1|一)堂/,
  add: /加課|加(?:1|一)堂|多加|多上(?:1|一)(?:堂|次)|多(?:1|一)堂|加開|再上(?:1|一)堂|增加(?:1|一)堂/,
  move: /改到|改成|改在|改天|改時間|換時間|改期|延期|順延|換到|換成|調到|調整|挪到|移到|改|換/,
  stopKw: /都不能|都沒辦法|都要請假|暫停|停課|停(?:1|一)下|先停|停到|停\d+(?:週|周|個?禮拜|個?星期)/,
  stopAlone: /段考週|寒假|暑假|出國\d+(?:週|周|個?禮拜)/,
  leave: /請假|不能上|沒辦法上|無法上|不能去|沒辦法去|沒辦法|不上|休息|停(?:1|一)次|取消|不舒服|生病|發燒|感冒|咳嗽|看醫生|住院|拉肚子|受傷|學校活動|校外教學|畢業旅行|比賽|考試|有事|臨時有事|回老家|出遊|出國|婚禮|喪事|太累|來不及|趕不回來/,
  inquiry: /有上課嗎|有課嗎|幾點|什麼時候|下次是|\?/,
};

const RANGE_KINDS = new Set(['range']);

export function detectIntent(t, dates) {
  if (RE.undo.test(t)) return 'undo';
  if (RE.end.test(t)) {
    const hasRange = dates.some((d) => RANGE_KINDS.has(d.kind) && !d.effective) && !/上完/.test(t);
    return hasRange ? 'stop_range' : 'end';
  }
  if (RE.change.test(t) && (RE.permanentWhen.test(t) || dates.some((d) => d.effective))) return 'permanent';
  if (RE.duration.test(t)) return 'duration';
  if (RE.late.test(t)) return 'late';
  if (RE.shift.test(t)) return 'shift';
  if (RE.makeup.test(t)) return 'makeup';
  if (RE.add.test(t)) return 'add';
  if (RE.move.test(t)) return 'move';
  if (RE.stopAlone.test(t) || (RE.stopKw.test(t))) return 'stop_range';
  if (RE.leave.test(t)) return 'leave';
  if (RE.inquiry.test(t)) return 'inquiry';
  return 'unknown';
}

// ============================================================
// 主程式
// ============================================================

export const ACTION_LABELS = {
  leave: '請假', stop_range: '區間停課', move: '單次改課', permanent: '永久改課', shift: '延後或提早',
  late: '遲到', duration: '延長或縮短', add: '加課', makeup: '補課', undo: '取消請假、恢復上課',
  end: '結束課程', inquiry: '詢問', unknown: '看不出意圖',
};

function lessonLabel(l) {
  return `${fmtMDW(l.date)}${l.start}${l.end ? `–${l.end}` : ''}`;
}

function shortLabel(l) {
  return `${fmtMDW(l.date)}${l.start}`;
}

/** 建立分析所需的上下文 */
function makeCtx(opts) {
  const now = opts.now;
  const today = now.date;
  const nowMin = timeToMin(now.time || '00:00');
  const student = opts.student;
  const lessons = (opts.upcomingLessons || []).filter((l) => !student || l.studentId === student.id || l.studentId == null);
  const lastDate = lessons.length ? lessons[lessons.length - 1].date : today;

  /** 由固定時段算出某天的課（給過去的日期或 upcomingLessons 沒涵蓋的日期用） */
  function fromSlots(date) {
    const out = [];
    for (const sl of student?.slots || []) {
      if (sl.wd !== weekday(date)) continue;
      if (sl.validFrom && date < sl.validFrom) continue;
      if (sl.validTo && date > sl.validTo) continue;
      out.push({
        key: `${sl.id}@${date}`, slotId: sl.id, studentId: student.id, date, start: sl.start, duration: sl.duration,
        end: minToTime(timeToMin(sl.start) + sl.duration), subjects: sl.subjects || [], status: 'normal', kind: 'base',
      });
    }
    return out.sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
  }

  function lessonsOn(date, { includeInactive = false } = {}) {
    const list = date < today || date > lastDate ? fromSlots(date) : lessons.filter((l) => l.date === date);
    return list.filter((l) => l.status !== 'moved' && (includeInactive || (l.status !== 'stop')));
  }

  function lessonsIn(from, to, opt) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(...lessonsOn(d, opt));
    return out;
  }

  const upcoming = lessons.filter((l) => ['normal', 'changed'].includes(l.status)
    && (l.date > today || (l.date === today && timeToMin(l.end || l.start) > nowMin)));

  return { now, today, nowMin, student, lessons, lessonsOn, lessonsIn, upcoming };
}

function q(field, text, options = [], input = null, extra = {}) {
  return { id: `q_${field.replace(/\./g, '_')}`, field, text, options, input, ...extra };
}

const lessonOption = (l) => ({ label: shortLabel(l), value: l.key });

const ASK = { 請假: '要請哪一堂？', 改: '要改哪一堂？', 恢復: '要恢復哪一堂？' };
/** 「要請哪一堂？」這類問句 */
const ask = (verb) => ASK[verb] || '是哪一堂？';

/**
 * 找出受影響的課。
 * 回傳 { targets: [key], question?, lessons: [lesson] }
 */
function resolveTargets(ctx, info, { verb, includeInactive = false, multi = true, timeHint = null, dateMarks = null }) {
  const marks = dateMarks || info.dates;
  const singles = marks.filter((m) => m.kind === 'date');
  const ranges = marks.filter((m) => m.kind === 'range');
  const next = marks.find((m) => m.kind === 'next');
  const weekend = marks.find((m) => m.kind === 'weekend');
  const name = ctx.student?.name || '';
  const opt = { includeInactive };
  const options4 = () => ctx.upcoming.slice(0, 4).map(lessonOption);

  const pickByTime = (list) => {
    if (timeHint && list.length > 1) {
      const hit = list.filter((l) => l.start === timeHint || (timeHint.alt && timeHint.alt.includes(l.start)));
      if (hit.length) return hit;
    }
    if (timeHint && list.length === 1) return list;
    return list;
  };

  if (singles.length >= 2 && info.or) {
    const cands = singles.flatMap((s) => pickByTime(ctx.lessonsOn(s.date, opt)));
    return { targets: [], lessons: cands, question: q('target', `${singles.map((s) => fmtMDW(s.date)).join('或')}，${ask(verb)}`, cands.map(lessonOption)) };
  }

  if (singles.length) {
    const used = multi ? singles : singles.slice(0, 1);
    const found = [];
    for (const s of used) {
      const list = pickByTime(ctx.lessonsOn(s.date, opt));
      if (list.length === 1) found.push(list[0]);
      else if (list.length > 1) {
        if (used.length === 1) {
          return {
            targets: [], lessons: list,
            question: q('target', `${fmtMDW(s.date)}有 ${list.length} 堂課，${ask(verb)}`, [...list.map(lessonOption), { label: '全部', value: 'all' }]),
          };
        }
        found.push(...list);
      }
    }
    if (!found.length) {
      const s = used[0];
      return {
        targets: [], lessons: [],
        question: q('target', `${fmtMDW(s.date)}${name}沒有課，請問是哪一堂？`, options4(), null, { default: ctx.upcoming[0]?.key }),
      };
    }
    return { targets: found.map((l) => l.key), lessons: found };
  }

  if (next) {
    const l = ctx.upcoming[0];
    if (l) return { targets: [l.key], lessons: [l] };
    return { targets: [], lessons: [], question: q('target', `${name}接下來 8 週沒有課，請問是哪一堂？`, [], 'date') };
  }

  if (weekend || ranges.length) {
    const list = weekend ? weekend.dates.flatMap((d) => ctx.lessonsOn(d, opt)) : ctx.lessonsIn(ranges[0].from, ranges[0].to, opt);
    if (list.length === 1) return { targets: [list[0].key], lessons: list };
    if (!list.length) {
      return { targets: [], lessons: [], question: q('target', `這段期間${name}沒有課，請問是哪一堂？`, options4(), null, { default: ctx.upcoming[0]?.key }) };
    }
    const desc = weekend ? '週末' : ranges[0].sub === 'week' ? (ranges[0].from === mondayOf(ctx.today) ? '這週' : '下週') : '這段期間';
    return {
      targets: [], lessons: list,
      question: q('target', `${desc}有 ${list.length} 堂課，${ask(verb)}`, [...list.map(lessonOption), { label: '全部', value: 'all' }]),
    };
  }

  return { targets: [], lessons: [], none: true };
}

/** 日期已過的追問 */
function pastQuestion(ctx, targets, lessons) {
  const past = lessons.filter((l) => targets.includes(l.key) && l.date < ctx.today);
  if (!past.length) return null;
  const l = past[0];
  return q('confirmPast', `${fmtMD(l.date)} 已經過了，確定嗎？`, [
    { label: '確定', value: 'yes' },
    { label: '改成下週', value: addDays(l.date, 7) },
  ]);
}

const MINUTE_OPTIONS = [15, 30, 45, 60];

export function parse(text, opts) {
  const ctx = makeCtx(opts);
  const t = preprocess(text);
  const dates = extractDates(t, ctx.today);
  const times = extractTimes(t);
  const durs = extractDurations(t);
  const info = {
    t, dates, times, durs,
    or: /或/.test(t),
    sameTime: /同(?:1|一)?個?時間|(?:1|一)樣的?時間|同時段|原本的?時間|原時間/.test(t),
  };
  const action = detectIntent(t, dates);
  const draft = {
    action,
    studentCode: ctx.student?.code ?? null,
    studentId: ctx.student?.id ?? null,
    targets: [],
    to: null,
    minutes: null,
    newDuration: null,
    range: null,
    permanent: null,
    endDate: null,
    subjects: null,
    lessons: null,
    summary: '',
    questions: [],
    confidence: 0.9,
    text,
  };
  const H = handlers[action];
  H(draft, ctx, info);
  if (draft.questions.length) draft.confidence = Math.min(draft.confidence, 0.6);
  if (action === 'unknown') draft.confidence = 0;
  draft.summary = summarize(draft, ctx);
  return draft;
}

function firstSlot(ctx) {
  return ctx.student?.slots?.find((s) => !s.validTo || s.validTo >= ctx.today) || ctx.student?.slots?.[0] || null;
}

function targetLessons(draft, ctx, lessons) {
  return lessons.filter((l) => draft.targets.includes(l.key));
}

function applyTargets(draft, ctx, info, verb, opt = {}) {
  const r = resolveTargets(ctx, info, { verb, ...opt });
  if (r.none) {
    if (opt.todayFirst) {
      const todays = ctx.lessonsOn(ctx.today, { includeInactive: opt.includeInactive });
      if (todays.length === 1) {
        draft.targets = [todays[0].key];
        draft._lessons = todays;
        return todays;
      }
    }
    const def = ctx.upcoming[0];
    draft.questions.push(q('target', ask(verb), ctx.upcoming.slice(0, 4).map(lessonOption), null, { default: def?.key }));
    draft._lessons = ctx.upcoming.slice(0, 4);
    return [];
  }
  draft.targets = r.targets;
  draft._lessons = r.lessons;
  if (r.question) draft.questions.push(r.question);
  const pq = pastQuestion(ctx, r.targets, r.lessons);
  if (pq) draft.questions.push(pq);
  return targetLessons(draft, ctx, r.lessons);
}

function timeQuestion(field, tm, extra = {}) {
  const [am, pm] = tm.alt;
  return q(field, `是早上 ${am} 還是晚上 ${pm}？`, [{ label: `早上 ${am}`, value: am }, { label: `晚上 ${pm}`, value: pm }], null, extra);
}

const handlers = {
  leave(draft, ctx, info) {
    const timeHint = info.times[0] ? (info.times[0].ambiguous ? { alt: info.times[0].alt } : info.times[0].start) : null;
    applyTargets(draft, ctx, info, '請假', { timeHint });
  },

  undo(draft, ctx, info) {
    const singles = info.dates.filter((d) => d.kind === 'date' || d.kind === 'next');
    const range = info.dates.find((d) => d.kind === 'range');
    if (!singles.length && range) {
      draft.range = { from: range.from, to: range.to };
      return;
    }
    applyTargets(draft, ctx, info, '恢復', { includeInactive: true, todayFirst: true });
  },

  stop_range(draft, ctx, info) {
    const range = info.dates.find((d) => d.kind === 'range');
    if (range) {
      draft.range = { from: range.from, to: range.to };
      return;
    }
    const singles = info.dates.filter((d) => d.kind === 'date');
    const vague = info.dates.find((d) => d.kind === 'vague');
    if (!vague && singles.length === 1) {
      // 只有單一日期 → 當成請假
      draft.action = 'leave';
      handlers.leave(draft, ctx, info);
      return;
    }
    const v = vague ? vague.text : '';
    draft.questions.push(q('range', v ? `「${v}」是哪幾天？請選擇停課的起訖日期` : '請選擇停課的起訖日期', [], 'range', {
      default: { from: ctx.today, to: addDays(ctx.today, 6) },
    }));
  },

  move(draft, ctx, info) {
    const kw = info.t.match(RE.move);
    const kwPos = kw ? kw.index : info.t.length;
    const kwEnd = kw ? kw.index + kw[0].length : info.t.length;
    const before = info.dates.filter((d) => d.end <= kwPos && d.kind !== 'ignore');
    const after = info.dates.filter((d) => d.pos >= kwEnd && d.kind === 'date');
    const timesBefore = info.times.filter((x) => x.end <= kwPos);
    const timesAfter = info.times.filter((x) => x.pos >= kwEnd);

    let origMarks = before;
    let newDate = after[0]?.date || null;
    if (!before.length && after.length >= 2) {
      origMarks = [after[0]];
      newDate = after[1].date;
    }
    let orig = [];
    if (origMarks.length) {
      const th = timesBefore[0] ? (timesBefore[0].ambiguous ? { alt: timesBefore[0].alt } : timesBefore[0].start) : null;
      orig = applyTargets(draft, ctx, { ...info, dates: origMarks }, '改', { multi: false, timeHint: th });
    } else {
      const def = ctx.upcoming[0];
      draft.questions.push(q('target', '要改哪一堂？', ctx.upcoming.slice(0, 4).map(lessonOption), null, { default: def?.key }));
      draft._lessons = ctx.upcoming.slice(0, 4);
    }
    const base = orig[0] || null;
    const tm = timesAfter[0] || null;
    const dur = info.durs.find((d) => d.pos >= kwEnd);

    if (!newDate && !tm) {
      const options = /改天|改期|延期|順延/.test(info.t) || !/時間/.test(info.t)
        ? [{ label: '先記請假，之後補課', value: 'leave' }] : [];
      draft.to = base ? { date: null, start: null, duration: base.duration } : null;
      draft.questions.push(q('to', '要改到什麼時候？', options, 'datetime', {
        default: base ? { date: base.date, start: base.start } : null,
      }));
      return;
    }
    const date = newDate || base?.date || null;
    let start = null;
    if (tm && !tm.ambiguous) start = tm.start;
    else if (!tm) start = base?.start || null;
    const duration = tm?.duration || dur?.minutes || base?.duration || null;
    draft.to = { date, start, duration };
    if (tm && tm.ambiguous) draft.questions.push(timeQuestion('to.start', tm));
    if (date && date < ctx.today) draft.questions.push(q('confirmPast', `${fmtMD(date)} 已經過了，確定嗎？`, [{ label: '確定', value: 'yes' }, { label: '改成下週', value: addDays(date, 7) }]));
  },

  shift(draft, ctx, info) {
    const ls = applyTargets(draft, ctx, info, '調整', { todayFirst: true });
    const sign = /提早|提前|早|往前/.test(info.t.replace(/早上|提早下課/g, '')) && !/延後|往後延|晚/.test(info.t.replace(/晚上|今晚|明晚/g, '')) ? -1 : 1;
    const d = info.durs[0];
    if (d) {
      draft.minutes = sign * d.minutes;
      if (ls[0]) draft.to = { date: ls[0].date, start: minToTime(timeToMin(ls[0].start) + draft.minutes), duration: ls[0].duration };
    } else {
      draft.questions.push(q('minutes', sign > 0 ? '要延後幾分鐘？' : '要提早幾分鐘？',
        MINUTE_OPTIONS.map((m) => ({ label: `${m} 分`, value: sign * m })), 'minutes', { sign }));
    }
  },

  late(draft, ctx, info) {
    applyTargets(draft, ctx, info, '標記遲到', { todayFirst: true });
    const d = info.durs[0];
    if (d) draft.minutes = d.minutes;
    else {
      draft.questions.push(q('minutes', '大概會晚幾分鐘？',
        [...MINUTE_OPTIONS.map((m) => ({ label: `${m} 分`, value: m })), { label: '不確定', value: 0 }], 'minutes'));
    }
  },

  duration(draft, ctx, info) {
    const ls = applyTargets(draft, ctx, info, '調整', { todayFirst: true });
    const base = ls[0];
    const d = info.durs[info.durs.length - 1];
    if (!d) {
      draft.questions.push(q('newDuration', '要改成上多久？', [60, 90, 120].map((m) => ({ label: `${m} 分`, value: m })), 'minutes'));
      return;
    }
    const relPlus = /延長(?!成|為|到)|多上/.test(info.t);
    const relMinus = /縮短(?!成|為|到)|少上/.test(info.t);
    if (base) {
      draft.newDuration = relPlus ? base.duration + d.minutes : relMinus ? base.duration - d.minutes : d.minutes;
      draft.minutes = draft.newDuration - base.duration;
    } else {
      draft.newDuration = relPlus || relMinus ? null : d.minutes;
      draft._relative = relPlus ? d.minutes : relMinus ? -d.minutes : null;
    }
  },

  add(draft, ctx, info) {
    newLesson(draft, ctx, info, '加課');
  },

  makeup(draft, ctx, info) {
    newLesson(draft, ctx, info, '補課');
  },

  permanent(draft, ctx, info) {
    const kw = info.t.match(/改|換|調/);
    const kwPos = kw.index;
    const eff = info.dates.find((d) => d.effective);
    let effectiveFrom = ctx.today;
    if (eff) effectiveFrom = eff.kind === 'range' ? eff.from : eff.date;
    const wdMarks = info.dates.filter((d) => d.wd != null);
    const srcWds = wdMarks.filter((d) => d.pos < kwPos).map((d) => d.wd);
    const dstWd = wdMarks.find((d) => d.pos > kwPos)?.wd ?? null;
    const tm = info.times.find((x) => x.pos > kwPos) || null;
    const dur = info.durs.find((x) => x.pos > kwPos) || null;

    const active = (ctx.student?.slots || []).filter((s) => !s.validTo || s.validTo >= effectiveFrom);
    let slotIds = null;
    if (srcWds.length) {
      const hit = active.filter((s) => srcWds.includes(s.wd));
      if (hit.length) slotIds = hit.map((s) => s.id);
    } else if (active.length === 1) {
      slotIds = [active[0].id];
    }
    draft.permanent = {
      slotIds: slotIds || [],
      wd: dstWd,
      start: tm && !tm.ambiguous ? tm.start : null,
      duration: tm?.duration || dur?.minutes || null,
      effectiveFrom,
    };
    if (!slotIds) {
      draft.questions.push(q('permanent.slotIds', '要改哪一個固定時段？',
        [...active.map((s) => ({ label: `週${WD_NAMES[s.wd]} ${s.start}–${minToTime(timeToMin(s.start) + s.duration)}`, value: s.id })),
          ...(active.length > 1 ? [{ label: '全部', value: 'all' }] : [])]));
    }
    if (tm && tm.ambiguous) draft.questions.push(timeQuestion('permanent.start', tm));
    if (dstWd == null && !tm && !dur) {
      draft.questions.push(q('permanent.change', '要改成星期幾、幾點？', [], 'weekly'));
    }
  },

  end(draft, ctx, info) {
    const week = info.dates.find((d) => d.kind === 'range' && d.sub === 'week');
    const eff = info.dates.find((d) => d.effective);
    const single = info.dates.find((d) => d.kind === 'date');
    if (/上完/.test(info.t) && week) draft.endDate = week.to;
    else if (eff) draft.endDate = addDays(eff.kind === 'range' ? eff.from : eff.date, -1);
    else if (single) draft.endDate = single.date;
    else {
      draft.questions.push(q('endDate', '最後一堂是哪一天？', [], 'date', { default: ctx.today }));
    }
  },

  inquiry(draft, ctx, info) {
    const singles = info.dates.filter((d) => d.kind === 'date');
    const range = info.dates.find((d) => d.kind === 'range');
    const weekend = info.dates.find((d) => d.kind === 'weekend');
    let list;
    if (singles.length) list = singles.flatMap((s) => ctx.lessonsOn(s.date, { includeInactive: true }));
    else if (range) list = ctx.lessonsIn(range.from, range.to, { includeInactive: true });
    else if (weekend) list = weekend.dates.flatMap((d) => ctx.lessonsOn(d, { includeInactive: true }));
    else list = ctx.upcoming.slice(0, 1);
    draft.lessons = list.map((l) => ({ key: l.key, date: l.date, start: l.start, end: l.end, status: l.status, kind: l.kind }));
    draft.confidence = 0.8;
  },

  unknown(draft) {
    draft.questions.push(q('action', '看不出要做什麼，請選擇動作',
      ['leave', 'stop_range', 'move', 'permanent', 'shift', 'late', 'duration', 'add', 'makeup', 'undo', 'end', 'inquiry']
        .map((a) => ({ label: ACTION_LABELS[a], value: a }))));
  },
};

function newLesson(draft, ctx, info, verb) {
  const slot = firstSlot(ctx);
  draft.subjects = slot ? [...(slot.subjects || [])] : [];
  const dates = info.dates.filter((d) => d.kind === 'date');
  const tm = info.times[0] || null;
  const dur = info.durs[0] || null;
  const date = dates[0]?.date || null;
  const duration = tm?.duration || dur?.minutes || slot?.duration || 60;
  if (!date && !tm) {
    draft.to = { date: null, start: null, duration };
    draft.questions.push(q('to', `要${verb}在什麼時候？`, [], 'datetime', { default: { date: null, start: slot?.start || null } }));
    return;
  }
  draft.to = { date, start: tm && !tm.ambiguous ? tm.start : null, duration };
  if (!date) draft.questions.push(q('to.date', `要${verb}在哪一天？`, [], 'date'));
  if (!tm) draft.questions.push(q('to.start', `幾點開始？`, slot ? [{ label: slot.start, value: slot.start }] : [], 'time', { default: slot?.start || null }));
  else if (tm.ambiguous) draft.questions.push(timeQuestion('to.start', tm));
  if (date && date < ctx.today) draft.questions.push(q('confirmPast', `${fmtMD(date)} 已經過了，確定嗎？`, [{ label: '確定', value: 'yes' }, { label: '改成下週', value: addDays(date, 7) }]));
}

// ============================================================
// 判斷結果（給人看的一句話）
// ============================================================

function findLessonIn(draft, ctx, key) {
  return (draft._lessons || []).find((l) => l.key === key)
    || ctx.lessons.find((l) => l.key === key)
    || (key.includes('@') ? ctx.lessonsOn(key.split('@')[1], { includeInactive: true }).find((l) => l.key === key) : null);
}

function summarize(draft, ctx) {
  const lessons = draft.targets.map((k) => findLessonIn(draft, ctx, k)).filter(Boolean);
  const subj = (l) => (l.subjects && l.subjects.length ? ` ${l.subjects.join('＋')}` : '');
  const tl = lessons.map((l) => `${lessonLabel(l)}${subj(l)}`).join('、');
  const to = draft.to;
  const toText = to && to.date && to.start ? `${fmtMDW(to.date)}${to.start}–${minToTime(timeToMin(to.start) + (to.duration || 60))}` : '';
  switch (draft.action) {
    case 'leave':
      return tl ? `${tl} → 請假（待補課 +${lessons.length}）` : '請假（請選擇是哪一堂）';
    case 'undo':
      if (draft.range) return `${fmtMDW(draft.range.from)}～${fmtMDW(draft.range.to)} → 恢復上課`;
      return tl ? `${tl} → 取消請假，照常上課` : '取消請假（請選擇是哪一堂）';
    case 'stop_range':
      return draft.range ? `${fmtMDW(draft.range.from)}～${fmtMDW(draft.range.to)} → 區間停課` : '區間停課（請選擇起訖日期）';
    case 'move':
      return `${tl || '（哪一堂？）'} → 改到 ${toText || (to?.date ? `${fmtMDW(to.date)}（幾點？）` : '（什麼時候？）')}`;
    case 'shift': {
      if (!tl) return '延後或提早（請選擇是哪一堂）';
      if (draft.minutes == null) return `${tl} → 延後或提早（幾分鐘？）`;
      const l = lessons[0];
      return `${tl} → ${draft.minutes > 0 ? '延後' : '提早'} ${Math.abs(draft.minutes)} 分，改為 ${minToTime(timeToMin(l.start) + draft.minutes)}–${minToTime(timeToMin(l.start) + draft.minutes + l.duration)}`;
    }
    case 'late':
      return `${tl || '（哪一堂？）'} → ${draft.minutes ? `晚到 ${draft.minutes} 分` : '會晚到'}`;
    case 'duration': {
      if (!tl) return '延長或縮短（請選擇是哪一堂）';
      const l = lessons[0];
      if (draft.newDuration == null) return `${tl} → 改成上多久？`;
      return `${tl} → ${draft.newDuration > l.duration ? '延長' : draft.newDuration < l.duration ? '縮短' : '維持'}為 ${draft.newDuration} 分（${l.start}–${minToTime(timeToMin(l.start) + draft.newDuration)}）`;
    }
    case 'add':
    case 'makeup': {
      const verb = draft.action === 'add' ? '加課' : '補課';
      const sj = draft.subjects && draft.subjects.length ? ` ${draft.subjects.join('＋')}` : '';
      return `${verb} ${toText || (to?.date ? `${fmtMDW(to.date)}（幾點？）` : '（什麼時候？）')}${sj}`;
    }
    case 'permanent': {
      const p = draft.permanent;
      const slots = (ctx.student?.slots || []).filter((s) => p.slotIds.includes(s.id));
      const from = slots.length ? slots.map((s) => `週${WD_NAMES[s.wd]} ${s.start}`).join('、') : '（哪個時段？）';
      const parts = [];
      if (p.wd != null) parts.push(`週${WD_NAMES[p.wd]}`);
      if (p.start) parts.push(p.start);
      if (p.duration) parts.push(`每次 ${p.duration} 分`);
      return `永久改課：${from} → ${parts.join(' ') || '（改成什麼？）'}，${fmtMDW(p.effectiveFrom)}起生效`;
    }
    case 'end':
      return draft.endDate ? `結束課程，最後一天 ${fmtMDW(draft.endDate)}` : '結束課程（最後一堂是哪一天？）';
    case 'inquiry':
      if (!draft.lessons.length) return '這段期間沒有課';
      return draft.lessons.map((l) => `${lessonLabel(l)}${l.status === 'leave' ? '（請假）' : l.status === 'stop' ? '（停課）' : ''}`).join('、');
    default:
      return '看不出要做什麼';
  }
}

// ============================================================
// 回答追問
// ============================================================

/** 回答一個追問，回傳新的 Draft（不修改原本的） */
export function applyAnswer(draft, questionId, value, opts) {
  const ctx = makeCtx(opts);
  const d = JSON.parse(JSON.stringify(draft));
  const qn = d.questions.find((x) => x.id === questionId);
  if (!qn) return d;
  d.questions = d.questions.filter((x) => x.id !== questionId);
  const lessonOf = (key) => findLessonIn(d, ctx, key) || ctx.lessons.find((l) => l.key === key);

  switch (qn.field) {
    case 'action': {
      // 換動作 → 用原文重新分析，但強制這個動作
      return reparseAs(d.text, value, opts);
    }
    case 'target': {
      if (value === 'all') d.targets = (d._lessons || []).map((l) => l.key);
      else d.targets = [value];
      const l = lessonOf(d.targets[0]);
      if (l) {
        if (!d._lessons?.some((x) => x.key === l.key)) d._lessons = [...(d._lessons || []), l];
        if (d.action === 'shift' && d.minutes != null) d.to = { date: l.date, start: minToTime(timeToMin(l.start) + d.minutes), duration: l.duration };
        if (d.action === 'duration' && d.newDuration == null && d._relative != null) {
          d.newDuration = l.duration + d._relative;
          d.minutes = d._relative;
        } else if (d.action === 'duration' && d.newDuration != null) d.minutes = d.newDuration - l.duration;
        if (d.action === 'move' && d.to) {
          d.to.date = d.to.date || null;
          d.to.duration = d.to.duration || l.duration;
          if (!d.to.start && d.to.date && !d.questions.some((x) => x.field === 'to' || x.field === 'to.start')) d.to.start = l.start;
          const tq = d.questions.find((x) => x.field === 'to');
          if (tq) tq.default = { date: l.date, start: l.start };
        }
        const pq = pastQuestion(ctx, d.targets, [l]);
        if (pq && !d.questions.some((x) => x.field === 'confirmPast')) d.questions.push(pq);
      }
      break;
    }
    case 'confirmPast': {
      if (value !== 'yes') {
        // 改成下週：把目標換成一週後同一堂
        if (d.action === 'add' || d.action === 'makeup' || (d.action === 'move' && d.to?.date && d.to.date < ctx.today)) {
          d.to.date = value;
        } else {
          d.targets = d.targets.map((k) => {
            const [sid, date] = k.split('@');
            return date && date < ctx.today ? `${sid}@${addDays(date, 7)}` : k;
          });
          d._lessons = d.targets.map((k) => ctx.lessonsOn(k.split('@')[1], { includeInactive: true }).find((l) => l.key === k)).filter(Boolean);
        }
      }
      break;
    }
    case 'to': {
      if (value === 'leave') {
        d.action = 'leave';
        d.to = null;
        d.questions = d.questions.filter((x) => x.field !== 'to');
      } else {
        const base = lessonOf(d.targets[0]);
        d.to = { date: value.date, start: value.start, duration: value.duration || d.to?.duration || base?.duration || firstSlot(ctx)?.duration || 60 };
      }
      break;
    }
    case 'to.start':
      d.to = { ...(d.to || {}), start: value };
      break;
    case 'to.date':
      d.to = { ...(d.to || {}), date: value };
      break;
    case 'minutes': {
      const l = lessonOf(d.targets[0]);
      d.minutes = Number(value);
      if (d.action === 'shift' && l) d.to = { date: l.date, start: minToTime(timeToMin(l.start) + d.minutes), duration: l.duration };
      break;
    }
    case 'newDuration': {
      const l = lessonOf(d.targets[0]);
      d.newDuration = Number(value);
      if (l) d.minutes = d.newDuration - l.duration;
      break;
    }
    case 'range':
      d.range = { from: value.from, to: value.to };
      break;
    case 'endDate':
      d.endDate = value;
      break;
    case 'permanent.slotIds': {
      const active = (ctx.student?.slots || []).filter((s) => !s.validTo || s.validTo >= d.permanent.effectiveFrom);
      d.permanent.slotIds = value === 'all' ? active.map((s) => s.id) : Array.isArray(value) ? value : [value];
      break;
    }
    case 'permanent.start':
      d.permanent.start = value;
      break;
    case 'permanent.change':
      if (value.wd != null) d.permanent.wd = Number(value.wd);
      if (value.start) d.permanent.start = value.start;
      if (value.duration) d.permanent.duration = Number(value.duration);
      break;
    default:
      break;
  }
  if (!d.questions.length) d.confidence = Math.max(d.confidence, 0.8);
  d.summary = summarize(d, ctx);
  return d;
}

/** 使用者手動指定動作後重新分析 */
export function reparseAs(text, action, opts) {
  const ctx = makeCtx(opts);
  const t = preprocess(text);
  const dates = extractDates(t, ctx.today);
  const info = {
    t, dates, times: extractTimes(t), durs: extractDurations(t), or: /或/.test(t),
    sameTime: /同(?:1|一)?個?時間|(?:1|一)樣的?時間/.test(t),
  };
  const draft = {
    action, studentCode: ctx.student?.code ?? null, studentId: ctx.student?.id ?? null, targets: [], to: null,
    minutes: null, newDuration: null, range: null, permanent: null, endDate: null, subjects: null, lessons: null,
    summary: '', questions: [], confidence: 0.7, text,
  };
  if (action === 'permanent' && !/改|換|調/.test(t)) {
    draft.permanent = { slotIds: [], wd: null, start: null, duration: null, effectiveFrom: ctx.today };
    draft.questions.push(q('permanent.slotIds', '要改哪一個固定時段？', (ctx.student?.slots || []).filter((s) => !s.validTo || s.validTo >= ctx.today).map((s) => ({ label: `週${WD_NAMES[s.wd]} ${s.start}`, value: s.id }))));
    draft.questions.push(q('permanent.change', '要改成星期幾、幾點？', [], 'weekly'));
  } else {
    handlers[action](draft, ctx, info);
  }
  if (action === 'stop_range' && draft.action === 'leave' && !draft.targets.length) draft.action = 'stop_range';
  draft.summary = summarize(draft, ctx);
  return draft;
}

/** 使用者手動修改欄位後，重新產生判斷結果 */
export function summarizeDraft(draft, opts) {
  return summarize(draft, makeCtx(opts));
}
