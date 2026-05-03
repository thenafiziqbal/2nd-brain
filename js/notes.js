// notes.js — per-user note CRUD with optimistic local rendering.
// All reads/writes go through users/{uid}/notes so a user can never see
// another user's data — Firestore enforces this via security rules too.
import {
  db, userCol, addDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, doc, serverTimestamp, Timestamp
} from './firebase-init.js';
import { state, esc, icon, fmtDateTime, subjectStyle } from './store.js';
import { toast, confirmDialog } from './toast.js';

export async function loadNotes(){
  if(!state.user){ state.notes = []; renderAll(); return; }
  try {
    const q = query(userCol(state.user.uid, 'notes'), orderBy('createdAt','desc'));
    const snap = await getDocs(q);
    state.notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e){
    console.warn('loadNotes failed', e);
    state.notes = [];
  }
  renderAll();
}

export function renderAll(){
  renderDashboard();
  renderNotesGrid();
  renderRevisionFull();
  updateSidebarSubjects();
}

export function renderDashboard(){
  const now = new Date();
  const total = state.notes.length;
  const due = state.notes.filter(n => !n.revised && asDate(n.revisionDate) <= now);
  const recent = state.notes.slice(0, 6);
  setText('stat-total', total);
  setText('stat-revision', due.length);
  setText('stat-revised', state.notes.filter(n => n.revised).length);
  setText('stat-ai', state.apiUsage);
  setText('sidebar-notes-count', total);
  setText('sidebar-revision-count', due.length);
  setText('brain-total', total);
  setText('brain-due', due.length);

  const panel = document.getElementById('revision-panel');
  if(panel){
    if(due.length){
      panel.style.display = 'block';
      setText('revision-panel-count', due.length + ' notes');
      const list = document.getElementById('revision-list');
      list.innerHTML = due.slice(0,3).map(n => `
        <div class="revision-item">
          <div class="revision-info">
            <div class="revision-note-title">${esc(n.title)}</div>
            <div class="revision-note-subject">${esc(n.subject)}</div>
            <div class="revision-due-text">${icon('clock','sm')} Due now</div>
          </div>
          <button class="btn btn-success btn-sm" data-open-note="${n.id}">Revise</button>
        </div>`).join('');
    } else { panel.style.display = 'none'; }
  }

  const grid = document.getElementById('recent-notes-grid');
  if(grid){
    grid.innerHTML = recent.length === 0
      ? emptyState('brain', 'No notes yet', 'Add your first note to get started')
      : recent.map(noteCard).join('');
  }
}

export function renderNotesGrid(){
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  let f = state.notes;
  if(state.filter !== 'all') f = f.filter(n => n.subject === state.filter);
  if(search) f = f.filter(n =>
    n.title.toLowerCase().includes(search) || n.content.toLowerCase().includes(search));
  const grid = document.getElementById('all-notes-grid');
  if(!grid) return;
  grid.innerHTML = f.length === 0
    ? emptyState('search', 'No notes found', search ? 'Try another keyword' : 'No notes in this subject')
    : f.map(noteCard).join('');
}

export function renderRevisionFull(){
  const now = new Date();
  const due = state.notes.filter(n => !n.revised && asDate(n.revisionDate) <= now);
  const upcoming = state.notes.filter(n => !n.revised && asDate(n.revisionDate) > now);
  const revised = state.notes.filter(n => n.revised);
  const sec = (title, items, isDue) => items.length ? `
    <div style="margin-bottom:18px">
      <div class="section-header"><div class="section-title">${title}</div></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${items.map(n => {
          const s = subjectStyle(n.subject);
          const rd = asDate(n.revisionDate)?.toLocaleDateString('en-BD') || '';
          return `<div class="revision-item">
            <div class="revision-info">
              <div class="revision-note-title">${esc(n.title)}</div>
              <div class="revision-note-subject" style="color:${s.color}">${esc(n.subject)}</div>
              <div class="revision-due-text">${isDue ? 'Overdue' : 'Due ' + rd}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ai btn-sm" data-open-note="${n.id}">${icon('ai','sm')} AI</button>
              ${!n.revised
                ? `<button class="btn btn-success btn-sm" data-mark-revised="${n.id}">${icon('check','sm')} Done</button>`
                : `<span class="badge dot" style="color:var(--accent3)">Revised</span>`}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';
  const html = sec('Overdue', due, true) + sec('Upcoming', upcoming, false) + sec('Revised', revised, false);
  const root = document.getElementById('revision-full-list');
  if(root) root.innerHTML = html || emptyState('check', 'All caught up!', 'No revisions pending');
}

