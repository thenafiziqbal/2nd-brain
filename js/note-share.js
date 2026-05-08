// note-share.js — append-only collaborative editing for notes.
//
// Workflow:
//   1. Owner clicks "Share" on a note → picks a friend → choose "View" or
//      "Edit (append-only)".
//   2. We write a `shared_notes` doc that lives at the friend's path under
//      `users/{friendUid}/shared_with_me/{shareId}` (firestore rules let
//      the owner write into the friend's subcollection, by-design — see
//      rules update). Doc references the original note path and includes
//      the original content snapshot so the friend can read.
//   3. If access is "edit", the friend can ONLY append new lines. We use
//      Firestore arrayUnion on a `blocks` array — each block is a
//      timestamped, author-tagged chunk. The original author's content
//      can never be modified.
import {
  db, doc, collection, addDoc, setDoc, getDoc, getDocs, updateDoc,
  query, where, onSnapshot, serverTimestamp
} from './firebase-init.js';
import { state, esc, icon, fmtDateTime } from './store.js';
import { toast } from './toast.js';
import { getFriends } from './friends.js';

let unsubShared = null;

export function initNoteShare(){
  document.getElementById('share-note-confirm-btn')?.addEventListener('click', confirmShare);
  document.getElementById('share-friend-pick')?.addEventListener('change', () => {/* no-op */});
}

export function openShareModal(noteId){
  const note = state.notes.find(n => n.id === noteId);
  if(!note){ toast('Note not found','error'); return; }
  const modal = document.getElementById('share-note-modal');
  if(!modal) return;
  document.getElementById('share-note-title').textContent = note.title;
  modal.dataset.noteId = noteId;
  const sel = document.getElementById('share-friend-pick');
  sel.innerHTML = getFriends().map(f => {
    const i = f.uids.indexOf(state.user.uid);
    const otherUid = f.uids[1 - i];
    const name = f.names ? f.names[1 - i] : 'Friend';
    return `<option value="${esc(otherUid)}">${esc(name)}</option>`;
  }).join('') || '<option value="">No friends yet</option>';
  modal.classList.add('open');
}

async function confirmShare(){
  const modal = document.getElementById('share-note-modal');
  const noteId = modal?.dataset.noteId;
  const note = state.notes.find(n => n.id === noteId);
  if(!note){ toast('Note not found','error'); return; }
  const friendUid = document.getElementById('share-friend-pick').value;
  const access = document.getElementById('share-access').value;
  if(!friendUid){ toast('Friend select করুন','warn'); return; }
  try {
    const ref = doc(collection(db,'users', friendUid, 'shared_with_me'));
    await setDoc(ref, {
      sharedByUid: state.user.uid,
      sharedByName: state.profile?.name || '',
      noteId,
      title: note.title,
      access,                    // 'view' | 'edit'
      originalContent: note.content,
      blocks: [
        { author: state.profile?.name || 'Owner', authorUid: state.user.uid, text: note.content, addedAt: Date.now() }
      ],
      createdAt: serverTimestamp(),
    });
    // Mark on owner's note that it's been shared.
    await updateDoc(doc(db,'users', state.user.uid, 'notes', noteId), {
      sharedWith: { [friendUid]: { access, at: Date.now() } },
    }).catch(()=>{});
    toast('Shared!', 'success');
    modal.classList.remove('open');
  } catch(e){
    toast('Share failed: ' + e.message, 'error');
  }
}

export function startSharedNotes(){
  stopSharedNotes();
  if(!state.user) return;
  unsubShared = onSnapshot(
    collection(db,'users', state.user.uid, 'shared_with_me'),
    snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      paintSharedList(items);
    },
    err => console.warn('shared notes watch failed', err)
  );
}
export function stopSharedNotes(){
  if(unsubShared){ unsubShared(); unsubShared = null; }
}

function paintSharedList(items){
  const root = document.getElementById('shared-notes-list');
  if(!root) return;
  if(!items.length){
    root.innerHTML = `<div class="empty-state">${icon('share','xl')}<div class="empty-title">No shared notes</div><div class="empty-text">কোনো friend আপনাকে এখনো note share করেনি</div></div>`;
    return;
  }
  root.innerHTML = items.map(i => `
    <div class="shared-note-card">
      <div class="shared-note-head">
        <div>
          <div class="shared-note-title">${esc(i.title)}</div>
          <div class="shared-note-by">From ${esc(i.sharedByName || '')} • ${esc(i.access || 'view')}</div>
        </div>
        ${i.access === 'edit' ? `<button class="btn btn-sm btn-primary" data-append-shared="${esc(i.id)}">${icon('add','sm')} Append</button>` : ''}
      </div>
      <div class="shared-note-blocks">
        ${(i.blocks||[]).map(b => `
          <div class="shared-block">
            <div class="shared-block-author">${esc(b.author || 'Author')} • ${fmtDateTime(b.addedAt)}</div>
            <div class="shared-block-text">${esc(b.text || '')}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
  root.querySelectorAll('[data-append-shared]').forEach(b => {
    b.addEventListener('click', () => promptAppend(b.dataset.appendShared, items));
  });
}

async function promptAppend(shareId, items){
  const item = items.find(x => x.id === shareId);
  if(!item) return;
  const text = prompt('Append text (original content আগে থেকেই থাকবে — মুছবে না):');
  if(!text) return;
  try {
    const ref = doc(db,'users', state.user.uid, 'shared_with_me', shareId);
    const snap = await getDoc(ref);
    const cur = snap.data();
    const newBlocks = [...(cur.blocks||[]), {
      author: state.profile?.name || 'Friend',
      authorUid: state.user.uid,
      text,
      addedAt: Date.now(),
    }];
    await updateDoc(ref, { blocks: newBlocks, updatedAt: serverTimestamp() });
    toast('Appended!', 'success');
  } catch(e){ toast('Append failed: ' + e.message, 'error'); }
}
