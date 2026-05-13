// friends.js — same-class only friend request system.
//
// Data model:
//   /friend_requests/{id} = { fromUid, toUid, fromName, toName, classLevel,
//                              status:'pending|accepted|rejected', createdAt }
//   /friendships/{id}     = { uids:[a,b], names:[a,b], classLevel, createdAt }
//                            (id = sorted-uids joined with '_')
//
// We deliberately use a flat /friendships collection (not a subcollection)
// so admin can see ALL friendships easily for moderation, and so the
// `uids array-contains` query works for either side of the relationship.
import {
  db, collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp
} from './firebase-init.js';
import { state, esc, icon } from './store.js';
import { toast } from './toast.js';

let unsubReq = null;
let unsubFriends = null;
let classmatesCache = [];
let pendingCache = [];
let friendsCache = [];

export function initFriends(){
  document.getElementById('friends-search-input')?.addEventListener('input', paintClassmates);
}

export function startFriends(){
  stopFriends();
  if(!state.user || !state.profile?.classLevel){
    document.getElementById('friends-classmates-list').innerHTML =
      `<div class="empty-state">${icon('users','xl')}<div class="empty-title">Class set করুন</div><div class="empty-text">Settings → Class / Level আপডেট করলে classmates দেখাবে</div></div>`;
    return;
  }
  // Subscribe to incoming/outgoing requests.
  unsubReq = onSnapshot(
    query(collection(db,'friend_requests'), where('status','==','pending')),
    snap => {
      pendingCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(r => r.toUid === state.user.uid || r.fromUid === state.user.uid);
      paintRequests();
    },
    err => console.warn('friend req watch failed', err)
  );
  // Subscribe to my friendships.
  unsubFriends = onSnapshot(
    query(collection(db,'friendships'), where('uids','array-contains', state.user.uid)),
    snap => {
      friendsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      paintFriends();
      // also re-paint classmates to update their button state
      paintClassmates();
    },
    err => console.warn('friendships watch failed', err)
  );
  loadClassmates();
}

export function stopFriends(){
  if(unsubReq){ unsubReq(); unsubReq = null; }
  if(unsubFriends){ unsubFriends(); unsubFriends = null; }
  if(unsubClassmates){ unsubClassmates(); unsubClassmates = null; }
}

let unsubClassmates = null;
async function loadClassmates(){
  if(unsubClassmates){ unsubClassmates(); unsubClassmates = null; }
  try {
    const q = query(collection(db,'public_profiles'), where('classLevel','==', state.profile.classLevel));
    // Real-time: updates whenever a new student registers in the same class
    unsubClassmates = onSnapshot(q, snap => {
      classmatesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.id !== state.user.uid);
      paintClassmates();
    }, err => {
      console.warn('classmates watch failed', err);
      document.getElementById('friends-classmates-list').innerHTML =
        `<div class="empty-state">${icon('warning','xl')}<div class="empty-title">Could not load</div><div class="empty-text">${esc(err.message||'')}</div></div>`;
    });
  } catch(e){
    console.warn('classmates load failed', e);
  }
}

function paintClassmates(){
  const root = document.getElementById('friends-classmates-list');
  if(!root) return;
  const search = (document.getElementById('friends-search-input')?.value || '').toLowerCase();
  const list = classmatesCache.filter(u =>
    !search || (u.name || '').toLowerCase().includes(search)
  );
  if(!list.length){
    root.innerHTML = `<div class="empty-state">${icon('users','xl')}<div class="empty-title">No classmates yet</div><div class="empty-text">এই class এ এখনো অন্য কেউ register হয়নি</div></div>`;
    return;
  }
  root.innerHTML = list.map(u => userCard(u)).join('');
  root.querySelectorAll('[data-fr-send]').forEach(b => {
    b.addEventListener('click', () => sendRequest(b.dataset.frSend));
  });
}

function userCard(u){
  const friend = friendsCache.find(f => f.uids.includes(u.id));
  const pending = pendingCache.find(r =>
    (r.fromUid === state.user.uid && r.toUid === u.id) ||
    (r.toUid === state.user.uid && r.fromUid === u.id)
  );
  const avatar = u.photoUrl
    ? `<img src="${esc(u.photoUrl)}" class="fr-avatar"/>`
    : `<div class="fr-avatar fr-avatar-fallback">${esc((u.name||'S').charAt(0).toUpperCase())}</div>`;
  let action;
  if(friend){
    action = `<button class="btn btn-sm btn-secondary" data-section="dm" data-dm-uid="${esc(u.id)}">${icon('chat','sm')} Chat</button>`;
  } else if(pending && pending.fromUid === state.user.uid){
    action = `<span class="badge">${icon('clock','sm')} Pending</span>`;
  } else if(pending){
    action = `<button class="btn btn-sm btn-success" data-fr-accept="${esc(pending.id)}">Accept</button>`;
  } else {
    action = `<button class="btn btn-sm btn-primary" data-fr-send="${esc(u.id)}">${icon('add','sm')} Add Friend</button>`;
  }
  return `<div class="fr-card">
    ${avatar}
    <div class="fr-info">
      <div class="fr-name">${esc(u.name || 'Student')}</div>
      <div class="fr-meta">${esc(u.institution || '')}</div>
    </div>
    ${action}
  </div>`;
}

