// auth.js — Firebase Auth wrapper.
// Handles registration (one-time) and login (persistent) with strict
// per-user data isolation. Once a user signs in, every subsequent visit
// goes straight to the dashboard — they only need to register once.
//
// Also wires up the referral program: every new user gets a unique
// referral code; if they registered via someone else's `?ref=XYZ` link,
// that referrer is recorded on the profile so admin can credit the reward
// when this user later buys a package.
import {
  auth, db, userDoc,
  onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile,
  doc, setDoc, getDoc, serverTimestamp
} from './firebase-init.js';
import { state, emit, TRIAL_MS, icon } from './store.js';
import { ensureReferralCode, resolveReferrer } from './referral.js';
import { toast } from './toast.js';
import { syncPublicProfile } from './public-profile.js';

export function initAuth(onReady){
  // Show a stub of the auth gate while we wait — prevents flash of content.
  const gate = document.getElementById('auth-gate');
  if(gate) gate.classList.add('show');

  // If the URL has a ?ref= code, stash it for the upcoming registration.
  const refFromUrl = new URLSearchParams(location.search).get('ref');
  if(refFromUrl){
    sessionStorage.setItem('pending-ref', refFromUrl.toUpperCase());
    // Show a friendly hint above the register form.
    const hint = document.getElementById('refer-hint');
    if(hint){
      hint.textContent = `🎁 Friend ${refFromUrl.toUpperCase()} এর referral দিয়ে join হচ্ছেন — দু'জনই reward পাবেন।`;
      hint.style.display = 'block';
    }
  }

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    if(user){
      // Load (or seed) the profile doc that owns all per-user data.
      await ensureProfile(user);
      await ensureReferralCode(user.uid);
      gate?.classList.remove('show');
      paintAvatar();
      emit('auth-ready', user);
    } else {
      state.profile = null;
      gate?.classList.add('show');
      emit('auth-signed-out');
    }
    onReady?.(user);
  });

  bindForms();
}

async function ensureProfile(user){
  const ref = userDoc(user.uid);
  let snap;
  try { snap = await getDoc(ref); } catch(e) { snap = null; }
  if(snap && snap.exists()){
    state.profile = snap.data();
  } else {
    // Seed a fresh profile. The trial clock starts here.
    const trialMs = (state.trialPackage?.durationDays || 14) * 86400000;
    const profile = {
      name: user.displayName || 'Student',
      email: user.email,
      institution: '',
      classLevel: '',
      religion: 'islam',
      prayerEnabled: true,
      apiKeys: { gemini:'', groq:'' },
      apiUsage: 0,
      plan: 'trial',
      trialStart: Date.now(),
      trialEnd: Date.now() + trialMs,
      rewardEnd: 0,
      referralCode: null,
      referredBy: null,
      createdAt: serverTimestamp(),
    };
    try { await setDoc(ref, profile); } catch(e) { /* offline okay */ }
    state.profile = profile;
  }
  state.trial = {
    startedAt: state.profile.trialStart,
    expiresAt: state.profile.trialEnd,
    plan: state.profile.plan || 'trial',
    rewardEnd: state.profile.rewardEnd || 0,
    packageId: state.profile.packageId || null,
  };
  state.apiKeys = state.profile.apiKeys || { gemini:'', groq:'' };
  state.apiUsage = state.profile.apiUsage || 0;
  await syncPublicProfile();
}

function paintAvatar(){
  const avatar = document.getElementById('user-avatar');
  if(!avatar) return;
  const name = state.profile?.name || state.user?.email || 'S';
  const url = state.profile?.photoUrl;
  avatar.title = name;
  if(url){
    avatar.innerHTML = `<img src="${url.replace(/"/g,'&quot;')}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/>`;
  } else {
    avatar.textContent = name.trim().charAt(0).toUpperCase();
  }
}

function bindForms(){
  // Tab switch.
  document.getElementById('login-tab')?.addEventListener('click', () => switchAuth('login'));
  document.getElementById('register-tab')?.addEventListener('click', () => switchAuth('register'));

  // If there's a pending ref code, default to the Register tab.
  if(sessionStorage.getItem('pending-ref')){
    switchAuth('register');
  }

  // Show/hide password toggles — works for both login and register.
  document.querySelectorAll('[data-toggle-pw]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const inp = document.getElementById(btn.dataset.togglePw);
      if(!inp) return;
      const showing = inp.type === 'text';
      inp.type = showing ? 'password' : 'text';
      btn.innerHTML = icon(showing ? 'eye' : 'eye-off');
      btn.title = showing ? 'পাসওয়ার্ড দেখুন' : 'পাসওয়ার্ড লুকান';
    });
  });

  // Forms.
  document.getElementById('login-form')?.addEventListener('submit', e => {
    e.preventDefault();
    handleLogin();
  });
  document.getElementById('register-form')?.addEventListener('submit', e => {
    e.preventDefault();
    handleRegister();
  });
}

