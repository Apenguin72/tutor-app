// 第一頁：訊息
import * as store from '../store.js';
import { el, openSheet, toast, escapeHtml, timeOptions, durationOptions } from '../ui.js';
import { uid, normalizeCode, toHalfWidth } from '../util.js';
import { nowTaipei, fmtMDW, fmtMD, addDays, WD_NAMES, timeToMin, minToTime } from '../dates.js';
import { getUpcomingLessons } from '../schedule.js';
import { parse, resolveStudent, applyAnswer, reparseAs, summarizeDraft, ACTION_LABELS } from '../parser.js';
import { commitDraft, missingFor } from '../commit.js';

const ACTIONS = ['leave', 'stop_range', 'move', 'permanent', 'shift', 'late', 'duration', 'add', 'makeup', 'undo', 'end', 'inquiry'];

/** 分析引擎需要的上下文 */
function parseOpts(student) {
  const data = store.getData();
  const now = nowTaipei();
  return {
    now,
    student,
    students: data.students,
    upcomingLessons: student ? getUpcomingLessons(data, student.id, now.date, null, { includeAll: true }) : [],
  };
}

let draftText = ''; // 切換分頁時保留輸入中的文字
let draftCode = '';

export function render(root, { actionsEl, navigate }) {
  actionsEl.innerHTML = `
    <button class="btn small ghost" data-a="log">紀錄</button>
    <button class="btn small ghost" data-a="clear">全部清除</button>`;
  actionsEl.querySelector('[data-a=log]').onclick = openLog;
  actionsEl.querySelector('[data-a=clear]').onclick = () => {
    if (!store.getData().chat.length) return toast('沒有卡片');
    if (!confirm('清除所有卡片？（已經寫入的異動不會被撤銷）')) return;
    store.update((d) => { d.chat = []; });
  };

  root.innerHTML = '';
  const list = el('<div class="cards" aria-live="polite"></div>');
  root.appendChild(list);

  const composer = el(`<form class="composer" autocomplete="off">
    <div class="composer-row">
      <div class="code-wrap">
        <input class="input code-input" name="code" placeholder="代號" inputmode="text" aria-label="學生代號" value="${escapeHtml(draftCode)}">
        <button type="button" class="icon-btn pick-btn" aria-label="選擇學生">▾</button>
      </div>
      <span class="code-hint" aria-live="polite"></span>
    </div>
    <div class="composer-row">
      <textarea class="input msg-input" name="text" rows="1" placeholder="貼上家長的訊息" aria-label="訊息內容">${escapeHtml(draftText)}</textarea>
      <button type="submit" class="btn primary send-btn">分析</button>
    </div>
  </form>`);
  root.appendChild(composer);

  const codeInput = composer.querySelector('.code-input');
  const textInput = composer.querySelector('.msg-input');
  const hint = composer.querySelector('.code-hint');

  const updateHint = () => {
    draftCode = codeInput.value;
    const c = normalizeCode(codeInput.value);
    if (!c) { hint.textContent = '空白時從訊息裡找'; hint.className = 'code-hint muted'; return; }
    const st = store.findStudentByCode(c);
    hint.textContent = st ? st.name : '找不到這個代號';
    hint.className = `code-hint ${st ? 'ok' : 'bad'}`;
  };
  const autoGrow = () => {
    textInput.style.height = 'auto';
    textInput.style.height = `${Math.min(textInput.scrollHeight, 140)}px`;
  };
  codeInput.addEventListener('input', updateHint);
  textInput.addEventListener('input', () => { draftText = textInput.value; autoGrow(); });
  composer.querySelector('.pick-btn').onclick = () => pickStudent((st) => {
    codeInput.value = st.code;
    updateHint();
    textInput.focus();
  });
  updateHint();
  setTimeout(autoGrow, 0);

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) { textInput.focus(); return toast('請貼上訊息'); }
    const card = analyze(normalizeCode(codeInput.value), text);
    store.update((d) => { d.chat.push(card); });
    textInput.value = '';
    draftText = '';
    autoGrow();
    if (!card.error) codeInput.value = card.code || codeInput.value;
    updateHint();
    scrollToBottom();
  });

  const drawCards = () => {
    const chat = store.getData().chat;
    list.innerHTML = '';
    if (!chat.length) {
      list.appendChild(el(`<div class="empty">
        <p>貼上家長的訊息，輸入學生代號，按「分析」。</p>
        <p class="hint">例如：001「週三請假」、002「明天改到後天同一時間」</p>
      </div>`));
      return;
    }
    for (const c of chat) list.appendChild(renderCard(c, navigate));
  };

  drawCards();
  const unsub = store.subscribe(drawCards);
  requestAnimationFrame(scrollToBottom);
  return () => unsub();
}

