// 共用的畫面元件：底部滑出面板、提示訊息、檔案分享／下載。
import { escapeHtml } from './util.js';

export { escapeHtml };

/** 由 HTML 字串建立單一元素 */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/**
 * 從底部滑出的面板。
 * @param {{title:string, body:HTMLElement|string, onClose?:Function}} opts
 * @returns {{el:HTMLElement, body:HTMLElement, close:Function}}
 */
export function openSheet({ title, body, onClose }) {
  const root = document.getElementById('sheet-root');
  const wrap = el(`
    <div class="sheet-wrap">
      <div class="sheet-backdrop"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="sheet-head">
          <h2>${escapeHtml(title)}</h2>
          <button class="icon-btn sheet-close" aria-label="關閉">✕</button>
        </header>
        <div class="sheet-body"></div>
      </section>
    </div>`);
  const bodyEl = wrap.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    document.body.classList.remove('sheet-open');
    onClose && onClose();
  };
  wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
  wrap.querySelector('.sheet-close').addEventListener('click', close);
  root.appendChild(wrap);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => wrap.classList.add('open'));
  return { el: wrap, body: bodyEl, close };
}

/** 優先用 navigator.share({files})，不支援時改用 <a download> */
export async function shareOrDownload(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
    console.warn('分享失敗，改用下載', e);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

/** 開始時間下拉選項（30 分鐘一格）；不在格子上的時間也會保留 */
export function timeOptions(selected, { from = 6 * 60, to = 23 * 60 + 30 } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  let html = '';
  let found = false;
  for (let m = from; m <= to; m += 30) {
    const t = fmt(m);
    if (t === selected) found = true;
    html += `<option value="${t}" ${t === selected ? 'selected' : ''}>${t}</option>`;
  }
  if (selected && !found) html = `<option value="${selected}" selected>${selected}</option>` + html;
  return html;
}

export function durationOptions(selected, list = [30, 45, 60, 90, 120, 150, 180]) {
  const all = [...new Set([...list, selected].filter(Boolean))].sort((a, b) => a - b);
  return all.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d} 分鐘</option>`).join('');
}
