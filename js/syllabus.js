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
  let subject, topic, note;
  if(payload && typeof payload === 'object'){
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
    </div>` + state.syllabus.map(x => `
    <div class="list-item ${x.done?'done':''}">
      <div class="list-main">
        <div class="list-title">${icon(x.done?'check':'add','sm')} ${esc(x.topic)}</div>
        <div class="list-meta">${esc(x.subject)} • ${fmtDateTime(x.createdAt)}</div>
        ${x.note ? `<div class="topic-note">${esc(x.note)}</div>` : ''}
      </div>
      <div class="list-actions">
        <button class="btn btn-success btn-sm" data-toggle-topic="${x.id}">${x.done?'Undo':'Tick'}</button>
        <button class="btn btn-danger btn-sm" data-delete-topic="${x.id}">Delete</button>
      </div>
    </div>`).join('');
}
