// onboarding-tour.js — Section 7. Guided tour shown on first login.
// Uses a simple step list pointing at sidebar nav items; spotlights each
// element with a soft overlay + tooltip. The tutorial video URL is set
// by the admin in app settings (state.appSettings.tutorialVideoUrl).
import { state, on, esc, icon } from './store.js';

const STEPS = [
  { sel: '.brain-hero-orb',                title: 'Click the brain to start a focus session', desc: 'Background timer keeps running across every section.' },
  { sel: '[data-section="add"]',           title: 'Add notes',                title2: '', desc: 'Write or speak notes — link them to a syllabus chapter for context.' },
  { sel: '[data-section="syllabus"]',      title: 'Syllabus + AI questions',  desc: 'Add chapters or upload a PDF / image — AI extracts chapters automatically.' },
  { sel: '[data-section="courses"]',       title: 'YouTube Courses',          desc: 'Paste a playlist link and learn course-style.' },
  { sel: '[data-section="leaderboard"]',   title: 'Leaderboard',              desc: 'Track your daily study streak vs. classmates.' },
  { sel: '[data-section="prayer"]',        title: 'Prayer times',             desc: 'Auto-detected from your district / upazila.' },
];

let active = false;
let stepIdx = 0;

export function initOnboardingTour(){
  on('auth-ready', () => {
    if(!state.user) return;
    const key = `sb-onboarding-${state.user.uid}`;
    if(localStorage.getItem(key) === '1') return;
    localStorage.setItem(key, '1');
    setTimeout(start, 1500);
  });
  // Allow re-running from settings or help page.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-onboarding-restart]');
    if(b){ e.preventDefault(); start(); }
  });
}

export function start(){
  if(active) return;
  active = true;
  stepIdx = 0;
  const video = state.appSettings?.tutorialVideoUrl;
  // Welcome modal first.
  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'sb-onboarding-modal';
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">${icon('sparkles')} Welcome to Second Brain</div>
        <button class="modal-close" data-tour-close>×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:.92rem">A quick 1-minute tour will show you the most useful features.</p>
        ${video ? `<a class="btn btn-secondary btn-block" href="${esc(video)}" target="_blank" rel="noopener" style="margin-top:8px">${icon('play')} Watch tutorial video</a>` : ''}
      </div>
      <div class="modal-footer" style="display:flex;gap:8px">
        <button class="btn btn-secondary" data-tour-close>Skip</button>
        <button class="btn btn-success" id="sb-tour-start">Start tour →</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#sb-tour-start')?.addEventListener('click', () => { modal.remove(); showStep(); });
  modal.querySelectorAll('[data-tour-close]').forEach(b => b.addEventListener('click', () => { modal.remove(); active = false; }));
}

function showStep(){
  cleanupTip();
  if(stepIdx >= STEPS.length){ active = false; return; }
  const step = STEPS[stepIdx];
  const target = document.querySelector(step.sel);
  if(!target){ stepIdx++; showStep(); return; }
  target.scrollIntoView({ behavior:'smooth', block:'center' });
  const r = target.getBoundingClientRect();
  // Spotlight overlay.
  const ov = document.createElement('div');
  ov.id = 'sb-tour-overlay';
  ov.style.cssText = `position:fixed;inset:0;z-index:9999;pointer-events:auto;
    background:rgba(0,0,0,.55);box-shadow:inset 0 0 0 9999px rgba(0,0,0,0);`;
  // Tooltip.
  const tip = document.createElement('div');
  tip.id = 'sb-tour-tip';
  tip.style.cssText = `position:fixed;z-index:10000;max-width:280px;background:var(--surface);color:var(--text);
    border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);padding:12px 14px;font-size:.85rem`;
  tip.innerHTML = `<strong style="display:block;margin-bottom:4px">${esc(step.title)}</strong>
    <div style="color:var(--text2);font-size:.8rem">${esc(step.desc)}</div>
    <div style="display:flex;justify-content:space-between;margin-top:10px;gap:8px">
      <button class="btn btn-secondary btn-sm" id="sb-tour-skip">Skip tour</button>
      <button class="btn btn-primary btn-sm" id="sb-tour-next">${stepIdx === STEPS.length - 1 ? 'Done' : 'Next →'}</button>
    </div>`;
  // Place tooltip below or above based on target position.
  const top = r.bottom + 12 < window.innerHeight - 200 ? r.bottom + 12 : Math.max(20, r.top - 140);
  const left = Math.max(12, Math.min(window.innerWidth - 300, r.left));
  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
  // Highlight target with outline ring.
  target.classList.add('sb-tour-highlight');
  document.body.appendChild(ov);
  document.body.appendChild(tip);
  ov.addEventListener('click', endTour);
  tip.querySelector('#sb-tour-skip')?.addEventListener('click', endTour);
  tip.querySelector('#sb-tour-next')?.addEventListener('click', () => { stepIdx++; showStep(); });
}

function cleanupTip(){
  document.getElementById('sb-tour-overlay')?.remove();
  document.getElementById('sb-tour-tip')?.remove();
  document.querySelectorAll('.sb-tour-highlight').forEach(el => el.classList.remove('sb-tour-highlight'));
}

function endTour(){
  cleanupTip();
  active = false;
}
