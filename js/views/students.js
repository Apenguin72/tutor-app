// 第三頁：學生
import * as store from '../store.js';
import { el, openSheet, toast, shareOrDownload, escapeHtml } from '../ui.js';
import { uid, normalizeCode } from '../util.js';
import { nowTaipei, compactDate, WD_NAMES, timeToMin, minToTime } from '../dates.js';
import { currentSlots, slotLabel, pendingLeaves } from '../schedule.js';
import { buildStudentsCSV, studentSubjects, feeLabel } from '../csv.js';

const COMMON_SUBJECTS = ['數學', '英文', '國文', '理化', '自然', '物理', '化學', '生物', '社會', '作文'];
const DURATIONS = [30, 60, 90, 120, 150, 180];

export function render(root, { actionsEl }) {
  const draw = () => {
    const data = store.getData();
    const today = nowTaipei().date;
    const students = [...data.students].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hant', { numeric: true }));

    root.innerHTML = '';
    const bar = el(`<div class="toolbar">
      <button class="btn primary" data-act="add">＋ 新增學生</button>
      <button class="btn" data-act="csv" ${students.length ? '' : 'disabled'}>匯出 CSV</button>
    </div>`);
    bar.querySelector('[data-act=add]').onclick = () => openEditor(null);
    bar.querySelector('[data-act=csv]').onclick = exportCSV;
    root.appendChild(bar);

    if (!students.length) {
      root.appendChild(el(`<div class="empty">還沒有學生。<br>按「＋ 新增學生」開始建立名單。</div>`));
      return;
    }

    const rows = students.map((st) => {
      const slots = currentSlots(st, today).sort((a, b) => a.wd - b.wd || a.start.localeCompare(b.start));
      const pending = pendingLeaves(data, st.id).length;
      return `<tr data-id="${escapeHtml(st.id)}" tabindex="0">
        <th scope="row" class="sticky"><span class="code">${escapeHtml(st.code)}</span> ${escapeHtml(st.name)}</th>
        <td>${escapeHtml(st.parentName || '')}</td>
        <td class="nowrap">${escapeHtml(st.phone || '')}</td>
        <td class="nowrap">${escapeHtml(st.grade || '')}</td>
        <td>${escapeHtml(studentSubjects(st, today).join('、'))}</td>
        <td class="nowrap">${slots.map((s) => escapeHtml(slotLabel(s))).join('<br>')}</td>
        <td class="nowrap">${escapeHtml(feeLabel(st))}</td>
        <td class="nowrap">${pending ? `<span class="badge warn">待補 ${pending} 堂</span>` : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');

    const table = el(`<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th class="sticky">代號／姓名</th><th>家長</th><th>電話</th><th>年級</th><th>科目</th><th>每週時段</th><th>費用</th><th>待補</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`);
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const open = () => openEditor(tr.dataset.id);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
    root.appendChild(table);
    root.appendChild(el(`<p class="hint">共 ${students.length} 位學生。點一列可以編輯。</p>`));
  };

  draw();
  const unsub = store.subscribe(draw);
  return () => unsub();
}

async function exportCSV() {
  const today = nowTaipei().date;
  const csv = buildStudentsCSV(store.getData(), today);
  const res = await shareOrDownload(`學生名單_${compactDate(today)}.csv`, csv, 'text/csv;charset=utf-8');
  if (res === 'downloaded') toast('已下載學生名單');
}

function timeOptions(selected) {
  let html = '';
  for (let m = 6 * 60; m <= 23 * 60 + 30; m += 30) {
    const t = minToTime(m);
    html += `<option value="${t}" ${t === selected ? 'selected' : ''}>${t}</option>`;
  }
  if (selected && timeToMin(selected) % 30 !== 0) html = `<option value="${selected}" selected>${selected}</option>` + html;
  return html;
}

function splitSubjects(text) {
  return String(text || '').split(/[＋+、,，/／\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** 新增或編輯學生 */
export function openEditor(studentId, { onSaved } = {}) {
  const data = store.getData();
  const today = nowTaipei().date;
  const existing = studentId ? store.findStudent(studentId) : null;
  const st = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid('s'), code: '', name: '', parentName: '', phone: '', grade: '', address: '',
    fee: null, feeUnit: 'hour', note: '', slots: [],
  };
  // 只編輯目前或未來有效的時段，已結束的時段原樣保留
  const editable = currentSlots(st, today).map((s) => ({ ...s, subjects: [...(s.subjects || [])] }));
  const hiddenCount = st.slots.length - editable.length;

  const form = el(`<form class="student-form" novalidate>
    <div class="row">
      <label class="field"><span>代號 <b class="req">*</b></span>
        <input class="input" name="code" value="${escapeHtml(st.code)}" inputmode="text" autocomplete="off" required>
        <small class="field-error" data-err="code"></small></label>
      <label class="field"><span>學生姓名 <b class="req">*</b></span>
        <input class="input" name="name" value="${escapeHtml(st.name)}" autocomplete="off" required>
        <small class="field-error" data-err="name"></small></label>
    </div>
    <div class="row">
      <label class="field"><span>家長姓名</span><input class="input" name="parentName" value="${escapeHtml(st.parentName)}" autocomplete="off"></label>
      <label class="field"><span>年級</span><input class="input" name="grade" value="${escapeHtml(st.grade)}" autocomplete="off" placeholder="例如 國二"></label>
    </div>
    <label class="field"><span>電話</span><input class="input" name="phone" type="tel" value="${escapeHtml(st.phone)}" autocomplete="off"></label>
    <label class="field"><span>地址</span><input class="input" name="address" value="${escapeHtml(st.address)}" autocomplete="off"></label>
    <div class="row">
      <label class="field"><span>費用</span><input class="input" name="fee" type="number" inputmode="numeric" min="0" value="${st.fee ?? ''}"></label>
      <label class="field"><span>計費方式</span><select class="input" name="feeUnit">
        <option value="hour" ${st.feeUnit !== 'lesson' ? 'selected' : ''}>每小時</option>
        <option value="lesson" ${st.feeUnit === 'lesson' ? 'selected' : ''}>每堂</option>
      </select></label>
    </div>
    <label class="field"><span>備註</span><textarea class="input" name="note" rows="2">${escapeHtml(st.note)}</textarea></label>

    <div class="section-title">每週固定時段</div>
    <div class="slots"></div>
    <button type="button" class="btn block" data-act="add-slot">＋ 新增時段</button>
    ${hiddenCount ? `<p class="hint">另有 ${hiddenCount} 個已結束的時段（保留做為歷史紀錄）。</p>` : ''}

    <div class="btn-row sticky-actions">
      <button type="submit" class="btn primary">儲存</button>
    </div>
    ${existing ? '<button type="button" class="btn danger block" data-act="delete">刪除學生</button>' : ''}
  </form>`);

  const slotsEl = form.querySelector('.slots');

  function drawSlots() {
    slotsEl.innerHTML = '';
    if (!editable.length) slotsEl.appendChild(el('<p class="hint">還沒有固定時段。</p>'));
    editable.forEach((slot, i) => {
      const custom = !DURATIONS.includes(slot.duration);
      const free = slot.subjects.filter((s) => !COMMON_SUBJECTS.includes(s)).join('＋');
      const card = el(`<div class="slot-card card">
        <div class="slot-head"><b>時段 ${i + 1}</b><button type="button" class="btn ghost small danger-text" data-act="remove">刪除</button></div>
        <div class="chips wd-chips">${WD_NAMES.map((n, wd) => `<button type="button" class="chip ${slot.wd === wd ? 'on' : ''}" data-wd="${wd}">${n}</button>`).join('')}</div>
        <div class="row" style="margin-top:8px">
          <label class="field"><span>開始時間</span><select class="input" data-f="start">${timeOptions(slot.start)}</select></label>
          <label class="field"><span>時長</span><select class="input" data-f="durSel">
            ${DURATIONS.map((d) => `<option value="${d}" ${slot.duration === d ? 'selected' : ''}>${d} 分鐘</option>`).join('')}
            <option value="custom" ${custom ? 'selected' : ''}>自訂</option>
          </select></label>
        </div>
        <label class="field" ${custom ? '' : 'hidden'} data-custom><span>自訂時長（分鐘）</span>
          <input class="input" type="number" inputmode="numeric" min="10" step="5" data-f="durCustom" value="${slot.duration}"></label>
        <div class="field"><span>科目（可多選）</span>
          <div class="chips">${COMMON_SUBJECTS.map((s) => `<button type="button" class="chip ${slot.subjects.includes(s) ? 'on' : ''}" data-sub="${s}">${s}</button>`).join('')}</div>
          <input class="input" data-f="free" placeholder="其他科目，例如 數學＋英文" value="${escapeHtml(free)}" style="margin-top:6px">
        </div>
        <small class="field-error" data-err="slot"></small>
      </div>`);

      card.querySelector('[data-act=remove]').onclick = () => {
        if (slot.id && existing && existing.slots.some((s) => s.id === slot.id)
          && !confirm('刪除這個時段，會一併刪除這個時段所有的請假、改課等異動。確定嗎？')) return;
        editable.splice(i, 1);
        drawSlots();
      };
      card.querySelectorAll('[data-wd]').forEach((b) => {
        b.onclick = () => {
          slot.wd = Number(b.dataset.wd);
          card.querySelectorAll('[data-wd]').forEach((x) => x.classList.toggle('on', x === b));
        };
      });
      card.querySelector('[data-f=start]').onchange = (e) => { slot.start = e.target.value; };
      const durSel = card.querySelector('[data-f=durSel]');
      const customWrap = card.querySelector('[data-custom]');
      const customInput = card.querySelector('[data-f=durCustom]');
      durSel.onchange = () => {
        if (durSel.value === 'custom') {
          customWrap.hidden = false;
          customInput.focus();
        } else {
          customWrap.hidden = true;
          slot.duration = Number(durSel.value);
          customInput.value = slot.duration;
        }
      };
      customInput.oninput = () => { slot.duration = Number(customInput.value) || 0; };
      const syncSubjects = () => {
        const chips = [...card.querySelectorAll('[data-sub].on')].map((b) => b.dataset.sub);
        const extra = splitSubjects(card.querySelector('[data-f=free]').value);
        slot.subjects = [...new Set([...chips, ...extra])];
      };
      card.querySelectorAll('[data-sub]').forEach((b) => {
        b.onclick = () => { b.classList.toggle('on'); syncSubjects(); };
      });
      card.querySelector('[data-f=free]').oninput = syncSubjects;
      slotsEl.appendChild(card);
    });
  }
  drawSlots();

  form.querySelector('[data-act=add-slot]').onclick = () => {
    const last = editable[editable.length - 1];
    editable.push({
      id: uid('t'), wd: last ? (last.wd + 1) % 7 : 0, start: last ? last.start : '18:00',
      duration: last ? last.duration : 90, subjects: last ? [...last.subjects] : [],
      validFrom: null, validTo: null,
    });
    drawSlots();
    slotsEl.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const codeInput = form.querySelector('[name=code]');
  codeInput.addEventListener('blur', () => { codeInput.value = normalizeCode(codeInput.value); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const code = normalizeCode(f.get('code'));
    const name = String(f.get('name') || '').trim();
    const errs = {};
    if (!code) errs.code = '請輸入代號';
    else if (data.students.some((s) => s.code === code && s.id !== st.id)) errs.code = `代號 ${code} 已經有人使用`;
    if (!name) errs.name = '請輸入學生姓名';
    form.querySelectorAll('[data-err]').forEach((x) => { x.textContent = ''; });
    form.querySelectorAll('.input.invalid').forEach((x) => x.classList.remove('invalid'));
    for (const [k, msg] of Object.entries(errs)) {
      form.querySelector(`[data-err=${k}]`).textContent = msg;
      form.querySelector(`[name=${k}]`).classList.add('invalid');
    }
    let slotErr = false;
    form.querySelectorAll('.slot-card').forEach((card, i) => {
      const s = editable[i];
      const msg = !(s.duration >= 10 && s.duration <= 600) ? '時長要在 10～600 分鐘之間' : '';
      card.querySelector('[data-err=slot]').textContent = msg;
      if (msg) slotErr = true;
    });
    if (Object.keys(errs).length || slotErr) {
      const first = form.querySelector('.invalid, .field-error:not(:empty)');
      first && first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const feeRaw = String(f.get('fee') || '').trim();
    const next = {
      ...st,
      code, name,
      parentName: String(f.get('parentName') || '').trim(),
      phone: String(f.get('phone') || '').trim(),
      grade: String(f.get('grade') || '').trim(),
      address: String(f.get('address') || '').trim(),
      fee: feeRaw === '' ? null : Number(feeRaw),
      feeUnit: f.get('feeUnit') === 'lesson' ? 'lesson' : 'hour',
      note: String(f.get('note') || '').trim(),
    };
    const kept = st.slots.filter((s) => !currentSlots(st, today).includes(s));
    next.slots = [...kept, ...editable];

    store.update((d) => {
      const keepIds = new Set(next.slots.map((s) => s.id));
      if (existing) {
        // 被刪掉的時段，連同它的異動一起刪除
        for (const s of existing.slots) {
          if (keepIds.has(s.id)) continue;
          for (const key of Object.keys(d.overrides)) if (key.startsWith(`${s.id}@`)) delete d.overrides[key];
        }
        d.students = d.students.map((x) => (x.id === st.id ? next : x));
      } else {
        d.students.push(next);
      }
    });
    sheet.close();
    toast(existing ? '已儲存' : `已新增 ${code} ${name}`);
    onSaved && onSaved(next);
  });

  const delBtn = form.querySelector('[data-act=delete]');
  if (delBtn) {
    delBtn.onclick = () => {
      if (!confirm(`確定要刪除「${st.code} ${st.name}」嗎？\n會一併刪除這位學生的所有課程異動。`)) return;
      store.update((d) => {
        const slotIds = new Set(existing.slots.map((s) => s.id));
        for (const key of Object.keys(d.overrides)) if (slotIds.has(key.split('@')[0])) delete d.overrides[key];
        d.extras = d.extras.filter((x) => x.studentId !== st.id);
        d.stops = d.stops.filter((x) => x.studentId !== st.id);
        d.students = d.students.filter((x) => x.id !== st.id);
      });
      sheet.close();
      toast('已刪除');
    };
  }

  const sheet = openSheet({ title: existing ? `編輯 ${st.code} ${st.name}` : '新增學生', body: form });
  if (!existing) setTimeout(() => codeInput.focus(), 250);
  return sheet;
}