function scrollToBottom() {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
}

/** 分析一則訊息，產生卡片資料 */
function analyze(code, text) {
  const data = store.getData();
  const base = { id: uid('c'), at: new Date().toISOString(), text, status: 'pending' };
  const r = resolveStudent({ code, text, students: data.students });
  if (!r.student) {
    return { ...base, status: 'error', error: r.error, code: r.code || code, notFound: !!r.code };
  }
  let msg = text;
  // 從訊息裡找到的代號（例如「００１　週三請假」）先拿掉，避免被當成日期或數字
  if (r.matchedText) msg = toHalfWidth(text).replace(r.matchedText, ' ');
  const draft = parse(msg, parseOpts(r.student));
  draft.text = text;
  return { ...base, code: r.student.code, studentId: r.student.id, draft, status: draft.action === 'inquiry' ? 'info' : 'pending' };
}

function updateCard(id, fn) {
  store.update((d) => {
    const c = d.chat.find((x) => x.id === id);
    if (c) fn(c, d);
  });
}

// ---------- 卡片 ----------

function renderCard(card, navigate) {
  const st = card.studentId ? store.findStudent(card.studentId) : null;
  const wrap = el(`<article class="msg-card card status-${card.status}" data-id="${card.id}">
    <button class="icon-btn card-x" aria-label="刪除卡片">×</button>
    <p class="msg-src">${escapeHtml(card.text)}</p>
  </article>`);
  wrap.querySelector('.card-x').onclick = () => store.update((d) => { d.chat = d.chat.filter((x) => x.id !== card.id); });

  if (card.status === 'error') {
    wrap.appendChild(el(`<p class="msg-error">${escapeHtml(card.error)}</p>`));
    if (card.notFound) {
      const b = el('<button class="btn small">前往學生頁</button>');
      b.onclick = () => navigate('students');
      wrap.appendChild(b);
    }
    return wrap;
  }

  const draft = card.draft;
  wrap.appendChild(el(`<p class="msg-student">${st ? `<b>${escapeHtml(st.code)}</b> ${escapeHtml(st.name)}` : escapeHtml(card.code)} <span class="pill">${ACTION_LABELS[draft.action]}</span></p>`));
  wrap.appendChild(el(`<p class="msg-summary">${card.status === 'done' ? '✓ ' : ''}${escapeHtml(draft.summary)}</p>`));

  if (card.status === 'done') {
    if (card.results && card.results.length) {
      wrap.appendChild(el(`<p class="hint">已寫入：${card.results.map(escapeHtml).join('；')}</p>`));
    }
    return wrap;
  }
  if (card.status === 'cancelled') {
    wrap.appendChild(el('<p class="hint">已取消</p>'));
    return wrap;
  }
  if (card.status === 'info') {
    wrap.appendChild(el('<p class="hint">詢問只顯示課程資訊，不會寫入資料。</p>'));
    return wrap;
  }
  if (!st) {
    wrap.appendChild(el('<p class="msg-error">這位學生已經被刪除。</p>'));
    return wrap;
  }

  // 追問
  for (const qn of draft.questions) wrap.appendChild(renderQuestion(card, qn, st));

  // 修改
  const edit = el(`<details class="msg-edit"><summary>修改</summary></details>`);
  edit.appendChild(renderEditor(card, st));
  wrap.appendChild(edit);

  // 按鈕
  const missing = missingFor(draft);
  const btns = el(`<div class="btn-row card-actions">
    <button class="btn" data-a="cancel">取消</button>
    <button class="btn primary" data-a="ok" ${missing ? 'disabled' : ''}>確認寫入</button>
  </div>`);
  if (missing && !draft.questions.length) wrap.appendChild(el(`<p class="hint warn-text">${escapeHtml(missing)}</p>`));
  btns.querySelector('[data-a=cancel]').onclick = () => updateCard(card.id, (c) => { c.status = 'cancelled'; });
  btns.querySelector('[data-a=ok]').onclick = () => {
    if (missingFor(card.draft)) return;
    let results = [];
    store.update((d) => {
      results = commitDraft(d, card.draft);
      const c = d.chat.find((x) => x.id === card.id);
      if (c) { c.status = 'done'; c.results = results; c.doneAt = new Date().toISOString(); }
    });
    toast(results.length ? '已寫入課表' : '沒有寫入任何資料');
  };
  wrap.appendChild(btns);
  return wrap;
}

