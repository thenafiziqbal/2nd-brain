// class-community.js — auto-enrolled per-class group chat.
//
// On user load we ensure they have a membership doc under
// /class_communities/{classKey}/members/{uid}. There is intentionally
// NO leave button — every student in a given class is permanently
// part of that community.
//
// Messages live in /class_communities/{classKey}/messages, ordered by
// createdAt. Lightweight: we only subscribe while the user is on the
// Community tab to keep Firestore reads bounded.
import {
  db, doc, collection, addDoc, setDoc, query, orderBy, limit, onSnapshot,
  serverTimestamp
} from './firebase-init.js';
import { state, esc, icon, fmtTime } from './store.js';
import { toast } from './toast.js';

let unsub = null;

export function classKey(){
  const c = state.profile?.classLevel || '';
  return c ? c.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : '';
}

export async function autoEnroll(){
  if(!state.user || !state.profile?.classLevel) return;
  const key = classKey();
  if(!key) return;
  try {
    await setDoc(doc(db,'class_communities', key), {
      classLevel: state.profile.classLevel,
      memberCount: 0, // best-effort; we don't strictly enforce it
      updatedAt: serverTimestamp(),
    }, { merge:true });
    await setDoc(doc(db,'class_communities', key, 'members', state.user.uid), {
      uid: state.user.uid,
      name: state.profile?.name || '',
      photoUrl: state.profile?.photoUrl || '',
      classLevel: state.profile.classLevel,
      joinedAt: serverTimestamp(),
    }, { merge:true });
  } catch(e){ console.warn('auto-enroll failed', e); }
}

export function startClassChat(){
  stopClassChat();
  const key = classKey();
  const root = document.getElementById('cc-messages');
  if(!root) return;
  if(!key){
    root.innerHTML = `<div class="empty-state">${icon('users','xl')}<div class="empty-title">Class set করুন</div><div class="empty-text">Settings → Class / Level আপডেট করলে আপনার community auto unlock হবে।</div></div>`;
    return;
  }
  const q = query(
    collection(db,'class_communities', key, 'messages'),
    orderBy('createdAt','asc'),
    limit(200)
  );
  unsub = onSnapshot(q, snap => {
    if(snap.empty){
      root.innerHTML = `<div class="empty-state">${icon('chat','xl')}<div class="empty-title">No messages yet</div><div class="empty-text">আপনার class এর সবার সাথে কথা বলুন</div></div>`;
      return;
    }
    root.innerHTML = snap.docs.map(d => renderMsg(d.data())).join('');
    root.scrollTop = root.scrollHeight;
  }, err => {
    root.innerHTML = `<div class="empty-state">${icon('warning','xl')}<div class="empty-title">Loading failed</div><div class="empty-text">${esc(err.message||'')}</div></div>`;
  });
}

export function stopClassChat(){
  if(unsub){ unsub(); unsub = null; }
}

function renderMsg(m){
  const me = m.uid === state.user?.uid;
  const avatar = m.photoUrl
    ? `<img src="${esc(m.photoUrl)}" class="cc-avatar"/>`
    : `<div class="cc-avatar cc-avatar-fallback">${esc((m.name||'S').charAt(0).toUpperCase())}</div>`;
  return `
    <div class="cc-msg ${me?'cc-msg-me':''}">
      ${avatar}
      <div class="cc-bubble">
        <div class="cc-author">${esc(m.name || 'Student')} <span class="cc-time">${fmtTime(m.createdAt)}</span></div>
        <div class="cc-text">${esc(m.text)}</div>
      </div>
    </div>`;
}

export async function sendClassMsg(){
  const inp = document.getElementById('cc-input');
  const text = (inp?.value || '').trim();
  if(!text) return;
  if(!state.user){ toast('Login first','warn'); return; }
  if(!state.online){ toast('Internet নেই','warn'); return; }
  const key = classKey();
  if(!key){ toast('Class set করুন','warn'); return; }
  try {
    await addDoc(collection(db,'class_communities', key, 'messages'), {
      uid: state.user.uid,
      name: state.profile?.name || 'Student',
      photoUrl: state.profile?.photoUrl || '',
      classLevel: state.profile?.classLevel || '',
      text,
      createdAt: serverTimestamp(),
    });
    inp.value = '';
  } catch(e){ toast('Send failed: ' + e.message, 'error'); }
}

export function initClassCommunity(){
  document.getElementById('cc-send-btn')?.addEventListener('click', sendClassMsg);
  document.getElementById('cc-input')?.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); sendClassMsg(); }
  });
}
