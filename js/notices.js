// notices.js — admin-broadcast notice/announcement banner.
//
// Reads /system/notices (single doc with `items: [{id,title,body,link,linkLabel,
// type:'banner'|'popup', active}]`). Each user dismisses items per-id; the
// dismiss state lives in localStorage so it survives reloads but doesn't
// require a Firestore write per dismissal.
import { db, doc, onSnapshot } from './firebase-init.js';
import { state, esc, icon, emit } from './store.js';

const STORE_KEY = 'sb-dismissed-notices';

function dismissed(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
  catch(e){ return []; }
}
function dismiss(id){
  const d = dismissed();
  if(!d.includes(id)){ d.push(id); localStorage.setItem(STORE_KEY, JSON.stringify(d)); }
}

export function watchNotices(){
  return onSnapshot(doc(db, 'system', 'notices'), snap => {
    const items = snap.exists() ? (snap.data().items || []) : [];
    state.notices = items;
    paintNotices();
    emit('notices', items);
  }, err => console.warn('notices watch failed', err));
}

export function paintNotices(){
  const root = document.getElementById('notice-stack');
  if(!root) return;
  const seen = dismissed();
  const visible = (state.notices || []).filter(n => n.active !== false && !seen.includes(n.id));
  if(!visible.length){ root.innerHTML = ''; return; }
  root.innerHTML = visible.map(n => renderNotice(n)).join('');
  root.querySelectorAll('[data-dismiss-notice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dismissNotice;
      dismiss(id);
      paintNotices();
    });
  });
}

function renderNotice(n){
  const tone = n.tone || 'info';   // info | success | warn | promo
  const isPopup = n.type === 'popup';
  return `
    <div class="notice notice-${esc(tone)} ${isPopup?'notice-popup':''}" data-notice-id="${esc(n.id)}">
      <div class="notice-icon">${icon(noticeIcon(tone))}</div>
      <div class="notice-body">
        ${n.title ? `<div class="notice-title">${esc(n.title)}</div>` : ''}
        ${n.body  ? `<div class="notice-text">${esc(n.body)}</div>`   : ''}
        ${n.link  ? `<a class="notice-link" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.linkLabel || 'Read more')} →</a>` : ''}
      </div>
      <button class="notice-close" data-dismiss-notice="${esc(n.id)}" title="Dismiss">${icon('x')}</button>
    </div>`;
}

function noticeIcon(tone){
  switch(tone){
    case 'success': return 'check';
    case 'warn':    return 'warning';
    case 'promo':   return 'gift';
    default:        return 'megaphone';
  }
}
