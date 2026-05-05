// dashboard-previews.js — small live previews on the dashboard that
// surface the latest class community message and the latest friend DM.
// Both subscribe to Firestore in real-time and unsub on logout.
import {
  db, collection, query, orderBy, limit, where, onSnapshot
} from './firebase-init.js';
import { state, esc, on } from './store.js';
import { classKey } from './class-community.js';
import { friendshipId, getFriends } from './friends.js';

let unsubCommunity = null;
let unsubDM = null;

export function initDashboardPreviews(){
  // Re-subscribe whenever the active user changes.
  on('user', () => { stop(); start(); });
  on('section', sec => { if(sec === 'dashboard') start(); });
  // First boot may already have a logged-in user.
  if(state.user) start();
}

function start(){
  if(!state.user) return;
  startCommunity();
  startDM();
}

function stop(){
  unsubCommunity?.(); unsubCommunity = null;
  unsubDM?.(); unsubDM = null;
}

// === Community preview ============================================
function startCommunity(){
  unsubCommunity?.();
  const key = classKey();
  if(!key){ paintCommunityEmpty(); return; }
  try {
    const q = query(
      collection(db, 'class_communities', key, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(5),
    );
    unsubCommunity = onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
      paintCommunity(msgs);
    }, () => paintCommunityEmpty());
  } catch(e){ paintCommunityEmpty(); }
}

function paintCommunity(msgs){
  const root = document.getElementById('preview-community-list');
  if(!root) return;
  if(!msgs.length){ paintCommunityEmpty(); return; }
  root.innerHTML = msgs.slice(-3).reverse().map(m => `
    <div class="preview-row" data-section="class-chat">
      <div class="preview-avatar">${initials(m.name || 'U')}</div>
      <div class="preview-row-body">
        <div class="preview-row-name"><span>${esc(m.name || 'Student')}</span><span class="preview-row-time">${ago(m.createdAt)}</span></div>
        <div class="preview-row-msg">${esc((m.text || '').slice(0, 80))}</div>
      </div>
    </div>
  `).join('');
}

function paintCommunityEmpty(){
  const root = document.getElementById('preview-community-list');
  if(root) root.innerHTML = '<div class="preview-empty">এখনো কোনো community message নেই</div>';
}

// === Friend DM preview ============================================
function startDM(){
  unsubDM?.();
  if(!state.user) return;
  // Subscribe to messages where I'm the recipient (last 5).
  try {
    const q = query(
      collection(db, 'direct_messages'),
      where('toUid', '==', state.user.uid),
      orderBy('createdAt', 'desc'),
      limit(5),
    );
    unsubDM = onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      paintDM(msgs);
    }, () => paintDMEmpty());
  } catch(e){ paintDMEmpty(); }
}

function paintDM(msgs){
  const root = document.getElementById('preview-dm-list');
  if(!root) return;
  if(!msgs.length){ paintDMEmpty(); return; }
  // Group by fromUid so we show 1 row per conversation.
  const seen = new Set();
  const rows = [];
  for(const m of msgs){
    if(seen.has(m.fromUid)) continue;
    seen.add(m.fromUid);
    rows.push(m);
    if(rows.length >= 3) break;
  }
  const friends = getFriends();
  root.innerHTML = rows.map(m => {
    const f = friends.find(fr => fr.uids?.includes(m.fromUid));
    const name = f?.profiles?.[m.fromUid]?.name || m.fromName || 'Friend';
    return `
      <div class="preview-row" data-section="dm" data-peer="${esc(m.fromUid)}">
        <div class="preview-avatar">${initials(name)}</div>
        <div class="preview-row-body">
          <div class="preview-row-name"><span>${esc(name)}</span><span class="preview-row-time">${ago(m.createdAt)}</span></div>
          <div class="preview-row-msg">${esc((m.text || '').slice(0, 80))}</div>
        </div>
      </div>
    `;
  }).join('');
  // Wire taps to open the DM with that peer.
  root.querySelectorAll('[data-peer]').forEach(el => {
    el.addEventListener('click', async () => {
      const { showSection } = await import('./ui.js');
      const { openDM } = await import('./dm.js');
      showSection('dm');
      openDM(el.dataset.peer);
    });
  });
}

function paintDMEmpty(){
  const root = document.getElementById('preview-dm-list');
  if(root) root.innerHTML = '<div class="preview-empty">কোনো friend DM নেই</div>';
}

// === helpers ======================================================
function initials(name){
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() || '?';
}
function ago(ts){
  if(!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if(diff < 60) return 'এখন';
  if(diff < 3600) return Math.floor(diff/60) + 'মিনিট';
  if(diff < 86400) return Math.floor(diff/3600) + 'ঘন্টা';
  return Math.floor(diff/86400) + 'দিন';
}