function paintRequests(){
  const root = document.getElementById('friends-requests-list');
  if(!root) return;
  const incoming = pendingCache.filter(r => r.toUid === state.user.uid);
  if(!incoming.length){ root.innerHTML = `<p class="mini-note">No pending requests</p>`; return; }
  root.innerHTML = incoming.map(r => `
    <div class="fr-card">
      <div class="fr-avatar fr-avatar-fallback">${esc((r.fromName||'S').charAt(0).toUpperCase())}</div>
      <div class="fr-info">
        <div class="fr-name">${esc(r.fromName || 'Student')}</div>
        <div class="fr-meta">wants to be friends</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-success" data-fr-accept="${esc(r.id)}">Accept</button>
        <button class="btn btn-sm btn-danger" data-fr-reject="${esc(r.id)}">Reject</button>
      </div>
    </div>
  `).join('');
  root.querySelectorAll('[data-fr-accept]').forEach(b => b.addEventListener('click', () => acceptRequest(b.dataset.frAccept)));
  root.querySelectorAll('[data-fr-reject]').forEach(b => b.addEventListener('click', () => rejectRequest(b.dataset.frReject)));
}

function paintFriends(){
  const root = document.getElementById('friends-list');
  if(!root) return;
  if(!friendsCache.length){
    root.innerHTML = `<p class="mini-note">No friends yet — send a request from "Classmates"</p>`;
    return;
  }
  root.innerHTML = friendsCache.map(f => {
    const idx = f.uids.indexOf(state.user.uid);
    const otherUid = f.uids[1 - idx];
    const otherName = f.names ? f.names[1 - idx] : 'Friend';
    return `<div class="fr-card">
      <div class="fr-avatar fr-avatar-fallback">${esc((otherName||'S').charAt(0).toUpperCase())}</div>
      <div class="fr-info">
        <div class="fr-name">${esc(otherName)}</div>
        <div class="fr-meta">Class ${esc(f.classLevel || '')}</div>
      </div>
      <button class="btn btn-sm btn-primary" data-section="dm" data-dm-uid="${esc(otherUid)}">${icon('chat','sm')} Chat</button>
    </div>`;
  }).join('');
}

async function sendRequest(toUid){
  if(!state.user) return;
  const target = classmatesCache.find(u => u.id === toUid);
  if(!target){ toast('User not found', 'error'); return; }
  if(target.classLevel !== state.profile?.classLevel){
    toast('Only same-class friend requests allowed', 'warn');
    return;
  }
  try {
    await addDoc(collection(db,'friend_requests'), {
      fromUid: state.user.uid,
      fromName: state.profile?.name || '',
      toUid: target.id,
      toName: target.name || '',
      classLevel: state.profile.classLevel,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    toast('Friend request sent', 'success');
  } catch(e){ toast('Failed: ' + e.message, 'error'); }
}

async function acceptRequest(reqId){
  const r = pendingCache.find(x => x.id === reqId);
  if(!r) return;
  try {
    const id = friendshipId(r.fromUid, r.toUid);
    await setDoc(doc(db,'friendships', id), {
      uids: [r.fromUid, r.toUid].sort(),
      names: [r.fromName || '', r.toName || ''],
      classLevel: r.classLevel || '',
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db,'friend_requests', r.id), { status: 'accepted', acceptedAt: serverTimestamp() });
    toast('Friend added', 'success');
  } catch(e){ toast('Failed: ' + e.message, 'error'); }
}

async function rejectRequest(reqId){
  try {
    await updateDoc(doc(db,'friend_requests', reqId), { status: 'rejected' });
    toast('Rejected', 'info');
  } catch(e){ toast('Failed: ' + e.message, 'error'); }
}

export function friendshipId(a, b){
  return [a, b].sort().join('_');
}
export function getFriends(){ return friendsCache.slice(); }
export function isFriendOf(uid){ return friendsCache.some(f => f.uids.includes(uid)); }