function switchAuth(mode){
  ['login','register'].forEach(m => {
    document.getElementById(m+'-tab')?.classList.toggle('active', m===mode);
    document.getElementById(m+'-form')?.classList.toggle('active', m===mode);
  });
  document.getElementById('auth-error')?.classList.remove('show');
}

async function handleLogin(){
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pw    = document.getElementById('login-password').value;
  const btn   = document.querySelector('#login-form button[type=submit]');
  if(!email || !pw){ showError('Email এবং password দিন'); return; }
  setBusy(btn, true);
  try {
    await signInWithEmailAndPassword(auth, email, pw);
    toast('Welcome back!', 'success');
  } catch(e){
    showError(prettyAuthError(e));
  } finally { setBusy(btn, false); }
}

async function handleRegister(){
  const name = document.getElementById('reg-name').value.trim() || 'Student';
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const pw    = document.getElementById('reg-password').value;
  // Institution: prefer the dropdown (managed list + default school);
  // fall back to the legacy free-text field if the dropdown isn't there.
  const instSelect = document.getElementById('reg-institution-select');
  let inst = '';
  if(instSelect && instSelect.value && instSelect.value !== '__other__'){
    inst = instSelect.value.trim();
  } else if(instSelect && instSelect.value === '__other__'){
    inst = (document.getElementById('reg-school-request-name')?.value || '').trim();
  } else {
    inst = (document.getElementById('reg-institution')?.value || '').trim();
  }
  const klass = document.getElementById('reg-class').value;
  const district = document.getElementById('reg-district')?.value.trim() || '';
  const upazila = document.getElementById('reg-upazila')?.value.trim() || '';
  const religion = document.getElementById('reg-religion').value;
  const refInputEl = document.getElementById('reg-referral');
  const enteredRef = refInputEl?.value?.trim().toUpperCase() || '';
  const pendingRef = sessionStorage.getItem('pending-ref') || '';
  const refCode = enteredRef || pendingRef;
  const btn = document.querySelector('#register-form button[type=submit]');

  if(!email || !pw){ showError('Email ও password দিন'); return; }
  if(pw.length < 6){ showError('Password কমপক্ষে ৬ অক্ষর দিন'); return; }
  setBusy(btn, true);
  try {
    let referredByUid = null;
    if(refCode){
      referredByUid = await resolveReferrer(refCode);
      if(!referredByUid) toast('Referral code পাওয়া যায়নি — without referral এ register হলো', 'warn');
    }
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName: name });
    const trialMs = (state.trialPackage?.durationDays || 14) * 86400000;
    await setDoc(userDoc(cred.user.uid), {
      name, email,
      institution: inst,
      classLevel: klass,
      district,
      upazila,
      religion,
      prayerEnabled: true,
      prayerMethod: '1',
      prayerSchool: '0',
      apiKeys: { gemini:'', groq:'' },
      apiUsage: 0,
      plan: 'trial',
      trialStart: Date.now(),
      trialEnd: Date.now() + trialMs,
      rewardEnd: 0,
      referralCode: null,             // ensureReferralCode will fill this
      referredBy: referredByUid || null,
      referredByCode: refCode || null,
      createdAt: serverTimestamp(),
    });
    sessionStorage.removeItem('pending-ref');
    toast('Registration complete', 'success');
  } catch(e){
    showError(prettyAuthError(e));
  } finally { setBusy(btn, false); }
}

export async function logout(){
  try { await signOut(auth); toast('Logged out', 'info'); }
  catch(e){ toast('Logout failed: ' + e.message, 'error'); }
}

function setBusy(btn, busy){
  if(!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('btn-loading', busy);
}
function showError(msg){
  const el = document.getElementById('auth-error');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
}
function prettyAuthError(e){
  const c = e?.code || '';
  if(c.includes('user-not-found')) return 'এই email-এ কোন account নেই';
  if(c.includes('wrong-password') || c.includes('invalid-credential')) return 'ভুল password';
  if(c.includes('email-already-in-use')) return 'এই email আগে থেকেই registered';
  if(c.includes('weak-password')) return 'Password আরো শক্তিশালী করুন (৬+ অক্ষর)';
  if(c.includes('network')) return 'Internet নেই — Offline mode-এ login করা যাবে না';
  return e.message || 'Authentication failed';
}
