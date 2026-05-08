// notices.js — admin-broadcast notice/announcement banner with scheduling.
//
// Reads /system/notices (single doc with `items: [{
//   id, title, body, link, linkLabel,
//   type: 'banner' | 'popup',
//   tone: 'info' | 'success' | 'warn' | 'promo',
//   active: boolean,
//   // Scheduling fields (Section 3 — production hardening):
//   startAt: ISO string | null,        // notification only fires after this time
//   endAt: ISO string | null,          // notification stops firing after this time
//   dailyStartHour: 0-23 | null,       // only push between these hours each day
//   dailyEndHour: 0-23 | null,
//   repeatLimit: number,               // how many times to push to a single device (default 1)
//   intervalMinutes: number,           // minutes between repeated pushes on same device
//   autoDeleteAt: ISO string | null,   // when set, the user-side auto-removes the notice locally after this time
// }]`).
//
// Each user dismisses items per-id; the dismiss state lives in localStorage so
// it survives reloads but doesn't require a Firestore write per dismissal.
import { db, doc, onSnapshot } from './firebase-init.js';
import { state, esc, icon, emit } from './store.js';
import { notify, isPushReady } from './push-notifications.js';

const STORE_KEY    = 'sb-dismissed-notices';
const NOTIFIED_KEY = 'sb-pushed-notices';      // legacy: list of seen ids
const NOTIFIED_MAP = 'sb-pushed-notices-map';  // { [id]: { count, lastAt } }

function dismissed(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
  catch(e){ return []; }
}
function dismiss(id){
  const d = dismissed();
  if(!d.includes(id)){ d.push(id); localStorage.setItem(STORE_KEY, JSON.stringify(d)); }
}

function readNotifiedMap(){
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFIED_MAP) || '{}');
    if(raw && typeof raw === 'object') return raw;
  } catch(e){}
  return {};
}
function writeNotifiedMap(m){
  // Clamp size — only keep last 200 ids ordered by lastAt.
  const entries = Object.entries(m);
  if(entries.length > 200){
    entries.sort((a, b) => (b[1]?.lastAt || 0) - (a[1]?.lastAt || 0));
    m = Object.fromEntries(entries.slice(0, 200));
  }
  localStorage.setItem(NOTIFIED_MAP, JSON.stringify(m));
}

export function watchNotices(){
  return onSnapshot(doc(db, 'system', 'notices'), snap => {
    const items = snap.exists() ? (snap.data().items || []) : [];
    state.notices = items;
    paintNotices();
    maybePushNotify(items);
    emit('notices', items);
  }, err => console.warn('notices watch failed', err));
}

// True if `now` falls inside the notice's scheduled window.
function isWithinSchedule(n, now){
  if(n.active === false) return false;
  const t = now.getTime();
  if(n.startAt && t < new Date(n.startAt).getTime()) return false;
  if(n.endAt   && t > new Date(n.endAt).getTime())   return false;
  if(n.autoDeleteAt && t > new Date(n.autoDeleteAt).getTime()) return false;
  // Daily window — inclusive start, exclusive end. Wraps midnight if needed.
  const sh = Number.isFinite(n.dailyStartHour) ? n.dailyStartHour : null;
  const eh = Number.isFinite(n.dailyEndHour)   ? n.dailyEndHour   : null;
  if(sh !== null && eh !== null){
    const h = now.getHours();
    if(sh <= eh) { if(h < sh || h >= eh) return false; }
    else         { if(h < sh && h >= eh) return false; } // wraps midnight
  }
  return true;
}

