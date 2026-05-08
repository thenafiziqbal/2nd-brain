// leaderboard.js — real-time global ranking by total study seconds.
//
// Subscribes to /public_profiles (limit 200, order by totalStudySeconds desc) and
// renders the table whenever the data changes. A class filter lets the
// user narrow the view to their own class — all classes are visible by
// default so students can compare themselves to everyone.
import {
  db, collection, query, orderBy, limit, onSnapshot
} from './firebase-init.js';
import { state, esc, icon, fmtSeconds, CLASS_LEVELS, on } from './store.js';

let unsub = null;
let unsubHome = null;
let allRows = [];
let homeRows = [];
let activeClass = 'all';

export function initLeaderboard(){
  // Class filter dropdown.
  const sel = document.getElementById('lb-class-filter');
  if(sel){
    sel.innerHTML = '<option value="all">All classes</option>' +
      CLASS_LEVELS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.addEventListener('change', () => {
      activeClass = sel.value;
      paint();
    });
  }
  on('auth-ready', startHomeLeaderboard);
}

function startHomeLeaderboard(){
  if(unsubHome) return;
  const q = query(collection(db,'public_profiles'), orderBy('totalStudySeconds','desc'), limit(5));
  unsubHome = onSnapshot(q, snap => {
    homeRows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => (u.totalStudySeconds || 0) > 0);
    paintDashboardLeaderboard();
  }, err => console.warn('dashboard leaderboard watch failed', err));
}

export function startLeaderboard(){
  if(unsub) return;
  const q = query(collection(db,'public_profiles'), orderBy('totalStudySeconds','desc'), limit(200));
  unsub = onSnapshot(q, snap => {
    allRows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => (u.totalStudySeconds || 0) > 0);
    paint();
  }, err => {
    console.warn('leaderboard watch failed', err);
    const root = document.getElementById('lb-list');
    if(root) root.innerHTML = `<div class="empty-state">${icon('warning','xl')}<div class="empty-title">Couldn't load leaderboard</div><div class="empty-text">${esc(err.message||'')}</div></div>`;
  });
}

export function stopLeaderboard(){
  if(unsub){ unsub(); unsub = null; }
}

function paint(){
  const root = document.getElementById('lb-list');
  if(!root) return;
  const myUid = state.user?.uid;
  const filtered = activeClass === 'all'
    ? allRows
    : allRows.filter(u => (u.classLevel || '') === activeClass);
  if(!filtered.length){
    root.innerHTML = `<div class="empty-state">${icon('focus','xl')}<div class="empty-title">No study data yet</div><div class="empty-text">Focus Timer চালু করে পড়াশোনা শুরু করুন।</div></div>`;
    return;
  }
  root.innerHTML = `
    <table class="lb-table">
      <thead><tr>
        <th>Rank</th><th>Student</th><th>Class</th><th>Total</th>
      </tr></thead>
      <tbody>
        ${filtered.map((u, i) => {
          const rank = i + 1;
          const me = u.id === myUid;
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
          const avatar = u.photoUrl
            ? `<img src="${esc(u.photoUrl)}" alt="" class="lb-avatar"/>`
            : `<div class="lb-avatar lb-avatar-fallback">${esc((u.name||'S').charAt(0).toUpperCase())}</div>`;
          return `<tr class="${me?'lb-me':''}">
            <td class="lb-rank">${medal}</td>
            <td class="lb-user">
              ${avatar}
              <div>
                <div class="lb-name">${esc(u.name || 'Student')}${me?' <span class="badge">You</span>':''}</div>
                <div class="lb-school">${esc(u.institution || '')}</div>
              </div>
            </td>
            <td>${esc(u.classLevel || '—')}</td>
            <td><strong>${fmtSeconds(u.totalStudySeconds || 0)}</strong></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  paintDashboardLeaderboard();
}

function paintDashboardLeaderboard(){
  const root = document.getElementById('dashboard-leaderboard-list');
  if(!root) return;
  if(!homeRows.length){
    root.innerHTML = '<div class="preview-empty">No focus data yet</div>';
    return;
  }
  root.innerHTML = homeRows.map((u, i) => `
    <div class="dash-lb-row">
      <div class="dash-lb-rank">#${i + 1}</div>
      <div class="dash-lb-name">${esc(u.name || 'Student')}</div>
      <div class="dash-lb-time">${fmtSeconds(u.totalStudySeconds || 0)}</div>
    </div>
  `).join('');
}
