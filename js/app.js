// app.js — orchestrator. Wires every module together. Loaded as a module
// from index.html so each helper file stays small and testable.
import { initTheme, toggleTheme } from './theme.js';
import { initOffline } from './offline.js';
import { registerSW } from './pwa.js';
import { state, on, emit, CLASS_LEVELS, esc, icon } from './store.js';
import { initAuth, logout } from './auth.js';
import { loadNotes } from './notes.js';
import { loadSyllabus } from './syllabus.js';
import { loadTasks, quickAddTask, stopTasks } from './tasks.js';
import { initFocus } from './focus-timer.js';
import { loadPrayer } from './prayer.js';
import { initChat } from './chat.js';
import { initVoice } from './voice.js';
import { initAIQuestions } from './ai-questions.js';
import { initUI, showSection } from './ui.js';
import { initSettings, syncSettingsForm } from './settings.js';
import { initPayment, paintTrialBanner, paintPaymentView } from './payment.js';
import { watchSystemSettings } from './system-settings.js';
import { watchBranding } from './branding.js';
import { watchPackages } from './packages.js';
import { paintReferPage } from './referral.js';
import { paintCommunity, paintFooter } from './community.js';
import { watchNotices } from './notices.js';
import { initProfile, paintProfileAvatar } from './profile.js';
// === New social / gamification / quiz modules ===
import { initStudyTracker } from './study-tracker.js';
import { initLeaderboard, startLeaderboard, stopLeaderboard } from './leaderboard.js';
import { watchSchools, bindSchoolPicker, submitSchoolRequest, DEFAULT_SCHOOL } from './schools.js';
import { initClassCommunity, autoEnroll as autoEnrollClass, startClassChat, stopClassChat } from './class-community.js';
import { initFriends, startFriends, stopFriends } from './friends.js';
import { initDM, startDM, stopDM, openDM } from './dm.js';
import { initQuiz, startQuiz, stopQuiz } from './quiz.js';
import { initNoteShare, startSharedNotes, stopSharedNotes } from './note-share.js';
import { initApiUsage } from './api-usage.js';
import { initMobileUI } from './mobile-ui.js';
import { initAdminFeatures } from './admin-features.js';
import { initDashboardPreviews } from './dashboard-previews.js';
import { initRevisionNotif, startRevisionSession, requestDisableNotif } from './revision-notif.js';
import { toast } from './toast.js';

// Boot.
document.body.classList.add('app-loading');
initTheme();
initOffline();
registerSW();
initUI();
initChat();
initVoice();
initAIQuestions();
initSettings();
initProfile();
initPayment();
populateClassDropdown();
populateRegisterSchoolDropdown();
bindHeader();
bindSchoolRequestForm();
initStudyTracker();
initLeaderboard();
initClassCommunity();
initFriends();
initDM();
initQuiz();
initNoteShare();
initApiUsage();
initMobileUI();
initAdminFeatures();
initRevisionNotif();
initDashboardPreviews();

// Quick task shortcut on dashboard
document.getElementById('quick-task-btn')?.addEventListener('click', quickAddTask);
document.getElementById('start-revision-session-btn')?.addEventListener('click', startRevisionSession);
document.getElementById('settings-disable-notif-btn')?.addEventListener('click', () => {
  const reason = prompt('কেন notification বন্ধ করতে চান? (ঐচ্ছিক)') || '';
  requestDisableNotif(reason);
});
document.getElementById('quick-task-title')?.addEventListener('keydown', e => {
  if(e.key === 'Enter'){ e.preventDefault(); quickAddTask(); }
});
document.getElementById('more-features-toggle')?.addEventListener('click', () => {
  document.getElementById('feature-grid')?.scrollIntoView({ behavior:'smooth', block:'start' });
});

// Brain icon click → Focus Mode
let appFocusActive = false;
let appFocusStartedAt = 0;
let appFocusSeconds = 0;
let appFocusTick = null;

