// 第二頁：週課表
import * as store from '../store.js';
import { el, openSheet, toast, escapeHtml, timeOptions, durationOptions } from '../ui.js';
import {
  nowTaipei, mondayOf, addDays, parseISO, isoWeek, weekday, fmtMD, fmtMDW,
  timeToMin, minToTime, WD_NAMES,
} from '../dates.js';
import { getLessons, pendingLeaves } from '../schedule.js';
import * as A from '../actions.js';

const SLOT_H = 28; // 每 30 分鐘的高度（px）

let weekMonday = null; // 切換分頁後保留目前看的週

export function render(root, { navigate }) {
  const today = nowTaipei().date;
  if (!weekMonday) weekMonday = mondayOf(today);

  const draw = () => {
    const data = store.getData();
    const tdy = nowTaipei().date;
    const days = data.settings.visibleDays.length ? [...data.settings.visibleDays].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
    const lessons = getLessons(data, weekMonday);

    // 縱軸範圍：設定的起訖，若有課超出就自動擴大
    let startMin = timeToMin(data.settings.dayStart);
    let endMin = timeToMin(data.settings.dayEnd);
    for (const l of lessons) {
      if (!days.includes(weekday(l.date))) continue;
      startMin = Math.min(startMin, Math.floor(timeToMin(l.start) / 30) * 30);
      endMin = Math.max(endMin, Math.ceil((timeToMin(l.start) + l.duration) / 30) * 30);
    }
    endMin = Math.min(endMin, 24 * 60);
    const rows = (endMin - startMin) / 30;

    root.innerHTML = '';
    root.appendChild(weekBar(tdy));

    const grid = el(`<div class="sched" style="--cols:${days.length};--slot-h:${SLOT_H}px">
      <div class="sched-head">
        <div class="sched-corner"></div>
        ${days.map((wd) => {
          const date = addDays(weekMonday, wd);
          return `<div class="sched-dayhead ${date === tdy ? 'today' : ''}"><b>${WD_NAMES[wd]}</b><span>${fmtMD(date)}</span></div>`;
        }).join('')}
      </div>
      <div class="sched-body" style="height:${rows * SLOT_H}px">
        <div class="sched-axis">
          ${Array.from({ length: rows }, (_, i) => {
            const m = startMin + i * 30;
            return `<div class="axis-cell">${m % 60 === 0 ? minToTime(m) : ''}</div>`;
          }).join('')}
        </div>
        ${days.map((wd) => {
          const date = addDays(weekMonday, wd);
          return `<div class="sched-col ${date === tdy ? 'today' : ''}" data-date="${date}"></div>`;
        }).join('')}
      </div>
    </div>`);

    // 依日期放入課程方塊
    for (const wd of days) {
      const date = addDays(weekMonday, wd);
      const col = grid.querySelector(`.sched-col[data-date="${date}"]`);
      for (let i = 0; i < rows; i++) {
        col.appendChild(el(`<div class="grid-line ${(startMin + i * 30) % 60 === 0 ? 'hour' : 'half'}" style="top:${i * SLOT_H}px"></div>`));
      }
      if (date === tdy) {
        const n = timeToMin(nowTaipei().time);
        if (n >= startMin && n <= endMin) col.appendChild(el(`<div class="now-line" style="top:${((n - startMin) / 30) * SLOT_H}px"></div>`));
      }
      const dayLessons = lessons.filter((l) => l.date === date);
      for (const { lesson, col: c, cols } of layoutDay(dayLessons)) {
        col.appendChild(lessonBlock(lesson, c, cols, startMin));
      }
    }

    grid.querySelector('.sched-body').addEventListener('click', (e) => {
      const block = e.target.closest('.lesson');
      if (block) {
        const lesson = lessons.find((l) => l.key === block.dataset.key);
        if (lesson) openLessonSheet(lesson, navigate);
        return;
      }
      const col = e.target.closest('.sched-col');
      if (!col) return;
      const y = e.clientY - col.getBoundingClientRect().top;
      const start = minToTime(startMin + Math.max(0, Math.floor(y / SLOT_H)) * 30);
      openAddSheet(col.dataset.date, start, navigate);
    });

    addSwipe(grid, (dir) => { weekMonday = addDays(weekMonday, dir * 7); draw(); });
    root.appendChild(grid);

    if (!data.students.length) {
      root.appendChild(el(`<p class="hint" style="text-align:center">還沒有學生。到「學生」頁新增學生和固定時段後，課表就會出現。</p>`));
    }
  };

  function weekBar(tdy) {
    const sun = addDays(weekMonday, 6);
    const a = parseISO(weekMonday), b = parseISO(sun);
    const range = a.y !== b.y ? `${a.y} 年 ${a.m} 月 ${a.d} 日 – ${b.y} 年 ${b.m} 月 ${b.d} 日`
      : a.m !== b.m ? `${a.y} 年 ${a.m} 月 ${a.d} 日 – ${b.m} 月 ${b.d} 日`
      : `${a.y} 年 ${a.m} 月 ${a.d} 日 – ${b.d} 日`;
    const bar = el(`<div class="weekbar">
      <button class="icon-btn" data-nav="-1" aria-label="上一週">‹</button>
      <div class="weekbar-label"><span>${range}</span><small>第 ${isoWeek(weekMonday)} 週</small></div>
      <button class="icon-btn" data-nav="1" aria-label="下一週">›</button>
      <button class="btn small" data-nav="0" ${weekMonday === mondayOf(tdy) ? 'disabled' : ''}>今天</button>
    </div>`);
    bar.querySelectorAll('[data-nav]').forEach((b) => {
      b.onclick = () => {
        const n = Number(b.dataset.nav);
        weekMonday = n === 0 ? mondayOf(nowTaipei().date) : addDays(weekMonday, n * 7);
        draw();
      };
    });
    return bar;
  }

  draw();
  const unsub = store.subscribe(draw);
  return () => unsub();
}

