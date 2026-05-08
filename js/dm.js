// dm.js — 1-on-1 direct messages between same-class friends, with
// per-package daily/monthly send limits configured by the admin.
//
// Data model:
//   /direct_messages/{id} = { pairId, fromUid, toUid, text, createdAt, day, month }
//   pairId = sorted "uidA_uidB" so we can query both sides cheaply.
//
// Admin sees everything by listing `/direct_messages` (security rules
// allow admins, deny everyone else from snooping on others).
import {
  db, collection, doc, addDoc, query, where, orderBy, limit, onSnapshot,
  getDocs, serverTimestamp
} from './firebase-init.js';
import { state, esc, icon, fmtTime } from './store.js';
import { toast } from './toast.js';
import { effectivePlan } from './quota.js';
import { friendshipId, getFriends } from './friends.js';

let unsubMsgs = null;
let activePeer = null;

export function initDM(){
  document.getElementById('dm-send-btn')?.addEventListener('click', send);
  document.getElementById('dm-input')?.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
  });
  // Fix: also handle Ctrl+Enter
  document.getElementById('dm-input')?.addEventListener('keydown', e => {
    if(e.ctrlKey && e.key === 'Enter'){ e.preventDefault(); send(); }
  });
}

export function openDM(peerUid){
  activePeer = peerUid;
  paintHeader();
  startStream();
}

export function startDM(){
  paintFriendList();
  if(!activePeer && getFriends().length){
    const f = getFriends()[0];
    const idx = f.uids.indexOf(state.user.uid);
    activePeer = f.uids[1 - idx];
    paintHeader();
    startStream();
  } else if(activePeer){
    paintHeader();
    startStream();
  }
}

export function stopDM(){
  if(unsubMsgs){ unsubMsgs(); unsubMsgs = null; }
}

function paintFriendList(){
  const root = document.getElementById('dm-friend-list');
  if(!root) return;
  const friends = getFriends();
  if(!friends.length){
    root.innerHTML = `<p class="mini-note">No friends yet. Friends tab থেকে add করুন।</p>`;
    return;
  }
  root.innerHTML = friends.map(f => {
    const idx = f.uids.indexOf(state.user.uid);
    const otherUid = f.uids[1 - idx];
    const otherName = f.names ? f.names[1 - idx] : 'Friend';
    return `<button class="dm-friend ${otherUid===activePeer?'active':''}" data-peer="${esc(otherUid)}">
      <div class="fr-avatar fr-avatar-fallback">${esc((otherName||'S').charAt(0).toUpperCase())}</div>
      <span>${esc(otherName)}</span>
    </button>`;
  }).join('');
  root.querySelectorAll('[data-peer]').forEach(b => {
    b.addEventListener('click', () => { activePeer = b.dataset.peer; paintFriendList(); paintHeader(); startStream(); });
  });
}

function paintHeader(){
  const friends = getFriends();
  const f = friends.find(x => x.uids.includes(activePeer));
  const idx = f ? f.uids.indexOf(state.user.uid) : -1;
  const name = idx >= 0 ? (f.names ? f.names[1 - idx] : 'Friend') : 'Pick a friend';
  const h = document.getElementById('dm-header');
  if(h) h.innerHTML = `${icon('chat')} ${esc(name)}`;
}

function startStream(){
  stopDM();
  if(!activePeer){ return; }
  const root = document.getElementById('dm-messages');
  if(!root) return;
  const pairId = friendshipId(state.user.uid, activePeer);
  const q = query(
    collection(db,'direct_messages'),
    where('pairId','==', pairId),
    orderBy('createdAt','asc'),
    limit(500)
  );
  unsubMsgs = onSnapshot(q, snap => {
    if(snap.empty){
      root.innerHTML = `<div class="empty-state">${icon('chat','xl')}<div class="empty-title">No messages yet</div><div class="empty-text">প্রথম message লিখুন</div></div>`;
      return;
    }
    root.innerHTML = snap.docs.map(d => renderMsg(d.data())).join('');
    root.scrollTop = root.scrollHeight;
  }, err => {
    root.innerHTML = `<div class="empty-state">${icon('warning','xl')}<div class="empty-title">Loading failed</div><div class="empty-text">${esc(err.message||'')}</div></div>`;
  });
}

function renderMsg(m){
  const me = m.fromUid === state.user.uid;
  return `
    <div class="dm-msg ${me?'dm-msg-me':''}">
      <div class="dm-bubble">
        <div class="dm-text">${esc(m.text)}</div>
        <div class="dm-time">${fmtTime(m.createdAt)}</div>
      </div>
    </div>`;
}

async function send(){
  const inp = document.getElementById('dm-input');
  const text = (inp?.value || '').trim();
  if(!text) return;
  if(!state.user) return;
  if(!activePeer){ toast('Friend select করুন','warn'); return; }
  if(!state.online){ toast('Internet নেই','warn'); return; }

  // Enforce per-package message limit (daily by default; monthly fallback).
  const limit = currentLimit();
  if(limit != null){
    const today = todayKey();
    try {
      const q = query(
        collection(db,'direct_messages'),
        where('fromUid','==', state.user.uid),
        where('day','==', today)
      );
      const snap = await getDocs(q);
      if(snap.size >= limit){
        toast(`Daily message limit reached (${limit}). Premium package নিন।`, 'warn');
        return;
      }
    } catch(e){ /* offline - allow send */ }
  }

  try {
    await addDoc(collection(db,'direct_messages'), {
      pairId: friendshipId(state.user.uid, activePeer),
      fromUid: state.user.uid,
      toUid: activePeer,
      fromName: state.profile?.name || '',
      classLevel: state.profile?.classLevel || '',
      text,
      day: todayKey(),
      month: monthKey(),
      createdAt: serverTimestamp(),
    });
    inp.value = '';
  } catch(e){ toast('Send failed: ' + e.message, 'error'); }
}

function currentLimit(){
  const eff = effectivePlan();
  const l = eff.pkg?.limits?.dmDaily;
  if(typeof l === 'number') return l;
  return null;
}

function todayKey(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function monthKey(){
  const d = new Date();
  return d.toISOString().slice(0,7);
}
