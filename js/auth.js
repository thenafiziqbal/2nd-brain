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
  sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup,
  doc, setDoc, getDoc, addDoc, collection, serverTimestamp
} from './firebase-init.js';
import { state, emit, on, TRIAL_MS, icon } from './store.js';
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
      // Section 11 — anonymous sessions are used solely for support chat.
      // Skip profile creation, referral codes, gate removal, and the full
      // app boot so an anonymous uid does NOT get to bypass registration.
      if(user.isAnonymous){
        emit('auth-anonymous', user);
        return;
      }
      // Check if user is banned
      const userSnap = await getDoc(userDoc(user.uid)).catch(() => null);
      if(userSnap?.data()?.banned){
        state.profile = null;
        gate?.classList.add('show');
        const gateErr = document.getElementById('gate-err');
        if(gateErr){
          gateErr.textContent = `আপনার অ্যাকাউন্ট ব্যান করা হয়েছে। কারণ: ${userSnap.data().banReason || 'নির্দিষ্ট করা হয়নি'}`;
          gateErr.classList.add('show');
        }
        try { await signOut(auth); } catch(e){}
        emit('auth-banned');
        return;
      }
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
    if(!state.profile.userId){
      const userId = normalizeUserId(user.email?.split('@')[0] || ('user-' + user.uid.slice(0,8))) || ('user-' + user.uid.slice(0,8));
      await setDoc(doc(db, 'user_ids', userId), { uid:user.uid, email:user.email || '', createdAt: serverTimestamp() }, { merge:true }).catch(()=>{});
      await setDoc(ref, { userId }, { merge:true }).catch(()=>{});
      state.profile.userId = userId;
    }
  } else {
    // Seed a fresh profile. The trial clock starts here.
    const trialMs = (state.trialPackage?.durationDays || 14) * 86400000;
    const profile = {
      name: user.displayName || 'Student',
      email: user.email,
      userId: normalizeUserId(user.email?.split('@')[0] || ('user-' + user.uid.slice(0,8))) || ('user-' + user.uid.slice(0,8)),
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
    try { await setDoc(doc(db, 'user_ids', profile.userId), { uid:user.uid, email:user.email || '', createdAt: serverTimestamp() }, { merge:true }); } catch(e){}
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
  document.getElementById('forgot-password-btn')?.addEventListener('click', handleForgotPassword);
  document.getElementById('change-password-btn')?.addEventListener('click', handleChangePasswordOnLoginPage);
  document.getElementById('google-login-btn')?.addEventListener('click', handleGoogleLogin);
  document.getElementById('google-register-btn')?.addEventListener('click', handleGoogleLogin);
  document.getElementById('register-form')?.addEventListener('submit', e => {
    e.preventDefault();
    handleRegister();
  });
  // Lazy-mount Cloudflare Turnstile if the admin enabled it.
  setupTurnstile();
}

function setupTurnstile(){
  const tryMount = () => {
    const enabled = state.appSettings?.turnstileEnabled;
    const site = state.appSettings?.turnstileSiteKey;
    const mount = document.getElementById('turnstile-mount');
    if(!mount) return;
    if(!enabled || !site){ mount.innerHTML = ''; return; }
    if(mount.dataset.ready === '1') return;
    mount.dataset.ready = '1';
    if(!document.querySelector('script[data-turnstile]')){
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      s.dataset.turnstile = '1';
      document.head.appendChild(s);
    }
    mount.innerHTML = `<div class="cf-turnstile" data-sitekey="${site}"></div>`;
  };
  // Try once now (in case settings already loaded), and on each settings update.
  setTimeout(tryMount, 800);
  document.addEventListener('app:system-settings', tryMount);
  // store.js's emit fires custom DOM events too via on() listeners so we
  // also subscribe with the in-memory emitter.
  on('system-settings', tryMount);
}

function switchAuth(mode){
  ['login','register'].forEach(m => {
    document.getElementById(m+'-tab')?.classList.toggle('active', m===mode);
    document.getElementById(m+'-form')?.classList.toggle('active', m===mode);
  });
  document.getElementById('auth-error')?.classList.remove('show');
}

async function handleForgotPassword(){
  const email = (document.getElementById('login-email')?.value || '').trim().toLowerCase()
    || prompt('আপনার নিজের user account email দিন (password reset link পাঠানো হবে):');
  if(!email) return;
  try {
    await addDoc(collection(db, 'password_reset_requests'), {
      email,
      status: 'sent',
      requestedAt: serverTimestamp(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      source: 'login_page',
    }).catch(()=>{});
    await sendPasswordResetEmail(auth, email);
    toast('Password reset email পাঠানো হয়েছে — inbox check করুন', 'success', 6000);
  } catch(e){
    toast('Password reset failed: ' + (e.message || prettyAuthError(e)), 'error');
  }
}

async function handleChangePasswordOnLoginPage(){
  const email = prompt('আপনার email দিন (password পরিবর্তনের জন্য):');
  if(!email) return;
  const currentPassword = prompt('বর্তমান password দিন:');
  if(!currentPassword) return;
  const newPassword = prompt('নতুন password দিন (কমপক্ষে 6 characters):');
  if(!newPassword || newPassword.length < 6){
    toast('কমপক্ষে 6 characters লাগবে', 'error');
    return;
  }
  const confirmPassword = prompt('নতুন password আবার দিন (নিশ্চিত করতে):');
  if(confirmPassword !== newPassword){
    toast('Passwords match করে না', 'error');
    return;
  }
  
  try {
    // Re-authenticate with current credentials
    const credential = EmailAuthProvider.credential(email, currentPassword);
    const userCred = await signInWithEmailAndPassword(auth, email, currentPassword);
    await reauthenticateWithCredential(userCred.user, credential);
    // Update password
    await updatePassword(userCred.user, newPassword);
    toast('Password সফলভাবে পরিবর্তন করা হয়েছে', 'success');
  } catch(e){
    if(e.code === 'auth/wrong-password'){
      toast('বর্তমান password ভুল', 'error');
    } else if(e.code === 'auth/user-not-found'){
      toast('এই email এ কোনো account নেই', 'error');
    } else {
      toast('Password পরিবর্তন ব্যর্থ: ' + prettyAuthError(e), 'error');
    }
  }
}

async function handleGoogleLogin(){
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
    toast('Google login successful', 'success');
  } catch(e){
    showError(prettyAuthError(e));
  }
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
  const userId = normalizeUserId(document.getElementById('reg-user-id')?.value || '');
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
  if(!userId){ showError('Unique User ID দিন'); return; }
  setBusy(btn, true);
  try {
    const idRef = doc(db, 'user_ids', userId);
    const idSnap = await getDoc(idRef).catch(() => null);
    if(idSnap?.exists()) throw new Error('এই User ID আগে থেকেই নেওয়া হয়েছে');
    let referredByUid = null;
    if(refCode){
      referredByUid = await resolveReferrer(refCode);
      if(!referredByUid) toast('Referral code পাওয়া যায়নি — without referral এ register হলো', 'warn');
    }
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName: name });
    const trialMs = (state.trialPackage?.durationDays || 14) * 86400000;
    await setDoc(userDoc(cred.user.uid), {
      name, email, userId,
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
    await setDoc(idRef, { uid: cred.user.uid, email, createdAt: serverTimestamp() });
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
function normalizeUserId(v){
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
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