/** 同一時間有多堂課時，水平平分欄寬 */
function layoutDay(list) {
  const items = list
    .map((l) => ({ lesson: l, s: timeToMin(l.start), e: timeToMin(l.start) + l.duration }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds = [];
    for (const it of cluster) {
      let c = colEnds.findIndex((end) => end <= it.s);
      if (c === -1) { c = colEnds.length; colEnds.push(it.e); } else colEnds[c] = it.e;
      it.col = c;
    }
    for (const it of cluster) out.push({ lesson: it.lesson, col: it.col, cols: colEnds.length });
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

function lessonClass(l) {
  if (l.kind === 'add') return 'k-add';
  if (l.kind === 'makeup') return 'k-makeup';
  if (l.kind === 'moved') return 'k-moved';
  return `s-${l.status}`;
}

function lessonTag(l) {
  if (l.kind === 'add') return '加';
  if (l.kind === 'makeup') return '補';
  if (l.kind === 'moved') return '改';
  if (l.status === 'leave') return '假';
  if (l.status === 'stop') return '停';
  return '';
}

function lessonBlock(l, col, cols, startMin) {
  const top = ((timeToMin(l.start) - startMin) / 30) * SLOT_H;
  const height = Math.max((l.duration / 30) * SLOT_H, 20);
  const tag = lessonTag(l);
  const tall = height >= SLOT_H * 3 - 1;
  const mid = height >= SLOT_H * 2 - 1;
  let sub = '';
  if (l.status === 'moved') sub = l.movedTo ? `→ ${fmtMD(l.movedTo.date)} ${l.movedTo.start}` : '已改走';
  else if (tall) sub = `${escapeHtml(l.subjects.join('＋'))}</span><span class="ln-sub">${l.start}<span class="t-end">–${l.end}</span>`;
  else if (mid) sub = `${l.start}<span class="t-end">–${l.end}</span>`;
  const late = l.lateMin != null ? `<span class="late">${l.lateMin ? `晚${l.lateMin}` : '晚'}</span>` : '';
  return el(`<button class="lesson ${lessonClass(l)}" data-key="${escapeHtml(l.key)}"
      style="top:${top}px;height:${height}px;left:calc(${(col / cols) * 100}% + 1px);width:calc(${100 / cols}% - 2px)"
      aria-label="${escapeHtml(`${l.code} ${l.name} ${fmtMDW(l.date)} ${l.start}–${l.end} ${statusText(l)}`)}">
    ${tag ? `<span class="tag">${tag}</span>` : ''}${late}
    <span class="ln-name">${l.status === 'changed' ? '⏱' : ''}${mid ? `<i>${escapeHtml(l.code)}</i> ` : ''}${escapeHtml(l.name)}</span>
    ${sub ? `<span class="ln-sub">${sub}</span>` : ''}
  </button>`);
}

function statusText(l) {
  if (l.kind === 'add') return '加課';
  if (l.kind === 'makeup') return '補課';
  if (l.kind === 'moved') return '改課（新時間）';
  return { normal: '正常', leave: l.makeupPending ? '請假（待補課）' : '請假', stop: '停課', moved: '已改走', changed: '時間有變更' }[l.status] || '';
}

function addSwipe(node, onSwipe) {
  let x0 = null, y0 = null, t0 = 0;
  node.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  node.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && Date.now() - t0 < 600) onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------- 課程詳細面板 ----------

function run(fn, sheet) {
  const summary = store.update(fn);
  if (summary) toast(summary);
  sheet.close();
}

function openLessonSheet(l, navigate) {
  const data = store.getData();
  const st = store.findStudent(l.studentId);
  const isExtra = !!l.extraId;
  const canEdit = l.status === 'normal' || l.status === 'changed' || isExtra;
  const pend = pendingLeaves(data, l.studentId).length;
  let fromInfo = '';
  if (l.kind === 'moved' && l.fromKey) fromInfo = `原本是 ${fmtMDW(l.fromKey.split('@')[1])}`;
  if (l.kind === 'makeup' && l.fromKey) fromInfo = `補 ${fmtMDW(l.fromKey.split('@')[1])} 的請假`;

  const body = el(`<div class="lesson-sheet">
    <div class="ls-info card">
      <div class="ls-title"><span class="code">${escapeHtml(l.code)}</span> ${escapeHtml(l.name)} <span class="pill ${lessonClass(l)}">${statusText(l)}</span></div>
      <div class="ls-time">${fmtMDW(l.date)} ${l.start}–${l.end}（${l.duration} 分）</div>
      <div class="ls-meta">${escapeHtml(l.subjects.join('＋') || '未設定科目')}${l.lateMin != null ? ` · ${l.lateMin ? `晚到 ${l.lateMin} 分` : '會晚到'}` : ''}</div>
      ${l.status === 'moved' && l.movedTo ? `<div class="ls-meta">已改到 ${fmtMDW(l.movedTo.date)} ${l.movedTo.start}</div>` : ''}
      ${fromInfo ? `<div class="ls-meta">${fromInfo}</div>` : ''}
      ${l.note ? `<div class="ls-meta">備註：${escapeHtml(l.note)}</div>` : ''}
      ${pend ? `<div class="ls-meta">這位學生待補 ${pend} 堂</div>` : ''}
    </div>
    <div class="ls-actions"></div>
  </div>`);
  const actions = body.querySelector('.ls-actions');
  const sheet = openSheet({ title: '課程', body });

  if (l.status === 'leave') {
    actions.appendChild(el(`<label class="check card-row"><input type="checkbox" ${l.makeupPending ? 'checked' : ''}> 待補課</label>`));
    actions.querySelector('input').onchange = () => {
      const s = store.update((d) => A.toggleMakeupPending(d, l.key));
      if (s) toast(s);
    };
    addBtn(actions, '取消請假，照常上課', 'primary', () => run((d) => A.undoLesson(d, l.key), sheet));
  } else if (l.status === 'stop') {
    addBtn(actions, '這堂照常上', 'primary', () => run((d) => A.undoLesson(d, l.key), sheet));
    addBtn(actions, '改成請假（待補課）', '', () => run((d) => A.setLeave(d, l.key), sheet));
  } else if (l.status === 'moved') {
    addBtn(actions, '取消改課，恢復原本時間', 'primary', () => run((d) => A.restoreLesson(d, l.key), sheet));
  }

  if (canEdit) {
    // 請假
    const leave = el(`<div class="action-group">
      <div class="row-between"><button class="btn primary" data-a="leave">請假</button>
      ${isExtra ? '' : '<label class="check"><input type="checkbox" checked data-a="pending"> 待補課</label>'}</div>
      ${isExtra ? `<p class="hint">${l.kind === 'moved' ? '改課後的這堂請假，會回到原本那堂並標記請假。' : '加課或補課請假，會直接刪除這堂。'}</p>` : ''}
    </div>`);
    leave.querySelector('[data-a=leave]').onclick = () => {
      const pending = leave.querySelector('[data-a=pending]');
      run((d) => A.setLeave(d, l.key, { makeupPending: pending ? pending.checked : true }), sheet);
    };
    actions.appendChild(leave);

    // 改這一次的時間
    const move = details('改這一次的時間', `
      <div class="row">
        <label class="field"><span>日期</span><input class="input" type="date" data-f="date" value="${l.date}"></label>
        <label class="field"><span>開始</span><select class="input" data-f="start">${timeOptions(l.start)}</select></label>
      </div>
      <label class="field"><span>時長</span><select class="input" data-f="dur">${durationOptions(l.duration)}</select></label>
      <button class="btn primary block" data-a="ok">確定改時間</button>`);
    move.querySelector('[data-a=ok]').onclick = () => {
      const date = move.querySelector('[data-f=date]').value;
      if (!date) return toast('請選擇日期');
      run((d) => A.moveLesson(d, l.key, { date, start: move.querySelector('[data-f=start]').value, duration: Number(move.querySelector('[data-f=dur]').value) }), sheet);
    };
    actions.appendChild(move);

    // 延長或縮短
    const dur = details('延長或縮短', `
      <div class="chips">${[-30, -15, 15, 30, 60].map((m) => `<button class="chip" data-m="${m}">${m > 0 ? '+' : '−'}${Math.abs(m)} 分</button>`).join('')}</div>
      <div class="row" style="margin-top:8px">
        <label class="field"><span>改成總共（分鐘）</span><input class="input" type="number" inputmode="numeric" min="10" step="5" data-f="total" value="${l.duration}"></label>
      </div>
      <button class="btn primary block" data-a="ok">確定</button>`);
    const total = dur.querySelector('[data-f=total]');
    dur.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { total.value = Math.max(10, l.duration + Number(b.dataset.m)); }; });
    dur.querySelector('[data-a=ok]').onclick = () => {
      const n = Number(total.value);
      if (!(n >= 10 && n <= 600)) return toast('時長要在 10～600 分鐘之間');
      run((d) => A.changeLesson(d, l.key, { duration: n }, { label: n > l.duration ? '延長為' : '縮短為' }), sheet);
    };
    actions.appendChild(dur);

    // 延後或提早
    const shift = details('延後或提早開始', `
      <div class="chips">${[-60, -30, -15, 15, 30, 60].map((m) => `<button class="chip" data-m="${m}">${m > 0 ? '延後' : '提早'} ${Math.abs(m)} 分</button>`).join('')}</div>`);
    shift.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => {
        const m = Number(b.dataset.m);
        const start = minToTime(timeToMin(l.start) + m);
        run((d) => A.changeLesson(d, l.key, { start }, { label: m > 0 ? `延後 ${m} 分，改為` : `提早 ${-m} 分，改為` }), sheet);
      };
    });
    actions.appendChild(shift);

    // 遲到
    const late = details('標記遲到', `
      <div class="chips">${[5, 10, 15, 20, 30].map((m) => `<button class="chip ${l.lateMin === m ? 'on' : ''}" data-m="${m}">晚 ${m} 分</button>`).join('')}
      <button class="chip ${l.lateMin === 0 ? 'on' : ''}" data-m="0">不確定</button>
      ${l.lateMin != null ? '<button class="chip" data-m="clear">清除遲到</button>' : ''}</div>
      <p class="hint">遲到只是標記，不會改變上課時間。</p>`);
    late.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => run((d) => A.setLate(d, l.key, b.dataset.m === 'clear' ? null : Number(b.dataset.m)), sheet);
    });
    actions.appendChild(late);
  }

  const hasOverride = !isExtra && data.overrides[l.key];
  if (isExtra) {
    addBtn(actions, l.kind === 'moved' ? '取消改課，恢復原本時間' : '刪除這堂', 'danger', () => {
      if (confirm(l.kind === 'moved' ? '取消這次改課，恢復原本的時間？' : `刪除 ${fmtMDW(l.date)} ${l.start} 這堂${l.kind === 'makeup' ? '補課' : '加課'}？`)) {
        run((d) => A.restoreLesson(d, l.key), sheet);
      }
    });
  } else if (hasOverride && l.status !== 'moved') {
    addBtn(actions, '恢復原狀', 'danger', () => run((d) => A.restoreLesson(d, l.key), sheet));
  }

  if (st && st.phone) {
    actions.appendChild(el(`<a class="btn block" href="tel:${escapeHtml(st.phone.replace(/[^\d+]/g, ''))}">📞 打電話給${escapeHtml(st.parentName || '家長')}（${escapeHtml(st.phone)}）</a>`));
  }
  const goStudent = addBtn(actions, '查看學生資料', 'ghost', async () => {
    sheet.close();
    const mod = await import('./students.js');
    mod.openEditor(l.studentId);
  });
  goStudent.classList.add('block');
}