document.querySelector('.brain-hero-orb')?.addEventListener('click', () => {
  appFocusActive ? stopAppFocusTracking() : startAppFocusTracking();
});
document.getElementById('focus-mode-stop-btn')?.addEventListener('click', () => {
  document.getElementById('focus-mode-overlay')?.classList.remove('active');
});
document.getElementById('focus-mode-pause-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('focus-mode-pause-btn');
  const overlay = document.getElementById('focus-mode-overlay');
  const paused = overlay?.dataset.paused === '1';
  if(paused){
    overlay.dataset.paused = '0';
    btn.innerHTML = '<svg class="ico"><use href="assets/icons.svg#i-pause"/></svg> Pause';
    startFocusModeTimer();
  } else {
    overlay.dataset.paused = '1';
    btn.innerHTML = '<svg class="ico"><use href="assets/icons.svg#i-play"/></svg> Resume';
    clearInterval(window._focusModeInterval);
  }
});

function startAppFocusTracking(){
  if(appFocusActive) return;
  appFocusActive = true;
  appFocusStartedAt = Date.now();
  appFocusSeconds = 0;
  document.querySelector('.brain-hero-orb')?.classList.add('tracking');
  toast('Focus tracking started', 'success');
  clearInterval(appFocusTick);
  appFocusTick = setInterval(() => {
    if(document.hidden) return;
    appFocusSeconds = Math.floor((Date.now() - appFocusStartedAt) / 1000);
    updateBrainFocusLabel();
  }, 1000);
  updateBrainFocusLabel();
}

function stopAppFocusTracking(){
  if(!appFocusActive) return;
  appFocusActive = false;
  clearInterval(appFocusTick);
  document.querySelector('.brain-hero-orb')?.classList.remove('tracking');
  const duration = Math.max(0, appFocusSeconds);
  updateBrainFocusLabel();
  if(duration >= 5){
    window.dispatchEvent(new CustomEvent('focus-session-end', {
      detail: { duration, note:'App focus time', start: appFocusStartedAt, end: Date.now() }
    }));
    toast(`Focus time added: ${Math.round(duration/60)} min`, 'success');
  }
}

