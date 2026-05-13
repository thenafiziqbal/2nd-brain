// settings.js — student preferences + API keys + payment status display.
import { state, esc, icon, CLASS_LEVELS } from './store.js';
import { db, doc, updateDoc, getDoc } from './firebase-init.js';
import { auth, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail } from './firebase-init.js';
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
  // Username edit button
  document.getElementById('settings-user-id-edit-btn')?.addEventListener('click', editUsername);
  // Change password button
  document.getElementById('settings-change-pw-btn')?.addEventListener('click', showChangePasswordModal);
}

export function syncSettingsForm(){
  const p = state.profile || {};
  setVal('settings-name', p.name);
  setVal('settings-user-id', p.userId || '');
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

async function editUsername(){
  const currentUserId = state.profile?.userId || '';
  const newUserId = prompt(`নতুন ইউজার আইডি দিন (বর্তমান: ${currentUserId})`, currentUserId);
  if(!newUserId || newUserId === currentUserId) return;
  if(!/^[a-zA-Z0-9._-]+$/.test(newUserId)){
    toast('শুধুমাত্র letters, numbers, dot, dash, underscore ব্যবহার করুন', 'error');
    return;
  }
  if(newUserId.length < 3){
    toast('কমপক্ষে 3 characters লাগবে', 'error');
    return;
  }
  if(!confirm(`নতুন ইউজার আইডি: ${newUserId}?\n(এটি পরিবর্তন করা যাবে না, ভালোভাবে চিন্তা করুন)`)) return;
  
  try {
    // Check if new ID is unique
    const existingDoc = await getDoc(doc(db, 'user_ids', newUserId));
    if(existingDoc.exists()){
      toast('এই ইউজার আইডি ইতিমধ্যে ব্যবহৃত হয়েছে', 'error');
      return;
    }
    // Update profile
    await updateDoc(doc(db, 'users', state.user.uid), { userId: newUserId });
    // Update ID mapping
    await updateDoc(doc(db, 'user_ids', currentUserId), { archived: true }, { merge: true });
    await updateDoc(doc(db, 'user_ids', newUserId), { uid: state.user.uid, email: state.user.email, createdAt: new Date() });
    state.profile.userId = newUserId;
    setVal('settings-user-id', newUserId);
    toast('ইউজার আইডি পরিবর্তন করা হয়েছে', 'success');
  } catch(e){
    toast('পরিবর্তন ব্যর্থ: ' + e.message, 'error');
  }
}

async function showChangePasswordModal(){
  const result = prompt('নতুন password দিন (কমপক্ষে 6 characters):');
  if(!result || result.length < 6){
    if(result) toast('কমপক্ষে 6 characters লাগবে', 'error');
    return;
  }
  const confirmation = prompt('নতুন password আবার দিন (নিশ্চিত করতে):');
  if(confirmation !== result){
    toast('Passwords match করে না', 'error');
    return;
  }
  const currentPw = prompt('বর্তমান password দিন (যাচাইয়ের জন্য):');
  if(!currentPw){
    return;
  }
  
  try {
    if(!auth.currentUser) return;
    // Re-authenticate first
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPw);
    await reauthenticateWithCredential(auth.currentUser, credential);
    // Now update password
    await updatePassword(auth.currentUser, result);
    toast('Password সফলভাবে পরিবর্তন করা হয়েছে', 'success');
  } catch(e){
    if(e.code === 'auth/wrong-password'){
      toast('বর্তমান password ভুল', 'error');
    } else {
      toast('Password পরিবর্তন ব্যর্থ: ' + e.message, 'error');
    }
  }
}