function addBtn(parent, label, cls, onClick) {
  const b = el(`<button class="btn block ${cls}">${escapeHtml(label)}</button>`);
  b.onclick = onClick;
  parent.appendChild(b);
  return b;
}

function details(summary, inner) {
  return el(`<details class="action-details card"><summary>${escapeHtml(summary)}</summary><div class="ad-body">${inner}</div></details>`);
}

// ---------- 新增課程面板 ----------

function openAddSheet(date, start, navigate) {
  const data = store.getData();
  if (!data.students.length) {
    const body = el(`<div><p>還沒有學生，請先到「學生」頁新增。</p><button class="btn primary block">前往學生頁</button></div>`);
    const sheet = openSheet({ title: '新增課程', body });
    body.querySelector('button').onclick = () => { sheet.close(); navigate('students'); };
    return;
  }
  const students = [...data.students].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hant', { numeric: true }));
  const body = el(`<form class="add-form" novalidate>
    <label class="field"><span>學生</span><select class="input" name="student">
      <option value="">請選擇學生</option>
      ${students.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.code)} ${escapeHtml(s.name)}${pendingLeaves(data, s.id).length ? `（待補 ${pendingLeaves(data, s.id).length}）` : ''}</option>`).join('')}
    </select></label>
    <div class="field"><span>類型</span>
      <div class="seg"><label><input type="radio" name="kind" value="add" checked><span>加課</span></label><label><input type="radio" name="kind" value="makeup"><span>補課</span></label></div>
    </div>
    <div class="row">
      <label class="field"><span>日期</span><input class="input" type="date" name="date" value="${date}"></label>
      <label class="field"><span>開始</span><select class="input" name="start">${timeOptions(start)}</select></label>
    </div>
    <label class="field"><span>時長</span><select class="input" name="duration">${durationOptions(90)}</select></label>
    <p class="hint" data-hint></p>
    <button type="submit" class="btn primary block">新增</button>
  </form>`);
  const form = body;
  const hint = form.querySelector('[data-hint]');
  const refresh = () => {
    const sid = form.student.value;
    const st = sid && store.findStudent(sid);
    const kind = form.querySelector('[name=kind]:checked').value;
    if (st && st.slots[0]) form.duration.innerHTML = durationOptions(st.slots[0].duration);
    const pend = sid ? pendingLeaves(store.getData(), sid) : [];
    hint.textContent = kind === 'makeup'
      ? (pend.length ? `會自動對應最早一筆待補的請假：${fmtMDW(pend[0].split('@')[1])}` : (sid ? '這位學生目前沒有待補的請假。' : ''))
      : '';
  };
  form.student.onchange = refresh;
  form.querySelectorAll('[name=kind]').forEach((r) => { r.onchange = refresh; });
  const sheet = openSheet({ title: `新增課程　${fmtMDW(date)}`, body });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.student.value) { form.student.classList.add('invalid'); return toast('請選擇學生'); }
    if (!form.date.value) return toast('請選擇日期');
    const kind = form.querySelector('[name=kind]:checked').value;
    run((d) => A.addExtra(d, {
      studentId: form.student.value, kind, date: form.date.value, start: form.start.value, duration: Number(form.duration.value),
    }), sheet);
  });
}
