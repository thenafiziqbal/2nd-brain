// focus-timer.js — focus tracking with session history.
//
// IMPORTANT: the previous version created a brand-new AudioContext for
// every chime, which caused mobile Chrome to grant the page audio focus
// and pause media playing in other tabs (the user reported this).
// We now share ONE AudioContext, only resume it on user gesture, and
// suspend it after each chime so the browser releases media focus.
import { state, esc, icon, fmtDateTime, fmtTime, fmtSeconds } from './store.js';
import { toast } from './toast.js';

const KEY = () => `sb-${state.user?.uid || 'guest'}-focus-sessions`;
const ACTIVE_KEY = () => `sb-${state.user?.uid || 'guest'}-focus-active`;

// `active` means the user has explicitly started a focus session. The
// timer can still be "paused" (counter suspended) while active is true —
// that happens automatically when the tab/app loses visibility. Total
// elapsed seconds is `elapsed + (running ? now - startMs : 0)`.
let active = false;
let running = false;   // counting right now? false while tab is hidden.
let startMs = 0;       // ms timestamp when current run-segment began.
let elapsed = 0;       // seconds accumulated from previous run-segments.
let interval = null;
let sharedAudio = null;

export function initFocus(){
  document.getElementById('focus-toggle-btn')?.addEventListener('click', toggleFocus);
  document.getElementById('focus-main-toggle')?.addEventListener('click', toggleFocus);
  // Auto-pause/resume on tab visibility change so time only counts while
  // the user is actually on the app. Also handles window blur/focus and
  // pagehide/pageshow for mobile (where iOS Safari sometimes skips
  // visibilitychange when the user switches apps).
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', pauseRun);
  window.addEventListener('focus', resumeRun);
  window.addEventListener('pagehide', pauseRun);
  window.addEventListener('pageshow', resumeRun);
  // On unload, persist whatever we've counted so we never lose progress.
  window.addEventListener('beforeunload', persistActive);
  restoreFocus();
  renderHistory();
}

function onVisibilityChange(){
  if(document.visibilityState === 'hidden') pauseRun();
  else resumeRun();
}

export function toggleFocus(){
  if(active) stop(); else start();
}

function start(){
  active = true;
  running = true;
  startMs = Date.now();
  elapsed = 0;
  persistActive();
  paintActive(true);
  chime('start');
  toast('Focus started','success');
  interval = setInterval(updateDisplay, 1000);
  updateDisplay();
}

// Pause the running counter without ending the session — used when the
// tab/app is hidden. Accumulated seconds get folded into `elapsed` so
// the next resume picks up exactly where we left off.
function pauseRun(){
  if(!active || !running) return;
  elapsed += Math.floor((Date.now() - startMs) / 1000);
  running = false;
  startMs = 0;
  persistActive();
  updateDisplay();
  paintActive(true); // keep "active" visual state but timer freezes.
}

// Resume after the tab/app is visible again. Continues from saved
// `elapsed`.
function resumeRun(){
  if(!active || running) return;
  running = true;
  startMs = Date.now();
  persistActive();
  if(!interval) interval = setInterval(updateDisplay, 1000);
  updateDisplay();
  paintActive(true);
}

function persistActive(){
  if(!active){ localStorage.removeItem(ACTIVE_KEY()); return; }
  // Snapshot the in-progress segment too so a forced reload doesn't
  // lose it. We bake the running segment into `elapsed` for storage.
  const snap = {
    elapsed: elapsed + (running ? Math.floor((Date.now() - startMs) / 1000) : 0),
    running,
    savedAt: Date.now(),
  };
  try { localStorage.setItem(ACTIVE_KEY(), JSON.stringify(snap)); } catch(e){}
}

function stop(){
  // Total = previously accumulated + currently running segment.
  const dur = elapsed + (running ? Math.floor((Date.now() - startMs) / 1000) : 0);
  active = false;
  running = false;
  clearInterval(interval);
  interval = null;
  localStorage.removeItem(ACTIVE_KEY());
  paintActive(false);
  chime('stop');
  // Save session.
  const sessions = readSessions();
  const end = new Date();
  const note = document.getElementById('focus-session-note')?.value.trim() || '';
  sessions.push({
    date: end.toISOString(),
    start: new Date(end.getTime() - dur*1000).toISOString(),
    end: end.toISOString(),
    duration: dur, note
  });
  localStorage.setItem(KEY(), JSON.stringify(sessions));
  const noteEl = document.getElementById('focus-session-note');
  if(noteEl) noteEl.value = '';
  // Notify study-tracker.js so it can write to Firestore for leaderboards.
  window.dispatchEvent(new CustomEvent('focus-session-end', {
    detail: { duration: dur, note, start: end.getTime() - dur*1000, end: end.getTime() }
  }));
  toast(`Focused ${fmtSeconds(dur)}`,'success');
  elapsed = 0;
  startMs = 0;
  updateDisplay();
  renderHistory();
}

