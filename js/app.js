// 畫面、路由、事件
import * as store from './store.js';
import { diffDays, nowTaipei } from './dates.js';
import { escapeHtml } from './util.js';

const VIEWS = {
  messages: { title: '訊息', load: () => import('./views/messages.js') },
  schedule: { title: '課表', load: () => import('./views/schedule-view.js') },
  students: { title: '學生', load: () => import('./views/students.js') },
  settings: { title: '設定', load: () => import('./views/settings.js') },
};

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('page-title');
const actionsEl = document.getElementById('topbar-actions');

let current = null; // { name, mod, cleanup }

function routeName() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return VIEWS[name] ? name : 'messages';
}

async function render() {
  const name = routeName();
  const def = VIEWS[name];
  if (current && current.cleanup) current.cleanup();
  const mod = await def.load();
  titleEl.textContent = def.title;
  document.title = `${def.title}｜家教排課`;
  actionsEl.innerHTML = '';
  viewEl.innerHTML = '';
  viewEl.className = `view view-${name}`;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === name);
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.getElementById('btn-settings').classList.toggle('active', name === 'settings');
  const cleanup = mod.render(viewEl, { actionsEl, navigate });
  current = { name, mod, cleanup };
  updateBanner();
}

export function navigate(name) {
  if (location.hash === `#${name}`) render();
  else location.hash = name;
}

/** 超過 14 天沒備份時，在訊息頁上方提醒 */
function updateBanner() {
  const banner = document.getElementById('banner');
  const d = store.getData();
  const last = d.settings.lastBackupAt;
  const hasData = d.students.length > 0;
  let days = null;
  if (last) days = diffDays(nowTaipei().date, nowTaipei(new Date(last)).date);
  const show = routeName() === 'messages' && hasData && (last === null || days > 14);
  banner.hidden = !show;
  if (show) {
    banner.innerHTML = `<span>${last === null ? '還沒有備份過資料' : `已經 ${escapeHtml(days)} 天沒有備份`}，資料只存在這支手機，請記得備份。</span>
      <button class="btn small" data-go="settings">去備份</button>`;
    banner.querySelector('button').onclick = () => navigate('settings');
  }
}

document.getElementById('btn-settings').addEventListener('click', () => navigate('settings'));
window.addEventListener('hashchange', render);
store.subscribe(() => updateBanner());

store.load();
store.requestPersist();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
  });
}
