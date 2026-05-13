// syllabus.js — per-user syllabus topics. Stored in localStorage for
// offline-friendliness and lightness; synced to Firestore on demand.
import { state, esc, icon, fmtDateTime, uid as makeUid, emit } from './store.js';
import { toast } from './toast.js';

const KEY = () => `sb-${state.user?.uid || 'guest'}-syllabus`;

export function loadSyllabus(){
  try { state.syllabus = JSON.parse(localStorage.getItem(KEY()) || '[]'); }
  catch(e){ state.syllabus = []; }
  renderSyllabus();
  emit('syllabus-updated', state.syllabus);
}

export function saveSyllabusLocal(){
  localStorage.setItem(KEY(), JSON.stringify(state.syllabus));
  emit('syllabus-updated', state.syllabus);
}

export function addSyllabusTopic(payload){
  // Allow programmatic add (used by OCR import) or read from form.
  // When wired as a click handler the argument is a MouseEvent — treat
  // any DOM Event as "no payload" and fall through to the form fields.
  let subject, topic, note;
  if(payload && typeof payload === 'object' && !(payload instanceof Event)){
    subject = (payload.subject || '').trim();
    topic   = (payload.topic   || '').trim();
    note    = (payload.note    || '').trim();
  } else {
    subject = document.getElementById('syllabus-subject')?.value.trim() || '';
    topic   = document.getElementById('syllabus-topic')?.value.trim() || '';
    note    = document.getElementById('syllabus-note')?.value.trim() || '';
  }
  if(!subject || !topic){ toast('Subject ও Topic দিন','warn'); return; }
  state.syllabus.unshift({
    id: 'sy-' + makeUid(),
    subject, topic, chapter: topic, note, done: false,
    createdAt: new Date().toISOString(),
  });
  saveSyllabusLocal();
  ['syllabus-subject','syllabus-topic','syllabus-note'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  renderSyllabus();
  toast('Topic saved', 'success');
}

export function toggleSyllabusDone(id){
  const item = state.syllabus.find(x => x.id === id);
  if(!item) return;
  item.done = !item.done;
  item.completedAt = item.done ? new Date().toISOString() : null;
  saveSyllabusLocal();
  renderSyllabus();
}

export function deleteSyllabusTopic(id){
  state.syllabus = state.syllabus.filter(x => x.id !== id);
  saveSyllabusLocal();
  renderSyllabus();
}

// Returns the notes that are linked to a given syllabus chapter.
// Notes link via `note.syllabusId` (set when the user picks a chapter
// from the Add Note form).
export function notesForChapter(chapterId){
  const all = state.notes || [];
  return all.filter(n => n.syllabusTopicId === chapterId || n.syllabusId === chapterId);
}

// Used by the "Add Note for this chapter" shortcut: switches to the Add
// section, prefills the chapter picker + subject, and focuses the title.
export function startNoteForChapter(chapterId){
  const item = state.syllabus.find(x => x.id === chapterId);
  if(!item) return;
  // Switch section.
  import('./ui.js').then(m => m.showSection('add'));
  setTimeout(() => {
    const sub = document.getElementById('note-subject'); if(sub) sub.value = item.subject || '';
    const pick = document.getElementById('note-syllabus-pick');
    if(pick){
      pick.value = chapterId;
      pick.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const title = document.getElementById('note-title');
    if(title){ title.focus(); title.placeholder = `Note for: ${item.chapter || item.topic}`; }
  }, 60);
}

export function renderSyllabus(){
  const root = document.getElementById('syllabus-list');
  if(!root) return;
  const total = state.syllabus.length;
  const done = state.syllabus.filter(x => x.done).length;
  if(!total){
    root.innerHTML = `<div class="empty-state">${icon('book-open','xl')}<div class="empty-title">No topics yet</div><div class="empty-text">Add each chapter as a topic</div></div>`;
    return;
  }
  root.innerHTML = `<div class="list-item">
      <div class="list-main">
        <div class="list-title">Progress: ${done}/${total}</div>
        <div class="progress-bar"><span style="width:${Math.round(done/total*100)}%"></span></div>
      </div>
    </div>` + state.syllabus.map(x => {
      const linked = notesForChapter(x.id);
      const drawer = `<div class="chapter-notes-drawer">
        <h4>${icon('notes','sm')} Notes (${linked.length})</h4>
        ${linked.length
          ? `<ul>${linked.slice(0, 6).map(n => `
              <li>
                <a href="javascript:void(0)" data-open-note="${esc(n.id)}" style="text-decoration:none;color:inherit;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title || '(no title)')}</a>
                <span style="font-size:.7rem;color:var(--text2);flex-shrink:0">${n.revised ? '✓' : ''}</span>
              </li>`).join('')}</ul>`
          : `<div class="empty">এই chapter এ কোনো note নেই</div>`
        }
        <button data-add-note-for-chapter="${esc(x.id)}">${icon('add','sm')} Add note for this chapter</button>
      </div>`;
      return `
    <div class="list-item ${x.done?'done':''}">
      <div class="list-main">
        <div class="list-title">${icon(x.done?'check':'add','sm')} ${esc(x.topic)}</div>
        <div class="list-meta">${esc(x.subject)} • ${fmtDateTime(x.createdAt)}</div>
        ${x.note ? `<div class="topic-note">${esc(x.note)}</div>` : ''}
        ${drawer}
      </div>
      <div class="list-actions">
        <button class="btn btn-success btn-sm" data-toggle-topic="${x.id}">${x.done?'Undo':'Tick'}</button>
        <button class="btn btn-danger btn-sm" data-delete-topic="${x.id}">Delete</button>
      </div>
    </div>`;
    }).join('');
  // Wire add-note-for-chapter buttons (delegated bind).
  root.querySelectorAll('[data-add-note-for-chapter]').forEach(b => {
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      startNoteForChapter(b.dataset.addNoteForChapter);
    });
  });
}