function updateBrainFocusLabel(){
  const el = document.getElementById('brain-time-label');
  if(!el) return;
  const h = Math.floor(appFocusSeconds/3600);
  const m = Math.floor((appFocusSeconds%3600)/60);
  const s = appFocusSeconds%60;
  el.textContent = `${appFocusActive ? 'Tracking ' : ''}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

window.addEventListener('beforeunload', stopAppFocusTracking);

function maybeShowOnboardingTour(){
  if(!state.user) return;
  const key = `sb-tour-seen-${state.user.uid}`;
  if(localStorage.getItem(key) === '1') return;
  localStorage.setItem(key, '1');
  const video = state.appSettings?.tutorialVideoUrl;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">Welcome to Second Brain</div>
        <button class="modal-close" data-tour-close><svg class="ico"><use href="assets/icons.svg#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="tour-grid">
          <div>${icon('notes')} Notes + revision</div>
          <div>${icon('focus')} Focus tracking</div>
          <div>${icon('tasks')} Tasks + reminders</div>
          <div>${icon('flame')} Leaderboard</div>
          <div>${icon('chat')} Friends + messages</div>
          <div>${icon('sparkles')} AI practice</div>
        </div>
        ${video ? `<a class="btn btn-primary btn-block" href="${esc(video)}" target="_blank" rel="noopener">${icon('play')} Watch tutorial</a>` : ''}
      </div>
      <div class="modal-footer"><button class="btn btn-success" data-tour-close>Start using app</button></div>
    </div>`;
  modal.querySelectorAll('[data-tour-close]').forEach(b => b.addEventListener('click', () => modal.remove()));
  modal.addEventListener('click', e => { if(e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// Live admin-controlled config (no auth required).
watchBranding();
watchSystemSettings();
watchPackages();
watchNotices();
watchSchools();

// Auth gates everything user-specific.
initAuth(async (user) => {
  // Lift the boot loader regardless — auth state is now known.
  document.body.classList.remove('app-loading');
  if(!user) return; // auth screen visible
  // Load user data in parallel — fastest path to interactive UI.
  await Promise.allSettled([
    loadNotes(),
    loadSyllabus(),
    loadTasks(),
    loadPrayer(),
  ]);
  initFocus();
  // Greeting on the hero.
  const nameEl = document.getElementById('brain-greet-name');
  if(nameEl) nameEl.textContent = (state.profile?.name || state.user?.email?.split('@')[0] || 'Student');
  showSection('dashboard');
  syncSettingsForm();
  paintProfileAvatar();
  paintTrialBanner();
  paintPaymentView();
  paintCommunity();
  paintFooter();
  maybeShowOnboardingTour();
  // Auto-enroll the user into their class community + start syncing
  // friends/shared-notes so notifications arrive in real time.
  autoEnrollClass();
  startSharedNotes();
});

// Section-specific renderers — re-paint when the user opens that tab.
on('section', section => {
  if(section === 'refer')        paintReferPage();
  if(section === 'community')    paintCommunity();
  if(section === 'payment')      paintPaymentView();
  if(section === 'leaderboard')  startLeaderboard(); else stopLeaderboard();
  if(section === 'class-chat')   startClassChat(); else stopClassChat();
  if(section === 'friends')      startFriends(); else stopFriends();
  if(section === 'dm')           startDM(); else stopDM();
  if(section === 'quiz')         startQuiz(); else stopQuiz();
});

// Allow "Chat" buttons in the Friends list to deep-link into DM.
document.addEventListener('click', e => {
  const a = e.target.closest('[data-dm-uid]');
  if(!a) return;
  e.preventDefault();
  openDM(a.dataset.dmUid);
  showSection('dm');
});

function bindHeader(){
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('user-avatar')?.addEventListener('click', () => showSection('settings'));
}

function populateClassDropdown(){
  const sel = document.getElementById('reg-class');
  if(!sel) return;
  sel.innerHTML = '<option value="">-- Select Class / Level --</option>' +
    CLASS_LEVELS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  // Settings has the same class dropdown.
  const sset = document.getElementById('settings-class');
  if(sset && !sset.options.length){
    sset.innerHTML = '<option value="">-- Select --</option>' +
      CLASS_LEVELS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
}

function populateRegisterSchoolDropdown(){
  const sel = document.getElementById('reg-institution-select');
  const requestForm = document.getElementById('reg-school-request-block');
  if(sel) bindSchoolPicker(sel, requestForm);
  // Pre-populate with the default school so the value is set even
  // before the live `/schools` snapshot arrives.
  if(sel && !sel.options.length){
    sel.innerHTML = `<option value="${esc(DEFAULT_SCHOOL.name)}">${esc(DEFAULT_SCHOOL.name)}</option>` +
      `<option value="__other__">Other (নতুন স্কুল request করুন)</option>`;
  }
}

function bindSchoolRequestForm(){
  const btn = document.getElementById('reg-school-request-submit');
  if(!btn) return;
  btn.addEventListener('click', async () => {
    const name = document.getElementById('reg-school-request-name')?.value.trim();
    const district = document.getElementById('reg-school-request-district')?.value.trim();
    const upazila = document.getElementById('reg-school-request-upazila')?.value.trim();
    if(!name){ alert('School name দিন'); return; }
    btn.disabled = true;
    try {
      await submitSchoolRequest({
        name, district, upazila, type: 'school',
        requestedByUid: state.user?.uid,
        requestedByEmail: state.user?.email || document.getElementById('reg-email')?.value,
      });
      const status = document.getElementById('reg-school-request-status');
      if(status){ status.style.display = 'block'; status.textContent = 'Request submitted — admin approve করলে list এ যোগ হবে।'; }
    } catch(e){ alert('Submit failed: ' + e.message); }
    finally { btn.disabled = false; }
  });
}

// === Focus Mode Timer ===
function startFocusModeTimer(){
  const overlay = document.getElementById('focus-mode-overlay');
  const display = document.getElementById('focus-mode-timer-display');
  if(!overlay || !display) return;
  let seconds = parseInt(overlay.dataset.seconds || '1500');
  clearInterval(window._focusModeInterval);
  window._focusModeInterval = setInterval(() => {
    if(overlay.dataset.paused === '1') return;
    seconds--;
    overlay.dataset.seconds = seconds;
    const m = Math.floor(seconds/60);
    const s = seconds % 60;
    display.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if(seconds <= 0){
      clearInterval(window._focusModeInterval);
      overlay.classList.remove('active');
      toast('🎉 Focus session শেষ!', 'success', 5000);
    }
  }, 1000);
}
