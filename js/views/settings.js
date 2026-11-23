// 設定：顯示的星期、時間範圍、備份與還原
import * as store from '../store.js';
import { el, toast, escapeHtml, timeOptions, shareOrDownload } from '../ui.js';
import { nowTaipei, compactDate, diffDays, WD_NAMES, timeToMin } from '../dates.js';
import { APP_VERSION } from '../version.js';

export function render(root) {
  const draw = () => {
    const d = store.getData();
    const s = d.settings;
    const today = nowTaipei().date;
    const last = s.lastBackupAt;
    const days = last ? diffDays(today, nowTaipei(new Date(last)).date) : null;
    const backupText = last === null ? '還沒有備份過' : days === 0 ? '今天備份過' : `距離上次備份 ${days} 天`;

    root.innerHTML = '';
    root.appendChild(el(`<div class="settings">
      <div class="section-title">課表要顯示的星期</div>
      <div class="card"><div class="chips wd-chips">
        ${WD_NAMES.map((n, i) => `<button class="chip ${s.visibleDays.includes(i) ? 'on' : ''}" data-wd="${i}" aria-pressed="${s.visibleDays.includes(i)}">${n}</button>`).join('')}
      </div></div>

      <div class="section-title">課表時間範圍</div>
      <div class="card row">
        <label class="field"><span>開始</span><select class="input" data-f="dayStart">${timeOptions(s.dayStart, { from: 0, to: 23 * 60 })}</select></label>
        <label class="field"><span>結束</span><select class="input" data-f="dayEnd">${timeOptions(s.dayEnd, { from: 60, to: 23 * 60 + 30 })}</select></label>
      </div>

      <div class="section-title">備份與還原</div>
      <div class="card">
        <p class="notice">資料只存在這支手機。刪除主畫面的 app 圖示或清除 Safari 資料，資料就會消失，請定期備份。</p>
        <p class="backup-age ${last === null || days > 14 ? 'warn-text' : ''}">${backupText}</p>
        <div class="btn-row">
          <button class="btn primary" data-a="backup">備份</button>
          <label class="btn file-btn">還原<input type="file" accept="application/json,.json" hidden data-a="restore"></label>
        </div>
        <p class="hint">備份檔名：家教備份_${compactDate(today)}.json。iPhone 會出現分享選單，可以「儲存到檔案」或傳到 LINE。</p>
      </div>

      <div class="section-title">資料</div>
      <div class="card">
        <p class="hint" style="margin-top:0">學生 ${d.students.length} 位、異動 ${Object.keys(d.overrides).length} 筆、額外課程 ${d.extras.length} 堂、停課區間 ${d.stops.length} 段、紀錄 ${d.log.length} 筆</p>
        <button class="btn danger block" data-a="clear">清除所有資料</button>
      </div>

      <p class="version">家教排課 v${escapeHtml(APP_VERSION)}</p>
    </div>`));

    root.querySelectorAll('[data-wd]').forEach((b) => {
      b.onclick = () => {
        const wd = Number(b.dataset.wd);
        const cur = store.getData().settings.visibleDays;
        if (cur.includes(wd) && cur.length === 1) return toast('至少要顯示一天');
        store.update((x) => {
          const set = new Set(x.settings.visibleDays);
          if (set.has(wd)) set.delete(wd); else set.add(wd);
          x.settings.visibleDays = [...set].sort((a, c) => a - c);
        });
      };
    });

    const startSel = root.querySelector('[data-f=dayStart]');
    const endSel = root.querySelector('[data-f=dayEnd]');
    const onRange = () => {
      if (timeToMin(startSel.value) >= timeToMin(endSel.value)) {
        toast('開始時間要早於結束時間');
        startSel.value = store.getData().settings.dayStart;
        endSel.value = store.getData().settings.dayEnd;
        return;
      }
      store.update((x) => { x.settings.dayStart = startSel.value; x.settings.dayEnd = endSel.value; });
      toast('已更新課表時間範圍');
    };
    startSel.onchange = onRange;
    endSel.onchange = onRange;

    root.querySelector('[data-a=backup]').onclick = backup;
    root.querySelector('[data-a=restore]').onchange = (e) => restore(e.target);
    root.querySelector('[data-a=clear]').onclick = clearAll;
  };

  draw();
  const unsub = store.subscribe(draw);
  return () => unsub();
}

async function backup() {
  const today = nowTaipei().date;
  // 先記下備份時間再匯出，這樣還原後的資料和備份檔完全一樣
  const prev = store.getData().settings.lastBackupAt;
  store.update((d) => { d.settings.lastBackupAt = new Date().toISOString(); });
  const json = store.exportJSON();
  const res = await shareOrDownload(`家教備份_${compactDate(today)}.json`, json, 'application/json');
  if (res === 'cancelled') {
    store.update((d) => { d.settings.lastBackupAt = prev; });
    return;
  }
  toast(res === 'downloaded' ? '已下載備份檔' : '已備份');
}

async function restore(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    return alert('無法讀取檔案。');
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return alert('還原失敗：這不是有效的備份檔（JSON 格式錯誤）。');
  }
  const err = store.validate(obj);
  if (err) return alert(`還原失敗：${err}`);
  const n = (obj.students || []).length;
  if (!confirm(`備份檔裡有 ${n} 位學生。\n還原會覆蓋目前所有資料，確定嗎？`)) return;
  const e2 = store.importJSON(text);
  if (e2) return alert(`還原失敗：${e2}`);
  toast('已還原資料');
}

function clearAll() {
  if (!confirm('確定要清除所有資料嗎？學生、課表異動、紀錄都會刪除。')) return;
  if (!confirm('再確認一次：清除後無法復原。建議先備份。真的要清除嗎？')) return;
  store.clearAll();
  toast('已清除所有資料');
}
