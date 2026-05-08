// quiz.js — monthly quiz campaigns. Admin creates campaigns from the
// admin panel; users see active ones on their Quiz tab and can take a
// quiz once per campaign.
//
// Data model:
//   /quiz_campaigns/{id} = { title, category, classLevel,
//                             startAt, endAt, active, questions:[{q,options[],a}],
//                             durationMinutes }
//   /quiz_attempts/{id}  = { uid, name, classLevel, campaignId, score, totalQ,
//                             startedAt, finishedAt }
import {
  db, collection, doc, addDoc, getDoc, query, where, orderBy, onSnapshot,
  serverTimestamp
} from './firebase-init.js';
import { state, esc, icon } from './store.js';
import { toast } from './toast.js';
import { notify, isPushReady } from './push-notifications.js';

let unsub = null;
let allCampaigns = [];
// Track which campaigns we've already notified about so we don't spam the
// user every time the snapshot fires.
const notifiedCampaigns = new Set();

export function initQuiz(){
  // Bound by app.js routing — nothing to bind here.
}

export function startQuiz(){
  stopQuiz();
  unsub = onSnapshot(
    query(collection(db,'quiz_campaigns'), orderBy('startAt','desc')),
    snap => {
      allCampaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      maybeNotifyNewCampaigns(allCampaigns);
      paint();
    },
    err => {
      const root = document.getElementById('quiz-list');
      if(root) root.innerHTML = `<div class="empty-state">${icon('warning','xl')}<div class="empty-title">Could not load</div><div class="empty-text">${esc(err.message||'')}</div></div>`;
    }
  );
}

export function stopQuiz(){
  if(unsub){ unsub(); unsub = null; }
}

function paint(){
  const root = document.getElementById('quiz-list');
  if(!root) return;
  const now = Date.now();
  const visible = allCampaigns.filter(c => {
    if(c.active === false) return false;
    if(c.classLevel && c.classLevel !== 'all' && state.profile?.classLevel && c.classLevel !== state.profile.classLevel) return false;
    return true;
  });
  if(!visible.length){
    root.innerHTML = `<div class="empty-state">${icon('sparkles','xl')}<div class="empty-title">No active quiz</div><div class="empty-text">Admin আপাতত কোনো quiz campaign চালায়নি।</div></div>`;
    return;
  }
  root.innerHTML = visible.map(c => {
    const start = ts(c.startAt);
    const end = ts(c.endAt);
    const live = (!start || now >= start) && (!end || now <= end);
    const status = live
      ? `<span class="badge green">Live</span>`
      : end && now > end
      ? `<span class="badge danger">Ended</span>`
      : `<span class="badge">${start ? new Date(start).toLocaleString('en-BD') : 'Soon'}</span>`;
    return `<div class="quiz-card">
      <div>
        <div class="quiz-title">${esc(c.title || 'Quiz')}</div>
        <div class="quiz-meta">${esc(c.category || 'general')} • ${esc(c.classLevel || 'all')} • ${(c.questions||[]).length} প্রশ্ন</div>
        ${c.description ? `<p class="mini-note">${esc(c.description)}</p>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        ${status}
        <button class="btn btn-primary btn-sm" data-quiz-start="${esc(c.id)}" ${live?'':'disabled'}>${icon('play','sm')} Start Quiz</button>
      </div>
    </div>`;
  }).join('');
  root.querySelectorAll('[data-quiz-start]').forEach(b => {
    b.addEventListener('click', () => takeQuiz(b.dataset.quizStart));
  });
}

function ts(t){
  if(!t) return null;
  if(typeof t === 'number') return t;
  if(t.toMillis) return t.toMillis();
  if(t.seconds) return t.seconds * 1000;
  return new Date(t).getTime();
}

async function takeQuiz(id){
  const c = allCampaigns.find(x => x.id === id);
  if(!c){ toast('Quiz not found', 'error'); return; }
  const qs = c.questions || [];
  if(!qs.length){ toast('এই quiz এ প্রশ্ন নেই', 'warn'); return; }
  const overlay = document.getElementById('quiz-overlay');
  const body = document.getElementById('quiz-body');
  if(!overlay || !body) return;
  let idx = 0;
  let score = 0;
  const startedAt = Date.now();
  const render = () => {
    if(idx >= qs.length){ finish(); return; }
    const q = qs[idx];
    body.innerHTML = `
      <div class="quiz-progress">${idx+1} / ${qs.length}</div>
      <div class="quiz-q">${esc(q.q || q.question || '')}</div>
      <div class="quiz-options">
        ${(q.options || []).map((o, i) => `
          <button class="quiz-option" data-opt="${i}">${esc(String.fromCharCode(65+i))}. ${esc(o)}</button>
        `).join('')}
      </div>`;
    body.querySelectorAll('[data-opt]').forEach(b => {
      b.addEventListener('click', () => {
        const correct = Number(q.a);
        if(Number(b.dataset.opt) === correct) score++;
        idx++; render();
      });
    });
  };
  const finish = async () => {
    body.innerHTML = `
      <div class="quiz-finish">
        <div class="quiz-score">Score: ${score} / ${qs.length}</div>
        <p>${score / qs.length >= 0.8 ? '🎉 Excellent!' : score / qs.length >= 0.5 ? '👍 ভালো করেছেন' : 'আরো অনুশীলন করুন'}</p>
        <button class="btn btn-primary" id="quiz-close-btn">Close</button>
      </div>`;
    document.getElementById('quiz-close-btn').addEventListener('click', () => overlay.classList.remove('open'));
    try {
      await addDoc(collection(db,'quiz_attempts'), {
        uid: state.user.uid,
        name: state.profile?.name || '',
        classLevel: state.profile?.classLevel || '',
        campaignId: id,
        campaignTitle: c.title || '',
        score, totalQ: qs.length,
        startedAt, finishedAt: Date.now(),
        createdAt: serverTimestamp(),
      });
    } catch(e){ console.warn('quiz attempt save failed', e); }
  };
  overlay.classList.add('open');
  render();
}


// Section 8 — when a new active campaign appears (matches user class), surface
// a desktop/mobile push notification. The first snapshot just seeds the
// "seen" set so we don't notify for everything on page load; subsequent
// campaigns fire one notification each.
let firstQuizSnapshot = true;
function maybeNotifyNewCampaigns(campaigns){
  if(firstQuizSnapshot){
    campaigns.forEach(c => notifiedCampaigns.add(c.id));
    firstQuizSnapshot = false;
    return;
  }
  if(!isPushReady()) return;
  const cls = state.profile?.classLevel;
  for(const c of campaigns){
    if(notifiedCampaigns.has(c.id)) continue;
    notifiedCampaigns.add(c.id);
    if(c.active === false) continue;
    if(c.classLevel && c.classLevel !== "all" && cls && c.classLevel !== cls) continue;
    notify("📝 New quiz: " + (c.title || "Quiz"), {
      body: c.category ? `Category: ${c.category}` : "Tap to start the new quiz now.",
      tag: `quiz-${c.id}`,
      data: { path: "/?section=quiz" },
    });
  }
}

