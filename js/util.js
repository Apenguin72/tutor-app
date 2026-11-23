// 通用小工具（純函式，可在 node 執行）

/** 產生 id，例如 uid('s') → "s_lq3k9a2x7f" */
export function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** 全形英數與常用符號轉半形，全形空白轉半形空白 */
export function toHalfWidth(s) {
  return String(s ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

/** 學生代號正規化：全形轉半形、去前後空白 */
export function normalizeCode(s) {
  return toHalfWidth(s).trim();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}