function answer(card, qn, value, st) {
  updateCard(card.id, (c) => {
    c.draft = applyAnswer(c.draft, qn.id, value, parseOpts(st));
    c.draft.text = card.text;
  });
}

function renderQuestion(card, qn, st) {
  const box = el(`<div class="question">
    <p class="q-text">${escapeHtml(qn.text)}</p>
    <div class="chips q-options"></div>
  </div>`);
  const opts = box.querySelector('.q-options');
  for (const o of qn.options || []) {
    const isDefault = qn.default != null && JSON.stringify(qn.default) === JSON.stringify(o.value);
    const b = el(`<button class="chip ${isDefault ? 'on' : ''}">${escapeHtml(o.label)}</button>`);
    b.onclick = () => answer(card, qn, o.value, st);
    opts.appendChild(b);
  }
  if (!qn.options?.length) opts.remove();

  const def = qn.default || {};
  let form = null;
  if (qn.input === 'date') {
    form = el(`<div class="q-input row"><input class="input" type="date" value="${typeof qn.default === 'string' ? qn.default : nowTaipei().date}"><button class="btn primary">確定</button></div>`);
    form.querySelector('button').onclick = () => { const v = form.querySelector('input').value; if (v) answer(card, qn, v, st); };
  } else if (qn.input === 'time') {
    form = el(`<div class="q-input row"><select class="input">${timeOptions(typeof qn.default === 'string' ? qn.default : '18:00')}</select><button class="btn primary">確定</button></div>`);
    form.querySelector('button').onclick = () => answer(card, qn, form.querySelector('select').value, st);
  } else if (qn.input === 'datetime') {
    form = el(`<div class="q-input">
      <div class="row">
        <input class="input" type="date" value="${def.date || ''}" aria-label="日期">
        <select class="input" aria-label="開始時間">${timeOptions(def.start || '18:00')}</select>
      </div>
      <button class="btn primary block">確定</button></div>`);
    form.querySelector('button').onclick = () => {
      const date = form.querySelector('input').value;
      if (!date) return toast('請選擇日期');
      answer(card, qn, { date, start: form.querySelector('select').value }, st);
    };
  } else if (qn.input === 'range') {
    const today = nowTaipei().date;
    form = el(`<div class="q-input">
      <div class="row">
        <label class="field"><span>從</span><input class="input" type="date" data-f="from" value="${def.from || today}"></label>
        <label class="field"><span>到</span><input class="input" type="date" data-f="to" value="${def.to || addDays(today, 6)}"></label>
      </div>
      <button class="btn primary block">確定</button></div>`);
    form.querySelector('button').onclick = () => {
      const from = form.querySelector('[data-f=from]').value;
      const to = form.querySelector('[data-f=to]').value;
      if (!from || !to || from > to) return toast('請選擇正確的起訖日期');
      answer(card, qn, { from, to }, st);
    };
  } else if (qn.input === 'minutes') {
    const sign = qn.sign || 1;
    form = el(`<div class="q-input row"><input class="input" type="number" inputmode="numeric" min="1" placeholder="其他分鐘數"><button class="btn primary">確定</button></div>`);
    form.querySelector('button').onclick = () => {
      const n = Number(form.querySelector('input').value);
      if (!(n > 0)) return toast('請輸入分鐘數');
      answer(card, qn, qn.field === 'minutes' ? sign * n : n, st);
    };
  } else if (qn.input === 'weekly') {
    form = el(`<div class="q-input">
      <div class="row">
        <select class="input" data-f="wd"><option value="">星期不變</option>${WD_NAMES.map((n, i) => `<option value="${i}">週${n}</option>`).join('')}</select>
        <select class="input" data-f="start"><option value="">時間不變</option>${timeOptions(null)}</select>
      </div>
      <button class="btn primary block">確定</button></div>`);
    form.querySelector('button').onclick = () => {
      const wd = form.querySelector('[data-f=wd]').value;
      const start = form.querySelector('[data-f=start]').value;
      if (wd === '' && !start) return toast('請選擇要改成星期幾或幾點');
      answer(card, qn, { wd: wd === '' ? null : Number(wd), start: start || null }, st);
    };
  }
  if (form) box.appendChild(form);
  return box;
}