// Section 3 — surface admin announcements as OS-level push notifications.
// Now respects: start/end window, daily hour window, repeat limit, repeat interval.
let pushTimer = null;
function maybePushNotify(items){
  clearTimeout(pushTimer);
  if(!isPushReady()) { migrateLegacy(items); return; }
  migrateLegacy(items);
  const now = new Date();
  const map = readNotifiedMap();
  for(const n of items || []){
    if(!isWithinSchedule(n, now)) continue;
    const limit = Math.max(1, n.repeatLimit || 1);
    // intervalMinutes = 0 means "no enforced delay" (immediate re-push up to
    // repeatLimit). Anything > 0 still gets clamped to a 60s minimum so we
    // don't spam users every snapshot tick.
    const intervalMs = (n.intervalMinutes || 0) > 0
      ? Math.max(60_000, n.intervalMinutes * 60_000)
      : 0;
    const seen = map[n.id] || { count: 0, lastAt: 0 };
    if(seen.count >= limit) continue;
    if(seen.count > 0 && intervalMs && now.getTime() - seen.lastAt < intervalMs) continue;
    notify(n.title || 'Announcement', {
      body: n.body || '',
      tag: 'notice-' + n.id + '-' + (seen.count + 1),
      data:{ path: '/' },
      requireInteraction: !!n.requireInteraction,
    });
    map[n.id] = { count: seen.count + 1, lastAt: now.getTime() };
  }
  writeNotifiedMap(map);
  // Re-check soon so daily-window notices push as soon as the window opens.
  const nextCheck = nextScheduleEdge(items, now);
  if(nextCheck) pushTimer = setTimeout(() => maybePushNotify(items), Math.max(30_000, nextCheck - now.getTime()));
}

// Returns the timestamp (ms) of the next scheduling boundary across all
// items so we can wake up exactly when something becomes active or expires.
function nextScheduleEdge(items, now){
  const t = now.getTime();
  const candidates = [];
  const map = readNotifiedMap();
  for(const n of items || []){
    if(n.startAt){ const v = new Date(n.startAt).getTime(); if(v > t) candidates.push(v); }
    if(n.endAt)  { const v = new Date(n.endAt).getTime();   if(v > t) candidates.push(v); }
    if(n.autoDeleteAt){ const v = new Date(n.autoDeleteAt).getTime(); if(v > t) candidates.push(v); }
    if(Number.isFinite(n.dailyStartHour)){
      const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(n.dailyStartHour);
      if(d.getTime() <= t) d.setDate(d.getDate() + 1);
      candidates.push(d.getTime());
    }
    if(Number.isFinite(n.dailyEndHour)){
      const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(n.dailyEndHour);
      if(d.getTime() <= t) d.setDate(d.getDate() + 1);
      candidates.push(d.getTime());
    }
    // Repeat-interval edge — schedule the next push for any notice that's
    // already fired at least once but still has remaining repeats. Without
    // this, a notice with only repeatLimit + intervalMinutes (and no other
    // schedule fields) would never re-fire after the first push.
    const seen = map[n.id];
    if(seen && seen.count){
      const limit = Math.max(1, n.repeatLimit || 1);
      if(seen.count < limit && (n.intervalMinutes || 0) > 0){
        const intervalMs = Math.max(60_000, n.intervalMinutes * 60_000);
        const nextPush = (seen.lastAt || 0) + intervalMs;
        if(nextPush > t) candidates.push(nextPush);
      }
    }
  }
  if(!candidates.length) return null;
  return Math.min(...candidates);
}

function migrateLegacy(items){
  // One-time: convert the old "seen array" into the new map so users who
  // already saw a notice don't get re-notified.
  const map = readNotifiedMap();
  if(Object.keys(map).length) return;
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'); }
  catch(e){ legacy = []; }
  if(!Array.isArray(legacy) || !legacy.length) return;
  legacy.forEach(id => { map[id] = { count: 1, lastAt: Date.now() }; });
  writeNotifiedMap(map);
}

export function paintNotices(){
  const root = document.getElementById('notice-stack');
  if(!root) return;
  const seen = dismissed();
  const now = new Date();
  const visible = (state.notices || []).filter(n =>
    n.active !== false && !seen.includes(n.id) && !isExpired(n, now));
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

function isExpired(n, now){
  const t = now.getTime();
  if(n.endAt && t > new Date(n.endAt).getTime()) return true;
  if(n.autoDeleteAt && t > new Date(n.autoDeleteAt).getTime()) return true;
  return false;
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
