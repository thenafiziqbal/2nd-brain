// settings.js — student preferences + API keys + payment status display.
import { state, esc, icon, CLASS_LEVELS } from './store.js';
import { db, doc, updateDoc } from './firebase-init.js';
import { toast } from './toast.js';
import { trialDaysLeft, isTrialActive } from './ai.js';
import { paintProfileAvatar } from './profile.js';
import { syncPublicProfile } from './public-profile.js';

export function initSettings(){
  document.getElementById('save-settings-btn')?.addEventListener('click', save);
  document.getElementById('open-settings-btn')?.addEventListener('click', openModal);
  document.getElementById('close-settings-btn')?.addEventListener('click', closeModal);
  document.querySelectorAll('[data-toggle-pw]').forEach(b => b.addEventListener('click', () => {
    const inp = document.getElementById(b.dataset.togglePw);
    if(!inp) return;
    const showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    b.innerHTML = icon(showing ? 'eye' : 'eye-off');
  }));
  // populate class dropdown
  const klass = document.getElementById('settings-class');
  if(klass){
    klass.innerHTML = '<option value="">-- Select --</option>' +
      CLASS_LEVELS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
}

export function syncSettingsForm(){
  const p = state.profile || {};
  setVal('settings-name', p.name);
  setVal('settings-institution', p.institution);
  setVal('settings-district', p.district);
  setVal('settings-upazila', p.upazila);
  setVal('settings-class', p.classLevel);
  setVal('settings-religion', p.religion || 'islam');
  setVal('settings-prayer-enabled', p.prayerEnabled === false ? 'off' : 'on');
  setVal('settings-prayer-method', p.prayerMethod || '1');
  setVal('settings-prayer-school', p.prayerSchool || '0');
  setVal('settings-gemini-key', p.apiKeys?.gemini || '');
  setVal('settings-groq-key', p.apiKeys?.groq || '');
  setText('settings-api-usage', p.apiUsage || 0);
  paintTrialInfo();
  paintProfileAvatar();
  // Revision duration
  const revDurEl = document.getElementById('settings-rev-duration');
  if(revDurEl) revDurEl.value = state.revSettings?.customDuration || state.revDurationMin || 60;
  // Notif status
  const notifStatus = document.getElementById('settings-notif-status');
  if(notifStatus) notifStatus.textContent = state.revSettings?.notifDisabled ? '❌ বন্ধ (approved)' : '✅ চালু';
}

function paintTrialInfo(){
  const el = document.getElementById('settings-trial-info');
  if(!el) return;
  if(state.trial.plan === 'pro'){
    el.innerHTML = `${icon('check','sm')} <strong>Pro</strong> active`;
    el.style.color = 'var(--accent3)';
  } else if(isTrialActive()){
    el.innerHTML = `${icon('clock','sm')} ${trialDaysLeft()} days left in free trial`;
    el.style.color = 'var(--accent)';
  } else {
    el.innerHTML = `${icon('warning','sm')} Trial expired — add your own API key or subscribe`;
    el.style.color = 'var(--warn)';
  }
}

async function save(){
  if(!state.user) return;
  const updates = {
    name:        document.getElementById('settings-name').value.trim() || 'Student',
    institution: document.getElementById('settings-institution').value.trim(),
    district:    document.getElementById('settings-district')?.value.trim() || '',
    upazila:     document.getElementById('settings-upazila')?.value.trim() || '',
    classLevel:  document.getElementById('settings-class').value,
    religion:    document.getElementById('settings-religion').value,
    prayerEnabled: document.getElementById('settings-prayer-enabled').value === 'on',
    prayerMethod: document.getElementById('settings-prayer-method')?.value || '1',
    prayerSchool: document.getElementById('settings-prayer-school')?.value || '0',
    apiKeys: {
      gemini: document.getElementById('settings-gemini-key').value.trim(),
      groq:   document.getElementById('settings-groq-key').value.trim(),
    },
  };
  // Save revision duration to Firestore separately
  const revDur = parseInt(document.getElementById('settings-rev-duration')?.value) || 60;
  try {
    const { setDoc, doc: fsDoc } = await import('./firebase-init.js');
    await setDoc(fsDoc(db, 'user_rev_settings', state.user.uid), {
      customDuration: revDur,
      uid: state.user.uid,
    }, { merge: true });
    if(!state.revSettings) state.revSettings = {};
    state.revSettings.customDuration = revDur;
  } catch(e){}
  try {
    await updateDoc(doc(db, 'users', state.user.uid), updates);
    Object.assign(state.profile, updates);
    state.apiKeys = updates.apiKeys;
    await syncPublicProfile();
    toast('Settings saved','success');
    paintTrialInfo();
    closeModal();
  } catch(e){ toast('Save failed: ' + e.message, 'error'); }
}

function openModal(){
  syncSettingsForm();
  document.getElementById('settings-modal')?.classList.add('open');
}
function closeModal(){
  document.getElementById('settings-modal')?.classList.remove('open');
}

function setVal(id, v){ const el = document.getElementById(id); if(el) el.value = v ?? ''; }
function setText(id, v){ const el = document.getElementById(id); if(el) el.textContent = v; }