function updateSidebarSubjects(){
  const subjects = [...new Set(state.notes.map(n => n.subject))];
  const container = document.getElementById('sidebar-subjects');
  setText('count-all', state.notes.length);
  if(!container) return;
  // Wire the "All Subjects" reset button (first child).
  const allBtn = container.querySelector('[data-filter-all]');
  if(allBtn && !allBtn.dataset.bound){
    allBtn.dataset.bound = '1';
    allBtn.addEventListener('click', () => {
      document.querySelectorAll('.subject-tag').forEach(t => t.classList.remove('active'));
      allBtn.classList.add('active');
      state.filter = 'all';
      renderNotesGrid();
    });
  }
  container.querySelectorAll('.subject-tag:not(:first-child)').forEach(t => t.remove());
  subjects.forEach(s => {
    const style = subjectStyle(s);
    const count = state.notes.filter(n => n.subject === s).length;
    const el = document.createElement('div');
    el.className = 'subject-tag';
    el.innerHTML = `<div class="tag-dot" style="background:${style.dot}"></div>${esc(s)}<span class="tag-count">${count}</span>`;
    el.addEventListener('click', () => filterBySubject(s, el));
    container.appendChild(el);
  });
  // Filter tabs
  const tabs = document.getElementById('filter-tabs');
  if(tabs){
    tabs.innerHTML = `<button class="filter-tab ${state.filter==='all'?'active':''}" data-filter="all">All</button>` +
      subjects.map(s => `<button class="filter-tab ${state.filter===s?'active':''}" data-filter="${esc(s)}">${esc(s)}</button>`).join('');
    tabs.querySelectorAll('.filter-tab').forEach(b => b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      tabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      b.classList.add('active');
      renderNotesGrid();
    }));
  }
}

function filterBySubject(subject, el){
  document.querySelectorAll('.subject-tag').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  state.filter = subject;
  renderNotesGrid();
  document.querySelector('[data-section="notes"]')?.click();
}

function noteCard(n){
  const s = subjectStyle(n.subject);
  const now = new Date();
  const due = !n.revised && asDate(n.revisionDate) <= now;
  const date = asDate(n.createdAt)?.toLocaleDateString('en-BD') || '';
  return `<article class="note-card${due?' revision-due':''}${n.revised?' revised-card':''}" data-open-note="${n.id}">
    ${due ? '<div class="revision-indicator"></div>' : ''}
    <div class="note-card-top">
      <div class="note-title">${esc(n.title)}</div>
      <div class="note-actions">
        <button class="btn-icon" data-delete-note="${n.id}" title="Delete">${icon('trash','sm')}</button>
      </div>
    </div>
    <div class="note-content">${esc(n.content)}</div>
    <div class="note-footer">
      <span class="subject-badge" style="background:${s.bg};color:${s.color}"><span class="dot"></span>${esc(n.subject)}</span>
      <span>${date}</span>
    </div>
  </article>`;
}

export async function saveNote(){
  if(!state.user){ toast('Please login first','warn'); return; }
  const title = document.getElementById('note-title').value.trim();
  const content = document.getElementById('note-content').value.trim();
  const subject = document.getElementById('note-subject').value;
  if(!title || !content || !subject){ toast('সব ফিল্ড পূরণ করুন','warn'); return; }
  const btn = document.getElementById('save-btn');
  btn?.classList.add('btn-loading');
  const delay = state.appSettings?.revisionDelay || 24;
  const now = new Date();
  try {
    await addDoc(userCol(state.user.uid, 'notes'), {
      title, content, subject,
      createdAt: serverTimestamp(),
      revisionDate: Timestamp.fromDate(new Date(now.getTime() + delay*3600000)),
      revised: false,
    });
    toast('Note saved', 'success');
    document.getElementById('note-title').value = '';
    document.getElementById('note-content').value = '';
    document.getElementById('note-subject').value = '';
    await loadNotes();
  } catch(e){
    toast('Save failed: ' + e.message, 'error');
  } finally { btn?.classList.remove('btn-loading'); }
}

export async function deleteNote(id){
  if(!state.user) return;
  if(!await confirmDialog('Delete this note?')) return;
  try {
    await deleteDoc(doc(db, 'users', state.user.uid, 'notes', id));
    state.notes = state.notes.filter(n => n.id !== id);
    renderAll();
    document.getElementById('detail-modal')?.classList.remove('open');
    toast('Note deleted', 'info');
  } catch(e){ toast('Delete failed: ' + e.message, 'error'); }
}

export async function markRevised(id){
  if(!state.user) return;
  const note = state.notes.find(n => n.id === id);
  if(!note || note.revised) return;
  try {
    await updateDoc(doc(db, 'users', state.user.uid, 'notes', id), { revised: true });
    note.revised = true;
    renderAll();
    document.getElementById('detail-modal')?.classList.remove('open');
    toast('Revision complete', 'success');
  } catch(e){ toast('Update failed: ' + e.message, 'error'); }
}

// Helpers
function setText(id, v){ const el = document.getElementById(id); if(el) el.textContent = v; }
function asDate(d){ if(!d) return null; if(typeof d.toDate === 'function') return d.toDate(); return new Date(d); }
function emptyState(iconName, title, text){
  return `<div class="empty-state">${icon(iconName,'xl')}<div class="empty-title">${esc(title)}</div><div class="empty-text">${esc(text)}</div></div>`;
}