// Restore an active focus session after a reload / browser restart.
// We restore exactly the elapsed time the user had when they left and
// resume counting only when the tab is visible.
function restoreFocus(){
  const raw = localStorage.getItem(ACTIVE_KEY());
  if(!raw) return;
  try {
    const d = JSON.parse(raw);
    elapsed = Number(d.elapsed) || 0;
    active = true;
    running = false; // resumeRun() decides if we should run.
    paintActive(true);
    if(document.visibilityState === 'visible' && document.hasFocus()) resumeRun();
    else { updateDisplay(); /* will resume on visibilitychange */ }
  } catch(e){}
}

let persistTickCount = 0;
function updateDisplay(){
  const secs = elapsed + (running ? Math.floor((Date.now() - startMs)/1000) : 0);
  const str = fmtSeconds(secs);
  setText('focus-header-time', str);
  setText('focus-big-timer', str);
  setText('brain-time-label', '⏱ ' + str);
  // Visual hint when paused due to tab hidden.
  const widget = document.getElementById('focus-header-widget');
  if(widget) widget.classList.toggle('paused', active && !running);
  const big = document.getElementById('focus-big-timer');
  if(big) big.classList.toggle('paused', active && !running);
  // Persist every 5s so a hard kill (mobile background swipe) loses
  // ≤5s of progress.
  if(active && (++persistTickCount % 5 === 0)) persistActive();
}

function paintActive(on){
  const widget = document.getElementById('focus-header-widget');
  const main = document.getElementById('focus-main-toggle');
  const toggle = document.getElementById('focus-toggle-btn');
  widget?.classList.toggle('active', on);
  if(toggle) toggle.innerHTML = icon(on ? 'pause' : 'play');
  if(main) main.innerHTML = `${icon(on?'pause':'play')} ${on ? 'Stop Focus' : 'Start Focus'}`;
}

export function getTotalFocusMinutes(){
  const sessions = readSessions();
  return Math.floor(sessions.reduce((a, s) => a + s.duration, 0) / 60);
}

function renderHistory(){
  const root = document.getElementById('focus-history-list');
  if(!root) return;
  const sessions = readSessions().slice().reverse().slice(0, 20);
  if(!sessions.length){
    root.innerHTML = `<div class="empty-state">${icon('focus','xl')}<div class="empty-title">No sessions yet</div><div class="empty-text">Press start to track focus</div></div>`;
    return;
  }
  root.innerHTML = sessions.map(s => {
    const d = new Date(s.date);
    const start = s.start ? new Date(s.start) : d;
    const end = s.end ? new Date(s.end) : d;
    return `<div class="focus-session-item">
      <div>
        <div class="focus-session-date">${fmtDateTime(d)}</div>
        <div class="list-meta">Start ${fmtTime(start)} • End ${fmtTime(end)}</div>
        ${s.note ? `<div class="focus-note-text">${esc(s.note)}</div>` : ''}
      </div>
      <span class="focus-session-dur">${fmtSeconds(s.duration)}</span>
    </div>`;
  }).join('');
}
export { renderHistory as renderFocusHistory };

function readSessions(){
  try { return JSON.parse(localStorage.getItem(KEY()) || '[]'); }
  catch(e){ return []; }
}

// One reusable AudioContext. Resumed only on a user gesture (the click
// that triggered start/stop). Suspended after the chime so the browser
// stops counting this tab as actively producing audio — that's what
// stops other tabs' videos from being paused.
function ensureCtx(){
  if(sharedAudio) return sharedAudio;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if(!Ctor) return null;
  sharedAudio = new Ctor();
  return sharedAudio;
}
function chime(kind){
  try {
    const ctx = ensureCtx();
    if(!ctx) return;
    if(ctx.state === 'suspended') ctx.resume();
    const notes = kind === 'start' ? [440, 660, 880] : [880, 660, 440];
    const t0 = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = t0 + i * .08;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(.06, t + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, t + .25);
      osc.start(t);
      osc.stop(t + .26);
    });
    // Suspend after the longest note, releasing audio focus.
    setTimeout(() => { try { ctx.suspend(); } catch(e){} }, 350);
  } catch(e){ /* silent */ }
}

function setText(id, v){ const el = document.getElementById(id); if(el) el.textContent = v; }
