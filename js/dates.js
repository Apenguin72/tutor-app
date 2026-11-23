// 日期工具。所有日期都是當地（Asia/Taipei）的 'YYYY-MM-DD' 字串。
// 不使用 new Date('YYYY-MM-DD')；計算一律用 Date.UTC，避免時區誤差。
// wd：0＝一 … 6＝日。

export const WD_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

const pad = (n) => String(n).padStart(2, '0');

export function toISO(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function toUTC(iso) {
  const { y, m, d } = parseISO(iso);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function isValidDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * 86400000);
}

export function diffDays(a, b) {
  return Math.round((toUTC(a) - toUTC(b)) / 86400000);
}

/** 0＝一 … 6＝日 */
export function weekday(iso) {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

export function mondayOf(iso) {
  return addDays(iso, -weekday(iso));
}

export function endOfMonth(iso) {
  const { y, m } = parseISO(iso);
  return toISO(y, m, daysInMonth(y, m));
}

export function firstOfNextMonth(iso) {
  const { y, m } = parseISO(iso);
  return m === 12 ? toISO(y + 1, 1, 1) : toISO(y, m + 1, 1);
}

/** ISO 週數 */
export function isoWeek(iso) {
  const thursday = addDays(mondayOf(iso), 3);
  const { y } = parseISO(thursday);
  return Math.floor(diffDays(thursday, toISO(y, 1, 1)) / 7) + 1;
}

export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** '2026-11-25' → '11/25' */
export function fmtMD(iso) {
  const { m, d } = parseISO(iso);
  return `${m}/${d}`;
}

/** '2026-11-25' → '11/25（三）' */
export function fmtMDW(iso) {
  return `${fmtMD(iso)}（${WD_NAMES[weekday(iso)]}）`;
}

export function compactDate(iso) {
  return iso.replaceAll('-', '');
}

/** 目前 Asia/Taipei 的日期與時間：{date:'YYYY-MM-DD', time:'HH:MM'} */
export function nowTaipei(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