// ---------- 可編輯欄位 ----------

function renderEditor(card, st) {
  const draft = card.draft;
  const opts = parseOpts(st);
  const lessons = opts.upcomingLessons.filter((l) => l.status !== 'moved').slice(0, 24);
  // 目前的目標如果不在清單裡（例如過去的日期），也要列出來
  for (const k of draft.targets) {
    if (!lessons.some((l) => l.key === k)) {
      const l = (draft._lessons || []).find((x) => x.key === k);
      if (l) lessons.unshift(l);
    }
  }
  const a = draft.action;
  const needTargets = ['leave', 'undo', 'move', 'shift', 'late', 'duration'].includes(a) && !(a === 'undo' && draft.range);
  const to = draft.to || {};
  const p = draft.permanent || { slotIds: [], wd: null, start: null, duration: null, effectiveFrom: opts.now.date };
  const activeSlots = st.slots.filter((s) => !s.validTo || s.validTo >= opts.now.date);

  const box = el(`<div class="edit-box">
    <label class="field"><span>動作類型</span><select class="input" data-f="action">
      ${ACTIONS.map((x) => `<option value="${x}" ${x === a ? 'selected' : ''}>${ACTION_LABELS[x]}</option>`).join('')}
    </select></label>
    ${needTargets ? `<div class="field"><span>原本那堂${a === 'move' ? '' : '（可多選）'}</span>
      <div class="target-list">${lessons.map((l) => `<label class="check"><input type="${a === 'move' ? 'radio' : 'checkbox'}" name="tg-${card.id}" value="${escapeHtml(l.key)}" ${draft.targets.includes(l.key) ? 'checked' : ''}>
        ${fmtMDW(l.date)} ${l.start}${l.status === 'leave' ? '（請假）' : l.status === 'stop' ? '（停課）' : l.kind !== 'base' ? `（${{ add: '加課', makeup: '補課', moved: '改課' }[l.kind]}）` : ''}</label>`).join('') || '<p class="hint">接下來 8 週沒有課</p>'}</div></div>` : ''}
    ${['move', 'add', 'makeup'].includes(a) ? `<div class="row">
      <label class="field"><span>新的日期</span><input class="input" type="date" data-f="to.date" value="${to.date || ''}"></label>
      <label class="field"><span>新的開始時間</span><select class="input" data-f="to.start"><option value="">未選</option>${timeOptions(to.start || null)}</select></label>
    </div>
    <label class="field"><span>時長</span><select class="input" data-f="to.duration">${durationOptions(to.duration || 60)}</select></label>` : ''}
    ${['shift', 'late'].includes(a) ? `<label class="field"><span>${a === 'shift' ? '分鐘數（正數延後、負數提早）' : '晚到幾分鐘（0＝不確定）'}</span>
      <input class="input" type="number" inputmode="numeric" data-f="minutes" value="${draft.minutes ?? ''}"></label>` : ''}
    ${a === 'duration' ? `<label class="field"><span>改成上多久（分鐘）</span><input class="input" type="number" inputmode="numeric" min="10" step="5" data-f="newDuration" value="${draft.newDuration ?? ''}"></label>` : ''}
    ${a === 'stop_range' || (a === 'undo' && draft.range) ? `<div class="row">
      <label class="field"><span>區間起</span><input class="input" type="date" data-f="range.from" value="${draft.range?.from || ''}"></label>
      <label class="field"><span>區間迄</span><input class="input" type="date" data-f="range.to" value="${draft.range?.to || ''}"></label>
    </div>` : ''}
    ${a === 'end' ? `<label class="field"><span>最後一天</span><input class="input" type="date" data-f="endDate" value="${draft.endDate || ''}"></label>` : ''}
    ${a === 'permanent' ? `<div class="field"><span>要改的固定時段</span>
      <div class="target-list">${activeSlots.map((s) => `<label class="check"><input type="checkbox" data-slot value="${s.id}" ${p.slotIds.includes(s.id) ? 'checked' : ''}> 週${WD_NAMES[s.wd]} ${s.start}–${minToTime(timeToMin(s.start) + s.duration)}</label>`).join('')}</div></div>
      <div class="row">
        <label class="field"><span>改成星期</span><select class="input" data-f="perm.wd"><option value="">不變</option>${WD_NAMES.map((n, i) => `<option value="${i}" ${p.wd === i ? 'selected' : ''}>週${n}</option>`).join('')}</select></label>
        <label class="field"><span>改成時間</span><select class="input" data-f="perm.start"><option value="">不變</option>${timeOptions(p.start || null)}</select></label>
      </div>
      <div class="row">
        <label class="field"><span>時長（分鐘）</span><input class="input" type="number" inputmode="numeric" data-f="perm.duration" placeholder="不變" value="${p.duration ?? ''}"></label>
        <label class="field"><span>生效日</span><input class="input" type="date" data-f="perm.from" value="${p.effectiveFrom || ''}"></label>
      </div>` : ''}
  </div>`);
  if (!st.slots.length || (a === 'permanent' && !activeSlots.length)) box.appendChild(el('<p class="hint">這位學生沒有固定時段。</p>'));
  // 「未選」那個 option：timeOptions(null) 會產生完整清單，但沒有選中的項目
  box.querySelectorAll('select[data-f="to.start"], select[data-f="perm.start"]').forEach((s) => {
    const cur = s.dataset.f === 'to.start' ? to.start : p.start;
    if (!cur) s.value = '';
  });

  box.querySelector('[data-f=action]').onchange = (e) => {
    updateCard(card.id, (c) => {
      c.draft = reparseAs(card.text, e.target.value, parseOpts(st));
      c.draft.text = card.text;
    });
  };

  const edit = (fn, clearFields = []) => updateCard(card.id, (c) => {
    fn(c.draft);
    c.draft.questions = c.draft.questions.filter((x) => !clearFields.includes(x.field));
    c.draft.summary = summarizeDraft(c.draft, parseOpts(st));
  });

  box.querySelectorAll(`input[name="tg-${card.id}"]`).forEach((inp) => {
    inp.onchange = () => {
      const keys = [...box.querySelectorAll(`input[name="tg-${card.id}"]:checked`)].map((x) => x.value);
      edit((dr) => {
        dr.targets = keys;
        const known = new Map((dr._lessons || []).map((l) => [l.key, l]));
        for (const l of lessons) known.set(l.key, l);
        dr._lessons = [...known.values()];
        const l = known.get(keys[0]);
        if (l && dr.action === 'shift' && dr.minutes) dr.to = { date: l.date, start: minToTime(timeToMin(l.start) + dr.minutes), duration: l.duration };
        if (l && dr.action === 'duration' && dr.newDuration) dr.minutes = dr.newDuration - l.duration;
      }, keys.length ? ['target', 'confirmPast'] : []);
    };
  });
  const bind = (sel, fn, clear) => {
    const n = box.querySelector(sel);
    if (n) n.onchange = () => edit((dr) => fn(dr, n.value), clear);
  };
  bind('[data-f="to.date"]', (dr, v) => { dr.to = { ...(dr.to || {}), date: v || null }; }, ['to', 'to.date', 'confirmPast']);
  bind('[data-f="to.start"]', (dr, v) => { dr.to = { ...(dr.to || {}), start: v || null }; }, ['to', 'to.start']);
  bind('[data-f="to.duration"]', (dr, v) => { dr.to = { ...(dr.to || {}), duration: Number(v) }; });
  bind('[data-f=minutes]', (dr, v) => {
    dr.minutes = v === '' ? null : Number(v);
    const l = (dr._lessons || []).find((x) => x.key === dr.targets[0]);
    if (l && dr.action === 'shift' && dr.minutes) dr.to = { date: l.date, start: minToTime(timeToMin(l.start) + dr.minutes), duration: l.duration };
  }, ['minutes']);
  bind('[data-f=newDuration]', (dr, v) => {
    dr.newDuration = v === '' ? null : Number(v);
    const l = (dr._lessons || []).find((x) => x.key === dr.targets[0]);
    if (l && dr.newDuration) dr.minutes = dr.newDuration - l.duration;
  }, ['newDuration']);
  bind('[data-f="range.from"]', (dr, v) => { dr.range = { ...(dr.range || {}), from: v }; }, ['range']);
  bind('[data-f="range.to"]', (dr, v) => { dr.range = { ...(dr.range || {}), to: v }; }, ['range']);
  bind('[data-f=endDate]', (dr, v) => { dr.endDate = v || null; }, ['endDate']);
  bind('[data-f="perm.wd"]', (dr, v) => { dr.permanent.wd = v === '' ? null : Number(v); }, ['permanent.change']);
  bind('[data-f="perm.start"]', (dr, v) => { dr.permanent.start = v || null; }, ['permanent.change', 'permanent.start']);
  bind('[data-f="perm.duration"]', (dr, v) => { dr.permanent.duration = v === '' ? null : Number(v); }, ['permanent.change']);
  bind('[data-f="perm.from"]', (dr, v) => { dr.permanent.effectiveFrom = v; });
  box.querySelectorAll('[data-slot]').forEach((inp) => {
    inp.onchange = () => {
      const ids = [...box.querySelectorAll('[data-slot]:checked')].map((x) => x.value);
      edit((dr) => {
        if (!dr.permanent) dr.permanent = { ...p };
        dr.permanent.slotIds = ids;
      }, ids.length ? ['permanent.slotIds'] : []);
    };
  });
  return box;
}

