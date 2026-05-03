// tasks.js — per-user tasks with time reminders, daily repeated tasks, Firebase storage.
import {
  db, collection, doc, addDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from './firebase-init.js';
import { state, esc, icon, fmtDateTime, fmtTime, uid as makeUid } from './store.js';
import { toast } from './toast.js';

let unsubTasks = null;
let reminderTimers = {};

// === Init ===
export function loadTasks(){
  if(!state.user){ renderTasks(); return; }
  if(unsubTasks){ unsubTasks(); }
  try {
    const q = query(
      collection(db, 'user_tasks'),
      where('uid','==', state.user.uid),
      orderBy('createdAt','desc')
    );
    unsubTasks = onSnapshot(q, snap => {
      state.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderTasks();
      renderDashboardTasks();
      scheduleReminders();
    }, () => {
      // fallback localStorage
      try { state.tasks = JSON.parse(localStorage.getItem(`sb-${state.user?.uid}-tasks`) || '[]'); }
      catch(e){ state.tasks = []; }
      renderTasks();
      renderDashboardTasks();
    });
  } catch(e){
    try { state.tasks = JSON.parse(localStorage.getItem(`sb-${state.user?.uid}-tasks`) || '[]'); }
    catch(ex){ state.tasks = []; }
    renderTasks();
    renderDashboardTasks();
  }
  checkDailyReset();
}

export function stopTasks(){
  if(unsubTasks){ unsubTasks(); unsubTasks = null; }
  Object.values(reminderTimers).forEach(clearTimeout);
  reminderTimers = {};
}

// === Add ===
export async function addTask(){
  const title   = document.getElementById('task-title')?.value.trim();
  const details = document.getElementById('task-details')?.value.trim();
  const source  = document.getElementById('task-source')?.value || 'custom';
  const timeVal = document.getElementById('task-time')?.value || '';
  const repeat  = document.getElementById('task-repeat')?.value || 'none';
  if(!title){ toast('Task title দিন','warn'); return; }

  const task = {
    uid: state.user?.uid || 'guest',
    title, details: details || '', source, done: false,
    taskTime: timeVal,
    repeat,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };

  try {
    if(state.user){
      await addDoc(collection(db,'user_tasks'), task);
    } else {
      state.tasks.unshift({ ...task, id:'task-'+makeUid(), createdAt: new Date().toISOString() });
      localStorage.setItem(`sb-guest-tasks`, JSON.stringify(state.tasks));
      renderTasks();
    }
    document.getElementById('task-title').value = '';
    document.getElementById('task-details').value = '';
    if(document.getElementById('task-time')) document.getElementById('task-time').value = '';
    toast('Task যোগ হয়েছে','success');
  } catch(e){ toast('Failed: '+e.message,'error'); }
}

export async function toggleTaskDone(id){
  const t = state.tasks.find(x => x.id === id);
  if(!t) return;
  const done = !t.done;
  try {
    await updateDoc(doc(db,'user_tasks', id), { done, completedAt: done ? serverTimestamp() : null });
  } catch(e){
    t.done = done;
    renderTasks();
  }
}

export async function deleteTask(id){
  try {
    await deleteDoc(doc(db,'user_tasks', id));
  } catch(e){
    state.tasks = state.tasks.filter(x => x.id !== id);
    renderTasks();
  }
}

// === Dashboard Quick Add ===
export async function quickAddTask(){
  const inp  = document.getElementById('quick-task-title');
  const tInp = document.getElementById('quick-task-time');
  const title = inp?.value.trim();
  if(!title){ toast('Task title দিন','warn'); return; }
  const timeVal = tInp?.value || '';
  const task = {
    uid: state.user?.uid || 'guest',
    title, details:'', source:'custom', done: false,
    taskTime: timeVal, repeat:'none',
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };
  try {
    if(state.user) await addDoc(collection(db,'user_tasks'), task);
    if(inp) inp.value = '';
    if(tInp) tInp.value = '';
    toast('Task যোগ হয়েছে ✓','success');
  } catch(e){ toast('Failed: '+e.message,'error'); }
}

// === Render ===
export function renderTasks(){
  const root = document.getElementById('task-list');
  if(!root) return;
  if(!state.tasks?.length){
    root.innerHTML = `<div class="empty-state">${icon('tasks','xl')}<div class="empty-title">কোনো task নেই</div><div class="empty-text">উপরে task যোগ করুন</div></div>`;
    return;
  }
  const labels = { daily:'Daily', custom:'Custom', admin:'Scheduled', repeated:'Daily Repeat' };
  root.innerHTML = state.tasks.map(t => {
    const timeLabel = t.taskTime ? `<span class="task-reminder-badge">${icon('clock','sm')} ${t.taskTime}</span>` : '';
    const repeatLabel = t.repeat && t.repeat!=='none' ? `<span class="badge" style="font-size:.72rem">${t.repeat==='daily'?'🔁 প্রতিদিন':t.repeat}</span>` : '';
    return `
    <div class="list-item ${t.done?'done':''}">
      <div class="list-main">
        <div class="list-title">${icon(t.done?'check':'add','sm')} ${esc(t.title)}</div>
        <div class="list-meta">${labels[t.source]||t.source} • ${fmtDateTime(t.createdAtMs||t.createdAt)} ${timeLabel} ${repeatLabel}${t.completedAt?' • Done ✓':''}</div>
        ${t.details ? `<div class="topic-note">${esc(t.details)}</div>` : ''}
      </div>
      <div class="list-actions">
        <button class="btn btn-success btn-sm" data-toggle-task="${t.id}">${t.done?'Undo':'Done'}</button>
        <button class="btn btn-danger btn-sm" data-delete-task="${t.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

export function renderDashboardTasks(){
  const root = document.getElementById('dashboard-task-list');
  if(!root) return;
  const list = (state.tasks || []).filter(t => !t.done).slice(0, 5);
  if(!list.length){
    root.innerHTML = '<div class="preview-empty">No pending task</div>';
    return;
  }
  root.innerHTML = list.map(t => `
    <div class="dash-task-row">
      <button class="task-check-btn" data-toggle-task="${esc(t.id)}" title="Mark done">${icon('check','sm')}</button>
      <div class="dash-task-main">
        <div class="dash-task-title">${esc(t.title)}</div>
        <div class="dash-task-meta">${t.taskTime ? `${icon('clock','sm')} ${esc(t.taskTime)}` : esc(t.source || 'custom')}</div>
      </div>
      <button class="btn-icon" data-delete-task="${esc(t.id)}" title="Delete">${icon('trash','sm')}</button>
    </div>
  `).join('');
}

// === Reminder system ===
function scheduleReminders(){
  Object.values(reminderTimers).forEach(clearTimeout);
  reminderTimers = {};
  const now = new Date();
  (state.tasks || []).forEach(t => {
    if(t.done || !t.taskTime) return;
    const [h,m] = t.taskTime.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if(target <= now) target.setDate(target.getDate() + 1);
    const diff = target - now;
    if(diff > 0 && diff < 24*60*60*1000){
      reminderTimers[t.id] = setTimeout(() => {
        showTaskReminder(t);
        if(t.repeat === 'daily') scheduleReminders();
      }, diff);
    }
  });
}

function showTaskReminder(task){
  toast(`⏰ Task reminder: ${task.title}`, 'warn', 8000);
  if('Notification' in window && Notification.permission === 'granted'){
    try {
      new Notification('Task Reminder', { body: task.title, icon: '/assets/logo.svg' });
    } catch(e){}
  }
}

// === Daily reset for repeated tasks ===
function checkDailyReset(){
  const key = `sb-task-lastday-${state.user?.uid}`;
  const today = new Date().toDateString();
  const last = localStorage.getItem(key);
  if(last === today) return;
  localStorage.setItem(key, today);
  // Re-open daily repeated tasks
  (state.tasks || []).filter(t => t.repeat === 'daily' && t.done).forEach(async t => {
    try { await updateDoc(doc(db,'user_tasks', t.id), { done: false, completedAt: null }); }
    catch(e){}
  });
}
