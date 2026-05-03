// ui.js — section navigation, modal handling, FAQ accordion, delegation.
import { state, esc, icon, subjectStyle, emit } from './store.js';
import { renderDashboard, renderNotesGrid, renderRevisionFull, deleteNote, markRevised } from './notes.js';
import { renderSyllabus, addSyllabusTopic, toggleSyllabusDone, deleteSyllabusTopic } from './syllabus.js';
import { renderTasks, addTask, toggleTaskDone, deleteTask } from './tasks.js';
import { renderFocusHistory } from './focus-timer.js';
import { setActiveChapter } from './ai-questions.js';
import { aiChat } from './ai.js';
import { syncSettingsForm } from './settings.js';
import { toast } from './toast.js';

export function initUI(){
  // Section navigation (sidebar + bottom nav).
  document.querySelectorAll('[data-section]').forEach(el => {
    el.addEventListener('click', () => showSection(el.dataset.section, el));
  });

  // FAQ accordion.
  document.querySelectorAll('.faq-q').forEach(b => {
    b.addEventListener('click', () => b.closest('.faq-item').classList.toggle('open'));
  });

  // Generic delegation — keeps event handlers off every render.
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open-note]');     if(t) return openNoteDetail(t.dataset.openNote);
    const d = e.target.closest('[data-delete-note]');   if(d){ e.stopPropagation(); return deleteNote(d.dataset.deleteNote); }
    const r = e.target.closest('[data-mark-revised]');  if(r) return markRevised(r.dataset.markRevised);
    const ts = e.target.closest('[data-toggle-topic]'); if(ts) return toggleSyllabusDone(ts.dataset.toggleTopic);
    const dt = e.target.closest('[data-delete-topic]'); if(dt) return deleteSyllabusTopic(dt.dataset.deleteTopic);
    const tt = e.target.closest('[data-toggle-task]');  if(tt) return toggleTaskDone(tt.dataset.toggleTask);
    const dtt = e.target.closest('[data-delete-task]'); if(dtt) return deleteTask(dtt.dataset.deleteTask);
    const cs = e.target.closest('[data-chapter-select]');
    if(cs){
      const id = cs.dataset.chapterSelect;
      document.querySelectorAll('.chapter-item').forEach(x => x.classList.toggle('active', x === cs));
      const item = state.syllabus.find(s => s.id === id);
      if(item) setActiveChapter(item);
    }
  });

  // Modal backdrop closes.
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if(e.target === o) o.classList.remove('open'); });
  });
  document.querySelectorAll('[data-close-modal]').forEach(b =>
    b.addEventListener('click', () => document.getElementById(b.dataset.closeModal)?.classList.remove('open'))
  );

  // Form submit handlers (Add Note, Syllabus, Tasks).
  document.getElementById('save-btn')?.addEventListener('click', () => import('./notes.js').then(m => m.saveNote()));
  document.getElementById('add-syllabus-btn')?.addEventListener('click', addSyllabusTopic);
  document.getElementById('add-task-btn')?.addEventListener('click', addTask);
  document.getElementById('search-input')?.addEventListener('input', renderNotesGrid);
  document.getElementById('clear-form-btn')?.addEventListener('click', () => {
    ['note-title','note-content','note-subject'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  });
  document.getElementById('explain-ai-btn')?.addEventListener('click', explainCurrentNote);
}

export function showSection(section, el){
  document.querySelectorAll('.section-view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + section)?.classList.add('active');
  document.querySelectorAll('[data-section]').forEach(b => {
    b.classList.toggle('active', b.dataset.section === section);
  });
  if(section === 'dashboard') renderDashboard();
  if(section === 'notes')     renderNotesGrid();
  if(section === 'revision')  renderRevisionFull();
  if(section === 'syllabus')  { renderSyllabus(); paintChapterList(); }
  if(section === 'tasks')     renderTasks();
  if(section === 'focus')     renderFocusHistory();
  if(section === 'settings')  syncSettingsForm();
  // Notify modules that depend on tab visibility.
  emit('section', section);
}

function paintChapterList(){
  const root = document.getElementById('chapter-list');
  if(!root) return;
  if(!state.syllabus.length){
    root.innerHTML = `<div class="empty-state">${icon('book-open','xl')}<div class="empty-title">Syllabus খালি</div><div class="empty-text">প্রথমে topic add করুন</div></div>`;
    return;
  }
  root.innerHTML = state.syllabus.map(s => {
    const style = subjectStyle(s.subject);
    return `<div class="chapter-item" data-chapter-select="${s.id}">
      <span class="dot" style="width:8px;height:8px;border-radius:50%;background:${style.dot}"></span>
      <div style="flex:1;min-width:0">
        <div class="chapter-name">${esc(s.chapter || s.topic)}</div>
        <div class="chapter-sub">${esc(s.subject)}</div>
      </div>
    </div>`;
  }).join('');
}

export function openNoteDetail(id){
  const n = state.notes.find(x => x.id === id);
  if(!n) return;
  state.currentNoteId = id;
  const s = subjectStyle(n.subject);
  document.getElementById('detail-title').textContent = n.title;
  document.getElementById('detail-content').textContent = n.content;
  document.getElementById('detail-subject-badge').innerHTML =
    `<span class="subject-badge" style="background:${s.bg};color:${s.color}"><span class="dot"></span>${esc(n.subject)}</span>`;
  document.getElementById('detail-created').textContent = n.createdAt?.toDate?.()
    ? '📅 ' + n.createdAt.toDate().toLocaleString('en-BD') : '';
  document.getElementById('ai-area').innerHTML = '';
  const btn = document.getElementById('revise-btn');
  if(btn){
    btn.dataset.markRevised = id;
    btn.disabled = !!n.revised;
    btn.innerHTML = n.revised ? `${icon('check','sm')} Already Revised` : `${icon('check','sm')} Mark Revised`;
  }
  const del = document.getElementById('detail-delete-btn');
  if(del) del.dataset.deleteNote = id;
  const sh = document.getElementById('detail-share-btn');
  if(sh){
    sh.onclick = () => import('./note-share.js').then(m => m.openShareModal(id));
  }
  document.getElementById('detail-modal')?.classList.add('open');
}

async function explainCurrentNote(){
  const id = state.currentNoteId;
  const note = state.notes.find(n => n.id === id);
  if(!note) return;
  const area = document.getElementById('ai-area');
  area.innerHTML = `<div class="ai-thinking">${icon('ai','sm')} AI is thinking
    <div class="thinking-dots"><span></span><span></span><span></span></div></div>`;
  try {
    const sysTpl = state.appSettings?.sysNotes ||
      `You are a helpful tutor for Bengali students. Explain this note clearly. Use both Bengali and English. Subject: {{subject}}\nTitle: {{title}}\nContent: {{content}}`;
    const prompt = sysTpl
      .replace('{{subject}}', note.subject)
      .replace('{{title}}', note.title)
      .replace('{{content}}', note.content);
    const reply = await aiChat([{ role:'user', content: prompt }], { max_tokens: 700 });
    area.innerHTML = `<div class="ai-response"><strong style="color:var(--accent2)">${icon('ai','sm')} AI Explanation</strong><br>${esc(reply).replace(/\n/g,'<br>')}</div>`;
  } catch(e){
    area.innerHTML = `<div class="ai-response" style="color:var(--danger)">${icon('warning','sm')} ${esc(e.message)}</div>`;
  }
}