// ---------- 選學生、紀錄 ----------

function pickStudent(onPick) {
  const data = store.getData();
  const students = [...data.students].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hant', { numeric: true }));
  const body = el(`<div class="pick-list">${students.length ? students.map((s) => `<button class="pick-item" data-id="${escapeHtml(s.id)}"><b>${escapeHtml(s.code)}</b> ${escapeHtml(s.name)}<span class="muted">${escapeHtml(s.grade || '')}</span></button>`).join('') : '<p class="empty">還沒有學生</p>'}</div>`);
  const sheet = openSheet({ title: '選擇學生', body });
  body.querySelectorAll('.pick-item').forEach((b) => {
    b.onclick = () => { sheet.close(); onPick(store.findStudent(b.dataset.id)); };
  });
}

function openLog() {
  const data = store.getData();
  const byId = new Map(data.students.map((s) => [s.id, s]));
  const items = [...data.log].reverse();
  const fmtAt = (iso) => {
    const n = nowTaipei(new Date(iso));
    return `${fmtMD(n.date)} ${n.time}`;
  };
  const body = el(`<div class="log-list">${items.length ? items.map((x) => {
    const st = byId.get(x.studentId);
    return `<div class="log-item">
      <div class="log-head"><span class="muted">${fmtAt(x.at)}</span> ${st ? `<b>${escapeHtml(st.code)}</b> ${escapeHtml(st.name)}` : '<span class="muted">（已刪除的學生）</span>'}</div>
      <div>${escapeHtml(x.summary)}</div>
      ${x.sourceText ? `<div class="hint">「${escapeHtml(x.sourceText)}」</div>` : ''}
    </div>`;
  }).join('') : '<p class="empty">還沒有紀錄</p>'}</div>`);
  openSheet({ title: `紀錄（${items.length}）`, body });
}
