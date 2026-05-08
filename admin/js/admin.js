// admin.js — admin dashboard orchestrator.
// Manages: Users, Payment requests (with referral reward credit), Feature
// toggles, App settings, Branding, Packages (with per-feature access matrix),
// Trial + Free tier configs, Payment methods CRUD, Community + Social CRUD,
// Support inbox, AI cache.
import {
  auth, db, ADMIN_EMAILS,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, orderBy, where, onSnapshot, serverTimestamp
} from './admin-firebase.js';

// ----- Tiny helpers -----
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function toast(msg, type='success'){
  const el = document.createElement('div');
  el.className = 'toast-it ' + type;
  el.textContent = msg;
  $('toast-host').appendChild(el);
  setTimeout(()=>el.remove(), 3000);
}
const fmt = d => d?.toDate ? d.toDate().toLocaleString('en-BD') : (d ? new Date(d).toLocaleString('en-BD') : '—');
const REWARD_MS = 30 * 24 * 60 * 60 * 1000;
const FEATURES = [
  {k:'notes',     label:'Notes'},
  {k:'revision',  label:'Revision'},
  {k:'addNote',   label:'Add Note'},
  {k:'prayer',    label:'Prayer Times'},
  {k:'focus',     label:'Focus Timer'},
  {k:'syllabus',  label:'Syllabus + AI'},
  {k:'tasks',     label:'Tasks'},
  {k:'aiExplain', label:'AI Explain'},
  {k:'aiChat',    label:'AI Chat'},
  // Section 13 — voice features (per-package limits).
  {k:'tts',       label:'TTS (read aloud)'},
  {k:'voiceTyping', label:'Voice typing'},
  // Section 4 — YouTube playlist courses.
  {k:'courses',   label:'YouTube Courses'},
];
const SOCIAL_PLATFORMS = ['facebook','telegram','whatsapp','youtube','instagram','twitter','discord','linkedin','website'];
const COMMUNITY_PLATFORMS = ['facebook','telegram','whatsapp','discord','community'];

// ============ AUTH ============
let currentAdmin = null;
function initAuthUI(){
  // Show which admin we'll log in as so the user knows.
  const note = $('admin-login-note');
  if(note && ADMIN_EMAILS[0]) note.textContent = `Logged in as ${ADMIN_EMAILS[0]} — password দিন`;

  const tryLogin = async () => {
    const pw = $('admin-password').value;
    const err = $('gate-err');
    err.classList.remove('show');
    if(!pw){ err.textContent = 'Password দিন'; err.classList.add('show'); return; }
    try { await signInWithEmailAndPassword(auth, ADMIN_EMAILS[0], pw); }
    catch(e){
      err.textContent = e.code?.includes('wrong-password') || e.code?.includes('invalid-credential')
        ? 'ভুল password' : (e.message || 'Login failed');
      err.classList.add('show');
    }
  };
  $('admin-login-btn').addEventListener('click', tryLogin);
  $('admin-password').addEventListener('keydown', e => { if(e.key==='Enter') tryLogin(); });

  $('admin-logout-btn').addEventListener('click', async () => {
    await signOut(auth); location.reload();
  });
}
onAuthStateChanged(auth, async (user) => {
  if(!user || !ADMIN_EMAILS.includes((user.email || '').toLowerCase())){
    $('gate').classList.add('show');
    if(user){
      $('gate-err').textContent = 'You are not an admin (' + user.email + ')';
      $('gate-err').classList.add('show');
      try { await signOut(auth); } catch(e){}
    }
    return;
  }
  currentAdmin = user;
  $('gate').classList.remove('show');
  $('admin-name').textContent = user.email;
  bootDashboard();
});

// ============ NAV ============
function initNav(){
  document.querySelectorAll('[data-sec]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-sec]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
      $('sec-' + b.dataset.sec).classList.add('active');
      $('topbar-title').textContent = b.dataset.title || b.textContent.trim();
    });
  });
}

async function bootDashboard(){
  initNav();
  await Promise.allSettled([
    loadKPIs(), loadUsers(), loadFeatures(), loadAppSettings(),
    loadBranding(), loadPackages(), loadTrialAndFreeTier(),
    loadPaymentMethods(), loadCommunityAndSocial(), loadNotices(),
    watchSupport(), loadPaymentRequests(), loadQuestionsCache(),
    // Phase-2/3 social + finance modules.
    loadDashboardCharts(), loadSchools(), loadSchoolRequests(),
    loadQuizCampaigns(), loadFriendsMod(), loadFinance(),
    loadCustomFeatures(),
  ]);
  bindSocialForms();
  bindCustomFeatureForm();
}

// ============ CUSTOM FEATURES ============
let editingCustomFeatureId = null;
function bindCustomFeatureForm(){
  // Toggle field visibility based on type.
  const typeSel = $('cf-type');
  if(!typeSel) return;
  const updateGroups = () => {
    const t = typeSel.value;
    $('cf-url-group').style.display     = t === 'link'    ? '' : 'none';
    $('cf-section-group').style.display = t === 'section' ? '' : 'none';
    $('cf-html-group').style.display    = t === 'embed'   ? '' : 'none';
  };
  typeSel.addEventListener('change', updateGroups);
  updateGroups();

  $('cf-clear-btn')?.addEventListener('click', clearCustomFeatureForm);
  $('cf-save-btn')?.addEventListener('click', saveCustomFeature);
}

function clearCustomFeatureForm(){
  editingCustomFeatureId = null;
  ['cf-title','cf-sub','cf-url','cf-section','cf-html'].forEach(id => { const el = $(id); if(el) el.value = ''; });
  $('cf-icon').value = 'i-sparkles';
  $('cf-badge').value = '';
  $('cf-type').value = 'link';
  $('cf-order').value = '100';
  $('cf-active').value = 'true';
  $('cf-url-group').style.display = '';
  $('cf-section-group').style.display = 'none';
  $('cf-html-group').style.display = 'none';
  $('cf-save-btn').innerHTML = '<svg class="ico"><use href="../assets/icons.svg#i-check"/></svg> Save Feature';
}

async function saveCustomFeature(){
  const data = {
    title: $('cf-title').value.trim(),
    sub: $('cf-sub').value.trim(),
    icon: $('cf-icon').value,
    iconLink: $('cf-iconlink')?.value.trim() || null,
    badge: $('cf-badge').value || null,
    type: $('cf-type').value,
    url: $('cf-url').value.trim() || null,
    section: $('cf-section').value.trim() || null,
    html: $('cf-html').value || null,
    order: Number($('cf-order').value) || 100,
    active: $('cf-active').value === 'true',
    updatedAt: serverTimestamp(),
  };
  if(!data.title){ toast('Title দিন', 'error'); return; }
  if(data.type === 'link' && !data.url){ toast('URL দিন', 'error'); return; }
  if(data.type === 'section' && !data.section){ toast('Section ID দিন', 'error'); return; }
  if(data.type === 'embed' && !data.html){ toast('HTML / code দিন', 'error'); return; }
  try {
    if(editingCustomFeatureId){
      await setDoc(doc(db, 'admin_features', editingCustomFeatureId), data, { merge: true });
      toast('Feature updated');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'admin_features'), data);
      toast('Feature added');
    }
    clearCustomFeatureForm();
    loadCustomFeatures();
  } catch(e){ toast('Save failed: ' + e.message, 'error'); }
}

async function loadCustomFeatures(){
  const root = $('cf-list');
  if(!root) return;
  try {
    const q = query(collection(db, 'admin_features'), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    if(snap.empty){
      root.innerHTML = '<div style="font-size:.82rem;color:var(--text2);padding:14px;text-align:center;background:var(--surface2);border-radius:10px">এখনো কোনো custom feature নেই — উপরে form-এ add করুন</div>';
      return;
    }
    root.innerHTML = snap.docs.map(d => {
      const f = d.data();
      const badgeColor = f.badge === 'hot' ? '#dc2626' : f.badge === 'new' ? '#1d4ed8' : f.badge === 'upcoming' ? '#7c3aed' : 'var(--text3)';
      return `
        <div style="border:1px solid var(--border);border-radius:10px;padding:10px;background:${f.active===false?'rgba(245,158,11,.08)':'var(--surface)'}">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:.92rem;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                ${esc(f.title)}
                ${f.badge ? `<span style="font-size:.62rem;background:${badgeColor};color:#fff;padding:2px 6px;border-radius:99px;text-transform:uppercase">${esc(f.badge)}</span>` : ''}
                ${f.active===false ? '<span style="font-size:.62rem;background:#f59e0b;color:#fff;padding:2px 6px;border-radius:99px">HIDDEN</span>' : ''}
              </div>
              <div style="font-size:.78rem;color:var(--text2);margin-top:2px">${esc(f.sub || '')}</div>
              <div style="font-size:.7rem;color:var(--text3);margin-top:4px">${esc(f.type)} • order: ${f.order || 0} ${f.url?'• ' + esc(f.url):''}${f.section?'• section: ' + esc(f.section):''}</div>
            </div>
            <div style="display:flex;gap:4px;flex-direction:column">
              <button class="btn btn-secondary btn-sm" data-cf-edit="${d.id}">Edit</button>
              <button class="btn btn-danger btn-sm" data-cf-delete="${d.id}">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    root.querySelectorAll('[data-cf-edit]').forEach(b => b.addEventListener('click', () => editCustomFeature(b.dataset.cfEdit, snap.docs)));
    root.querySelectorAll('[data-cf-delete]').forEach(b => b.addEventListener('click', () => deleteCustomFeature(b.dataset.cfDelete)));
  } catch(e){
    root.innerHTML = `<div style="color:var(--danger);font-size:.82rem">Load failed: ${esc(e.message)}</div>`;
  }
}

function editCustomFeature(id, docs){
  const d = docs.find(x => x.id === id);
  if(!d) return;
  const f = d.data();
  editingCustomFeatureId = id;
  $('cf-title').value = f.title || '';
  $('cf-sub').value = f.sub || '';
  $('cf-icon').value = f.icon || 'i-sparkles';
  $('cf-badge').value = f.badge || '';
  $('cf-type').value = f.type || 'link';
  $('cf-url').value = f.url || '';
  $('cf-section').value = f.section || '';
  $('cf-html').value = f.html || '';
  $('cf-order').value = f.order || 100;
  $('cf-active').value = f.active === false ? 'false' : 'true';
  $('cf-type').dispatchEvent(new Event('change'));
  $('cf-save-btn').innerHTML = '<svg class="ico"><use href="../assets/icons.svg#i-check"/></svg> Update Feature';
  $('cf-title').scrollIntoView({ behavior:'smooth', block:'center' });
}

async function deleteCustomFeature(id){
  if(!confirm('এই feature delete করবেন?')) return;
  try { await deleteDoc(doc(db, 'admin_features', id)); toast('Deleted'); loadCustomFeatures(); }
  catch(e){ toast('Delete failed: ' + e.message, 'error'); }
}

// ============ KPIs ============
async function loadKPIs(){
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    $('kpi-users').textContent = usersSnap.size;
    let active=0, trial=0, pro=0;
    const now = Date.now();
    usersSnap.docs.forEach(d => {
      const x = d.data();
      const isPro = x.plan === 'pro' || x.plan === 'paid';
      const inTrial = x.trialEnd && x.trialEnd > now;
      if(isPro) pro++;
      if(inTrial) trial++;
      // "Active" = currently entitled (paid plan or trial still valid).
      if(isPro || inTrial) active++;
    });
    $('kpi-active').textContent = active;
    $('kpi-trial').textContent = trial;
    $('kpi-pro').textContent = pro;
  } catch(e){ console.warn(e); }
}

// ============ USERS ============
async function loadUsers(){
  const tbody = $('users-tbody');
  tbody.innerHTML = `<tr><td colspan="7" class="empty">Loading…</td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt','desc')));
    if(snap.empty){ tbody.innerHTML = `<tr><td colspan="7" class="empty">No users yet</td></tr>`; return; }
    tbody.innerHTML = snap.docs.map(d => {
      const u = d.data();
      const status = (u.plan === 'pro' || u.plan === 'paid') ? '<span class="badge green">Pro</span>'
        : u.trialEnd && u.trialEnd > Date.now() ? '<span class="badge blue">Trial</span>'
        : '<span class="badge danger">Expired</span>';
      const reward = (u.rewardEnd && u.rewardEnd > Date.now()) ? '<br><span class="badge purple">Reward</span>' : '';
      return `<tr>
        <td><strong>${esc(u.name||'—')}</strong>
          <div style="font-size:.7rem;color:var(--text3)">${esc(u.email||'')}</div>
          ${u.referralCode ? `<div style="font-size:.65rem;color:var(--text2)">Code: <code>${esc(u.referralCode)}</code></div>` : ''}
        </td>
        <td>${esc(u.institution||'—')}</td>
        <td>${esc(u.classLevel||'—')}</td>
        <td>${status}${reward}</td>
        <td><strong>${esc(u.apiUsage||0)}</strong></td>
        <td>${fmt(u.createdAt)}</td>
        <td>
          <button class="btn btn-sm btn-success" data-mark-pro="${d.id}">Mark Pro</button>
          <button class="btn btn-sm btn-warn" data-mark-trial="${d.id}">Reset Trial</button>
          <button class="btn btn-sm btn-secondary" data-pw-reset="${esc(u.email||'')}" ${u.email ? '' : 'disabled'}>Send password reset</button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-mark-pro]').forEach(b => b.addEventListener('click', () => markPlan(b.dataset.markPro,'pro')));
    tbody.querySelectorAll('[data-mark-trial]').forEach(b => b.addEventListener('click', () => resetTrial(b.dataset.markTrial)));
    tbody.querySelectorAll('[data-pw-reset]').forEach(b => b.addEventListener('click', () => sendUserPasswordReset(b.dataset.pwReset)));
  } catch(e){ tbody.innerHTML = `<tr><td colspan="7" class="empty">${e.message}</td></tr>`; }
}
async function markPlan(uid, plan){
  await updateDoc(doc(db,'users',uid), { plan });
  toast('Plan updated to ' + plan);
  loadUsers(); loadKPIs();
}
async function resetTrial(uid){
  // Use admin-configured trial duration if available.
  const trialDoc = await getDoc(doc(db,'system','trial_package')).catch(() => null);
  const days = trialDoc?.data()?.durationDays || 14;
  const ms = days*86400000;
  await updateDoc(doc(db,'users',uid), { plan:'trial', trialStart: Date.now(), trialEnd: Date.now()+ms });
  toast(`Trial reset (${days} days)`);
  loadUsers(); loadKPIs();
}
async function sendUserPasswordReset(email){
  if(!email){ toast('User has no email on file', 'error'); return; }
  if(!confirm(`Send password reset link to ${email}?`)) return;
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Password reset email sent to ' + email);
  } catch(e){ toast('Failed: ' + e.message, 'error'); }
}

// ============ FEATURE TOGGLES ============
async function loadFeatures(){
  const root = $('features-list');
  const ref = doc(db, 'system','settings');
  let snap;
  try { snap = await getDoc(ref); } catch(e){ snap = null; }
  const cur = (snap?.data()?.features) || Object.fromEntries(FEATURES.map(f => [f.k, true]));
  root.innerHTML = FEATURES.map(f => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;border-bottom:1px solid var(--border)">
      <div><div style="font-weight:700">${esc(f.label)}</div></div>
      <label class="tgl"><input type="checkbox" data-feat="${f.k}" ${cur[f.k]!==false?'checked':''}/><span class="tgl-sl"></span></label>
    </div>`).join('');
  root.querySelectorAll('[data-feat]').forEach(c => c.addEventListener('change', async () => {
    const next = {};
    root.querySelectorAll('[data-feat]').forEach(x => next[x.dataset.feat] = x.checked);
    try { await setDoc(ref, { features: next }, { merge:true }); toast('Features updated'); }
    catch(e){ toast('Failed: ' + e.message,'error'); }
  }));
}

// ============ APP SETTINGS ============
async function loadAppSettings(){
  const ref = doc(db,'system','settings');
  const privateRef = doc(db,'system_private','settings');
  let snap; try { snap = await getDoc(ref); } catch(e){ snap = null; }
  let privateSnap; try { privateSnap = await getDoc(privateRef); } catch(e){ privateSnap = null; }
  const d = snap?.data() || {};
  const privateSettings = privateSnap?.data() || {};
  $('as-name').value = d.appName || 'Second Brain';
  $('as-tagline').value = d.appTagline || '';
  $('as-rev').value = d.revisionDelay || 24;
  if($('as-rev-duration')) $('as-rev-duration').value = d.revisionDuration || 60;
  if($('as-rev-notif-require-req')) $('as-rev-notif-require-req').value = d.revisionNotifRequireRequest !== false ? 'true' : 'false';
  $('as-groq-key').value = privateSettings.groqKey || '';
  $('as-imgbb-key').value = privateSettings.imgbbKey || '';
  $('as-groq-model').value = d.groqModel || 'llama-3.1-8b-instant';
  if($('as-gemini-model')) $('as-gemini-model').value = d.geminiModel || 'gemini-2.5-flash';
  if($('as-gemini-vision-model')) $('as-gemini-vision-model').value = d.geminiVisionModel || 'gemini-2.5-flash';
  if($('as-youtube-key')) $('as-youtube-key').value = privateSettings.youtubeApiKey || '';
  if($('as-tutorial-url')) $('as-tutorial-url').value = d.tutorialVideoUrl || '';
  $('as-sys-notes').value = d.sysNotes || '';
  $('as-sys-chat').value = d.sysChat || '';
  // Section 5 — SEO + Cloudflare Turnstile + class management.
  if($('as-seo-title')) $('as-seo-title').value = d.seoTitle || '';
  if($('as-seo-desc')) $('as-seo-desc').value = d.seoDescription || '';
  if($('as-seo-og')) $('as-seo-og').value = d.seoOgImage || '';
  if($('as-seo-keywords')) $('as-seo-keywords').value = d.seoKeywords || '';
  if($('as-turnstile-site')) $('as-turnstile-site').value = d.turnstileSiteKey || '';
  if($('as-turnstile-enable')) $('as-turnstile-enable').value = d.turnstileEnabled ? 'true' : 'false';
  if($('as-classes')) $('as-classes').value = (d.classLevels || []).join(', ');
  if($('as-turnstile-secret')) $('as-turnstile-secret').value = privateSettings.turnstileSecret || '';
  // Section 9 — referral-eligible packages picker. Painted from current
  // /packages collection so the admin can tick which ones reward referrers.
  await paintReferralPackagePicker(d.referralRewardPackages || []);
  $('as-save-btn').addEventListener('click', async () => {
    await setDoc(ref, {
      appName: $('as-name').value.trim(),
      appTagline: $('as-tagline').value.trim(),
      revisionDelay: parseInt($('as-rev').value) || 24,
      revisionDuration: parseInt($('as-rev-duration')?.value) || 60,
      revisionNotifRequireRequest: $('as-rev-notif-require-req')?.value === 'true',
      // Sensitive keys go to /system_private (admin only) and to
      // /system_client (signed-in only). They MUST NOT be in /system because
      // that doc is publicly readable by Firestore rules.
      groqKey: null,
      imgbbKey: null,
      youtubeApiKey: null,
      groqModel: $('as-groq-model').value.trim() || 'llama-3.1-8b-instant',
      geminiModel: $('as-gemini-model')?.value.trim() || 'gemini-2.5-flash',
      geminiVisionModel: $('as-gemini-vision-model')?.value.trim() || 'gemini-2.5-flash',
      youtubeApiKeyAvailable: !!($('as-youtube-key')?.value.trim()),
      tutorialVideoUrl: $('as-tutorial-url')?.value.trim() || '',
      sysNotes: $('as-sys-notes').value,
      sysChat: $('as-sys-chat').value,
      // SEO
      seoTitle: $('as-seo-title')?.value.trim() || '',
      seoDescription: $('as-seo-desc')?.value.trim() || '',
      seoOgImage: $('as-seo-og')?.value.trim() || '',
      seoKeywords: $('as-seo-keywords')?.value.trim() || '',
      // Cloudflare Turnstile (public key only here; secret is in private doc)
      turnstileSiteKey: $('as-turnstile-site')?.value.trim() || '',
      turnstileEnabled: ($('as-turnstile-enable')?.value || 'false') === 'true',
      // Classes for registration dropdown
      classLevels: ($('as-classes')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
      // Section 9 — referral-eligible package IDs (empty array = any package).
      referralRewardPackages: collectReferralPackagePicks(),
      updatedAt: serverTimestamp(),
    }, { merge:true });
    await setDoc(privateRef, {
      groqKey: $('as-groq-key').value.trim(),
      imgbbKey: $('as-imgbb-key').value.trim(),
      turnstileSecret: $('as-turnstile-secret')?.value.trim() || '',
      youtubeApiKey: $('as-youtube-key')?.value.trim() || '',
      updatedAt: serverTimestamp(),
    }, { merge:true });
    // Section 4 / 15 — keys the signed-in user app needs (imgbb upload,
    // YouTube Data API). Stored in /system_client/keys which is signed-in
    // readable but NOT public.
    await setDoc(doc(db,'system_client','keys'), {
      imgbbKey: $('as-imgbb-key').value.trim(),
      youtubeApiKey: $('as-youtube-key')?.value.trim() || '',
      updatedAt: serverTimestamp(),
    }, { merge:true });
    toast('App settings saved');
  });
}

// Section 9 — paint a checkbox list of available packages so the admin
// can decide which ones reward referrers on purchase.
async function paintReferralPackagePicker(selected = []){
  const root = $('as-referral-pkg-list');
  if(!root) return;
  let snap; try { snap = await getDocs(collection(db,'packages')); } catch(e){ snap = null; }
  const pkgs = snap?.docs?.map(d => ({ id:d.id, ...d.data() })) || [];
  if(!pkgs.length){
    root.innerHTML = '<span style="color:var(--text2);font-size:.85rem">No packages defined — add packages first.</span>';
    return;
  }
  const set = new Set(selected);
  root.innerHTML = pkgs.map(p => `
    <label style="display:flex;gap:6px;align-items:center;background:var(--surface2);padding:4px 8px;border-radius:8px;border:1px solid var(--border);cursor:pointer">
      <input type="checkbox" data-ref-pkg="${esc(p.id)}" ${set.has(p.id)?'checked':''}/>
      ${esc(p.title || p.id)}
      <small style="color:var(--text2)">৳${esc(p.price || '?')}</small>
    </label>`).join('');
}
function collectReferralPackagePicks(){
  const root = $('as-referral-pkg-list');
  if(!root) return [];
  return [...root.querySelectorAll('[data-ref-pkg]:checked')].map(el => el.dataset.refPkg);
}

// ============ BRANDING ============
async function loadBranding(){
  const ref = doc(db,'system','branding');
  let snap; try { snap = await getDoc(ref); } catch(e){ snap = null; }
  const d = snap?.data() || {};
  $('br-name').value = d.appName || '';
  $('br-tagline').value = d.appTagline || '';
  $('br-logo').value = d.logoUrl || '';
  $('br-favicon').value = d.faviconUrl || '';
  refreshBrandingPreview();
  ['br-name','br-tagline','br-logo','br-favicon'].forEach(id => $(id).addEventListener('input', refreshBrandingPreview));
  $('br-save-btn').addEventListener('click', async () => {
    await setDoc(ref, {
      appName: $('br-name').value.trim(),
      appTagline: $('br-tagline').value.trim(),
      logoUrl: $('br-logo').value.trim(),
      faviconUrl: $('br-favicon').value.trim(),
      updatedAt: serverTimestamp(),
    }, { merge:true });
    toast('Branding saved — user panel এ live update হবে');
  });
}
function refreshBrandingPreview(){
  const logoUrl = $('br-logo').value.trim();
  const faviconUrl = $('br-favicon').value.trim();
  $('br-logo-preview').innerHTML = logoUrl
    ? `<img src="${esc(logoUrl)}" style="width:100%;height:100%;object-fit:contain"/>`
    : `<svg class="ico lg"><use href="../assets/icons.svg#i-image"/></svg>`;
  $('br-favicon-preview').innerHTML = faviconUrl
    ? `<img src="${esc(faviconUrl)}" style="width:100%;height:100%;object-fit:contain"/>`
    : '';
}

// ============ PACKAGES (with feature matrix) ============
async function loadPackages(){
  const root = $('pkg-list');
  const refresh = async () => {
    const snap = await getDocs(collection(db,'packages'));
    if(snap.empty){ root.innerHTML = `<div class="empty">No packages yet — Add one</div>`; return; }
    root.innerHTML = snap.docs.map(d => packageEditor(d.id, d.data())).join('');
    bindPackageEditors(root, refresh);
  };
  refresh();
  $('pkg-add-btn').addEventListener('click', async () => {
    const features = Object.fromEntries(FEATURES.map(f => [f.k, true]));
    await addDoc(collection(db,'packages'), {
      title:'New Package', price:'120', duration:'month', durationDays:30,
      description:'', features, limits:{}, active:true, popular:false,
      sortOrder:0, createdAt: serverTimestamp(),
    });
    refresh();
  });
}

function packageEditor(id, p){
  return `<div class="card pkg-edit" data-pkg-id="${esc(id)}">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div class="form-group"><label>Title</label><input data-f="title" value="${esc(p.title||'')}"/></div>
      <div class="form-group"><label>Price (BDT)</label><input data-f="price" value="${esc(p.price||'')}"/></div>
      <div class="form-group"><label>Duration label</label><input data-f="duration" value="${esc(p.duration||'month')}"/></div>
      <div class="form-group"><label>Duration days</label><input data-f="durationDays" type="number" value="${esc(p.durationDays||30)}"/></div>
      <div class="form-group"><label>Sort order</label><input data-f="sortOrder" type="number" value="${esc(p.sortOrder||0)}"/></div>
      <div class="form-group"><label>Description</label><input data-f="description" value="${esc(p.description||'')}"/></div>
    </div>
    <div style="display:flex;gap:14px;align-items:center;margin:8px 0">
      <label class="tgl"><input type="checkbox" data-f="active" ${p.active?'checked':''}/><span class="tgl-sl"></span></label> Active
      <label class="tgl"><input type="checkbox" data-f="popular" ${p.popular?'checked':''}/><span class="tgl-sl"></span></label> Popular badge
    </div>
    <div class="feature-matrix">${featureMatrixHtml(p.features||{}, p.limits||{})}</div>
    <div style="margin-top:8px;display:flex;gap:6px">
      <button class="btn btn-success btn-sm" data-pkg-save="${esc(id)}">Save</button>
      <button class="btn btn-danger btn-sm" data-pkg-del="${esc(id)}">Delete</button>
    </div>
  </div>`;
}

function featureMatrixHtml(features = {}, limits = {}){
  return `<table class="fm-table"><thead><tr><th>Feature</th><th>Enabled</th><th>Daily limit (blank = unlimited)</th></tr></thead><tbody>
    ${FEATURES.map(f => `
      <tr>
        <td>${esc(f.label)}</td>
        <td><label class="tgl"><input type="checkbox" data-fm="feat:${f.k}" ${features[f.k]!==false?'checked':''}/><span class="tgl-sl"></span></label></td>
        <td><input type="number" min="0" data-fm="limit:${f.k}" value="${limits[f.k]??''}" placeholder="∞" style="width:120px"/></td>
      </tr>`).join('')}
  </tbody></table>`;
}

function readFeatureMatrix(root){
  const features = {};
  const limits = {};
  root.querySelectorAll('[data-fm^="feat:"]').forEach(c => {
    const k = c.dataset.fm.split(':')[1];
    features[k] = c.checked;
  });
  root.querySelectorAll('[data-fm^="limit:"]').forEach(i => {
    const k = i.dataset.fm.split(':')[1];
    if(i.value !== '') limits[k] = parseInt(i.value);
  });
  return { features, limits };
}

function bindPackageEditors(root, refresh){
  root.querySelectorAll('[data-pkg-save]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.pkgSave;
      const card = b.closest('.pkg-edit');
      const data = collectFields(card);
      const { features, limits } = readFeatureMatrix(card);
      data.features = features; data.limits = limits;
      data.durationDays = parseInt(data.durationDays) || 30;
      data.sortOrder = parseInt(data.sortOrder) || 0;
      data.active = !!data.active; data.popular = !!data.popular;
      await updateDoc(doc(db,'packages',id), { ...data, updatedAt: serverTimestamp() });
      toast('Package saved');
    });
  });
  root.querySelectorAll('[data-pkg-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if(!confirm('Delete this package?')) return;
      await deleteDoc(doc(db,'packages', b.dataset.pkgDel));
      toast('Deleted'); refresh();
    });
  });
}

function collectFields(root){
  const out = {};
  root.querySelectorAll('[data-f]').forEach(el => {
    const k = el.dataset.f;
    out[k] = (el.type === 'checkbox') ? el.checked : el.value;
  });
  // Map the dual color picker (`color` + `color-text`) into a single field —
  // keep whichever input was edited last, prefer the typed hex if it's set.
  if(out['color-text']) out.color = out['color-text'];
  delete out['color-text'];
  return out;
}

// ============ TRIAL + FREE TIER ============
async function loadTrialAndFreeTier(){
  // Trial
  const trRef = doc(db,'system','trial_package');
  let trSnap; try { trSnap = await getDoc(trRef); } catch(e){ trSnap = null; }
  const tr = trSnap?.data() || { title:'Free Trial', durationDays:14, features:Object.fromEntries(FEATURES.map(f=>[f.k,true])), limits:{} };
  $('tr-title').value = tr.title || 'Free Trial';
  $('tr-days').value = tr.durationDays || 14;
  $('tr-features').innerHTML = featureMatrixHtml(tr.features||{}, tr.limits||{});
  $('tr-save-btn').addEventListener('click', async () => {
    const { features, limits } = readFeatureMatrix($('tr-features'));
    await setDoc(trRef, {
      title: $('tr-title').value.trim() || 'Free Trial',
      durationDays: parseInt($('tr-days').value) || 14,
      features, limits, updatedAt: serverTimestamp(),
    }, { merge:true });
    toast('Trial settings saved');
  });

  // Free tier
  const ftRef = doc(db,'system','free_tier');
  let ftSnap; try { ftSnap = await getDoc(ftRef); } catch(e){ ftSnap = null; }
  const ft = ftSnap?.data() || { features:Object.fromEntries(FEATURES.map(f=>[f.k,false])), limits:{} };
  $('ft-features').innerHTML = featureMatrixHtml(ft.features||{}, ft.limits||{});
  $('ft-save-btn').addEventListener('click', async () => {
    const { features, limits } = readFeatureMatrix($('ft-features'));
    await setDoc(ftRef, { features, limits, updatedAt: serverTimestamp() }, { merge:true });
    toast('Free tier saved');
  });
}

// ============ PAYMENT METHODS ============
async function loadPaymentMethods(){
  const ref = doc(db,'system','payment_methods');
  const root = $('pm-list');
  let items = [];

  const render = () => {
    if(!items.length){ root.innerHTML = `<div class="empty">No payment methods yet</div>`; return; }
    root.innerHTML = items.map((m,i) => `
      <div class="card pm-edit" data-i="${i}">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          <div class="form-group"><label>Display name</label><input data-f="name" value="${esc(m.name||'')}" placeholder="bKash"/></div>
          <div class="form-group"><label>Platform key</label><input data-f="id" value="${esc(m.id||'')}" placeholder="bkash"/></div>
          <div class="form-group"><label>Number / account</label><input data-f="number" value="${esc(m.number||'')}" placeholder="017XXXXXXXX"/></div>
          <div class="form-group"><label>Logo URL</label><input data-f="logoUrl" value="${esc(m.logoUrl||'')}" placeholder="https://..."/></div>
          <div class="form-group"><label>Brand color (matches user-panel checkout accent)</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="color" data-f="color" value="${esc(m.color||'#3b82f6')}" style="width:48px;height:34px;padding:0;border-radius:6px"/>
              <input type="text" data-f="color-text" value="${esc(m.color||'')}" placeholder="#e2136e" style="flex:1"/>
            </div>
          </div>
          <div class="form-group"><label>Payment link (optional)</label><input data-f="link" value="${esc(m.link||'')}"/></div>
          <div class="form-group" style="grid-column:span 2"><label>Instructions</label><input data-f="instructions" value="${esc(m.instructions||'')}" placeholder="Send money option ব্যবহার করুন"/></div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;margin-top:6px">
          <label class="tgl"><input type="checkbox" data-f="enabled" ${m.enabled!==false?'checked':''}/><span class="tgl-sl"></span></label> Enabled
          <button class="btn btn-danger btn-sm" data-pm-del="${i}">Delete</button>
        </div>
      </div>`).join('');
    root.querySelectorAll('.pm-edit').forEach((card, i) => {
      card.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener('change', () => {
          items[i] = { ...items[i], ...collectFields(card), enabled: card.querySelector('[data-f="enabled"]').checked };
        });
      });
    });
    root.querySelectorAll('[data-pm-del]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.pmDel;
      items.splice(i,1); render(); save();
    }));
  };

  const save = async () => {
    // Pull latest values from DOM before save.
    root.querySelectorAll('.pm-edit').forEach((card,i) => {
      items[i] = { ...items[i], ...collectFields(card), enabled: card.querySelector('[data-f="enabled"]').checked };
    });
    await setDoc(ref, { items, updatedAt: serverTimestamp() }, { merge:true });
    toast('Payment methods saved');
  };

  let snap; try { snap = await getDoc(ref); } catch(e){ snap = null; }
  items = snap?.data()?.items || [];
  render();

  $('pm-add-btn').addEventListener('click', () => {
    items.push({ id:'method'+(items.length+1), name:'New Method', number:'', link:'', logoUrl:'', color:'', instructions:'', enabled:true });
    render();
  });

  // Save on any blur.
  document.getElementById('sec-paymethods').addEventListener('blur', () => save(), true);
}

// ============ COMMUNITY + SOCIAL ============
async function loadCommunityAndSocial(){
  await loadList(
    'cm', 'community',
    (m,i) => `<div style="display:grid;grid-template-columns:1fr 2fr 1fr auto;gap:8px;align-items:center">
      <input data-f="name" value="${esc(m.name||'')}" placeholder="Name"/>
      <input data-f="url" value="${esc(m.url||'')}" placeholder="https://..."/>
      <select data-f="platform">${COMMUNITY_PLATFORMS.map(p => `<option ${m.platform===p?'selected':''} value="${p}">${p}</option>`).join('')}</select>
      <button class="btn btn-danger btn-sm" data-li-del="${i}">Delete</button>
    </div>`,
    () => ({ name:'Community Group', url:'', platform:'facebook' })
  );
  await loadList(
    'so', 'social',
    (m,i) => `<div style="display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:center">
      <select data-f="platform">${SOCIAL_PLATFORMS.map(p => `<option ${m.platform===p?'selected':''} value="${p}">${p}</option>`).join('')}</select>
      <input data-f="url" value="${esc(m.url||'')}" placeholder="https://..."/>
      <button class="btn btn-danger btn-sm" data-li-del="${i}">Delete</button>
    </div>`,
    () => ({ platform:'facebook', url:'' })
  );
}

// ============ NOTICES ============
async function loadNotices(){
  await loadList(
    'nt', 'notices',
    (m, i) => `<div style="display:grid;gap:8px">
      <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr auto;gap:8px;align-items:center">
        <input data-f="title" value="${esc(m.title||'')}" placeholder="Title (e.g. New feature: Voice Notes)"/>
        <select data-f="tone">
          ${['info','success','warn','promo'].map(t => `<option ${m.tone===t?'selected':''} value="${t}">${t}</option>`).join('')}
        </select>
        <select data-f="type">
          ${['banner','popup'].map(t => `<option ${m.type===t?'selected':''} value="${t}">${t}</option>`).join('')}
        </select>
        <label class="switch"><input type="checkbox" data-f="active" ${m.active!==false?'checked':''}/><span class="sl"></span></label>
      </div>
      <textarea data-f="body" placeholder="Notice body" rows="2">${esc(m.body||'')}</textarea>
      <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:8px;align-items:center">
        <input data-f="link" value="${esc(m.link||'')}" placeholder="Optional link (https://...)"/>
        <input data-f="linkLabel" value="${esc(m.linkLabel||'')}" placeholder="Link button label"/>
        <button class="btn btn-danger btn-sm" data-li-del="${i}">Delete</button>
      </div>
      <fieldset style="border:1px dashed var(--border);padding:8px 10px;border-radius:8px">
        <legend style="font-size:.78rem;color:var(--text2);padding:0 6px">Scheduling (push notification)</legend>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label style="font-size:.78rem">Start at (date+time)
            <input type="datetime-local" data-f="startAt" value="${esc(toDateTimeLocal(m.startAt))}"/>
          </label>
          <label style="font-size:.78rem">End at (date+time)
            <input type="datetime-local" data-f="endAt" value="${esc(toDateTimeLocal(m.endAt))}"/>
          </label>
          <label style="font-size:.78rem">Daily window — start hour (0-23)
            <input type="number" min="0" max="23" data-f="dailyStartHour" value="${m.dailyStartHour ?? ''}" placeholder="e.g. 10"/>
          </label>
          <label style="font-size:.78rem">Daily window — end hour (0-23)
            <input type="number" min="0" max="23" data-f="dailyEndHour" value="${m.dailyEndHour ?? ''}" placeholder="e.g. 20"/>
          </label>
          <label style="font-size:.78rem">Repeat limit (per device)
            <input type="number" min="1" max="50" data-f="repeatLimit" value="${m.repeatLimit ?? 1}"/>
          </label>
          <label style="font-size:.78rem">Repeat interval (minutes)
            <input type="number" min="0" data-f="intervalMinutes" value="${m.intervalMinutes ?? 0}" placeholder="0 = one-shot"/>
          </label>
          <label style="font-size:.78rem;grid-column:1/-1">Auto-delete at (date+time — banner removed locally after this)
            <input type="datetime-local" data-f="autoDeleteAt" value="${esc(toDateTimeLocal(m.autoDeleteAt))}"/>
          </label>
        </div>
      </fieldset>
    </div>`,
    () => ({
      id: 'n-' + Date.now().toString(36),
      title:'New notice', body:'', tone:'info', type:'banner', active:true, link:'', linkLabel:'',
      startAt:'', endAt:'', dailyStartHour:'', dailyEndHour:'', repeatLimit:1, intervalMinutes:0, autoDeleteAt:'',
    }),
    normalizeNotice
  );
}

function toDateTimeLocal(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  // YYYY-MM-DDTHH:MM
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeNotice(m){
  // Convert datetime-local strings to ISO; coerce numeric fields.
  const out = { ...m };
  ['startAt','endAt','autoDeleteAt'].forEach(k => {
    if(out[k]){ const d = new Date(out[k]); out[k] = isNaN(d.getTime()) ? '' : d.toISOString(); }
    else out[k] = '';
  });
  ['dailyStartHour','dailyEndHour'].forEach(k => {
    if(out[k] === '' || out[k] === null || out[k] === undefined) out[k] = null;
    else out[k] = Math.max(0, Math.min(23, parseInt(out[k], 10) || 0));
  });
  out.repeatLimit = Math.max(1, parseInt(out.repeatLimit, 10) || 1);
  out.intervalMinutes = Math.max(0, parseInt(out.intervalMinutes, 10) || 0);
  return out;
}

async function loadList(prefix, docName, rowFn, freshFn, normalizeFn){
  const root = $(prefix + '-list');
  const ref = doc(db,'system', docName);
  let items = [];
  const render = () => {
    if(!items.length){ root.innerHTML = `<div class="empty">No items</div>`; return; }
    root.innerHTML = items.map((m,i) => `<div class="card li-row" data-i="${i}">${rowFn(m,i)}</div>`).join('');
    root.querySelectorAll('.li-row').forEach((row,i) => {
      row.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener('change', () => {
          let next = { ...items[i], ...collectFields(row) };
          if(typeof normalizeFn === 'function') next = normalizeFn(next);
          items[i] = next;
          save();
        });
      });
    });
    root.querySelectorAll('[data-li-del]').forEach(b => b.addEventListener('click', () => {
      items.splice(+b.dataset.liDel, 1); render(); save();
    }));
  };
  const save = async () => {
    await setDoc(ref, { items, updatedAt: serverTimestamp() }, { merge:true });
    toast('Saved');
  };
  let snap; try { snap = await getDoc(ref); } catch(e){ snap = null; }
  items = snap?.data()?.items || [];
  render();
  $(prefix + '-add-btn').addEventListener('click', () => { items.push(freshFn()); render(); save(); });
}

// ============ SUPPORT CHAT ============
let activeUid = null;
let unsubThread = null;
function watchSupport(){
  const q = query(collection(db,'support_chats'), orderBy('createdAt','desc'));
  onSnapshot(q, snap => {
    const grouped = new Map();
    snap.docs.forEach(d => {
      const m = d.data();
      if(!grouped.has(m.uid)) grouped.set(m.uid, { name: m.name || m.uid, last: m.text, when: m.createdAt });
    });
    const root = $('chat-list');
    if(!grouped.size){ root.innerHTML = `<div class="empty">No conversations</div>`; return; }
    root.innerHTML = [...grouped.entries()].map(([uid, info]) => `
      <div class="user-pill ${uid===activeUid?'active':''}" data-pick="${uid}">
        <div class="name">${esc(info.name)}</div>
        <div class="last">${esc(info.last)}</div>
      </div>`).join('');
    root.querySelectorAll('[data-pick]').forEach(p => p.addEventListener('click', () => pickThread(p.dataset.pick)));
    if(!activeUid){ const first = grouped.keys().next().value; if(first) pickThread(first); }
  });
}
function pickThread(uid){
  activeUid = uid;
  document.querySelectorAll('.user-pill').forEach(x => x.classList.toggle('active', x.dataset.pick === uid));
  $('thread-header').textContent = 'Conversation with ' + uid.slice(0,8) + '…';
  if(unsubThread) unsubThread();
  const q = query(collection(db,'support_chats'), where('uid','==',uid), orderBy('createdAt','asc'));
  unsubThread = onSnapshot(q, snap => {
    const body = $('thread-body');
    body.innerHTML = snap.docs.map(d => {
      const m = d.data();
      return `<div class="msg ${m.from==='admin'?'admin':'user'}">${esc(m.text)}<div style="font-size:.65rem;opacity:.7;margin-top:3px">${fmt(m.createdAt)}</div></div>`;
    }).join('');
    body.scrollTop = body.scrollHeight;
  });
}
$('thread-send-btn')?.addEventListener('click', async () => {
  if(!activeUid) return toast('Select a conversation','error');
  const text = $('thread-input').value.trim();
  if(!text) return;
  await addDoc(collection(db,'support_chats'), {
    uid: activeUid, name: 'Admin', from: 'admin', text, read: false, createdAt: serverTimestamp(),
  });
  $('thread-input').value = '';
});
$('thread-input')?.addEventListener('keydown', e => { if(e.key === 'Enter') $('thread-send-btn').click(); });

// ============ PAYMENT REQUESTS (with referral reward) ============
async function loadPaymentRequests(){
  const tb = $('pay-tbody');
  const q = query(collection(db,'payment_requests'), orderBy('createdAt','desc'));
  onSnapshot(q, snap => {
    if(snap.empty){ tb.innerHTML = `<tr><td colspan="7" class="empty">No requests</td></tr>`; return; }
    tb.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const status = p.status === 'approved' ? '<span class="badge green">Approved</span>'
        : p.status === 'rejected' ? '<span class="badge danger">Rejected</span>'
        : '<span class="badge warn">Pending</span>';
      const ref = p.referredBy ? `<br><span class="badge purple">Has referrer</span>` : '';
      return `<tr>
        <td>${esc(p.name||p.email)}${ref}</td>
        <td>${esc(p.packageTitle || p.plan || '')}<br><small>৳ ${esc(p.packagePrice || '')}</small></td>
        <td>${esc(p.methodName || p.method || '')}</td>
        <td>${esc(p.trxId)}</td>
        <td>${esc(p.sender)}</td>
        <td>${status}</td>
        <td>${p.status==='pending' ? `
          <button class="btn btn-sm btn-success" data-pay-ok="${d.id}">Approve</button>
          <button class="btn btn-sm btn-danger" data-pay-no="${d.id}">Reject</button>` : fmt(p.createdAt)}
        </td>
      </tr>`;
    }).join('');
    tb.querySelectorAll('[data-pay-ok]').forEach(b => b.addEventListener('click', async () => {
      const reqId = b.dataset.payOk;
      const reqDoc = await getDoc(doc(db,'payment_requests', reqId));
      if(!reqDoc.exists()) return;
      const p = reqDoc.data();
      const days = p.packageDurationDays || 30;
      const now = Date.now();
      const planEnd = now + days * 86400000;
      // 1) Mark this user pro + extend their plan window.
      await updateDoc(doc(db,'users', p.uid), {
        plan: 'pro',
        packageId: p.packageId || null,
        planEnd,
      });
      // 2) Mark request approved.
      await updateDoc(doc(db,'payment_requests', reqId), { status:'approved', approvedAt: serverTimestamp() });

      // 3) If this user was referred AND the purchased package is on the
      //    admin-configured referral-eligible list (Section 9), credit the
      //    referrer with 30 days reward and bump /referrals/{code}.used.
      let referralCredited = false;
      if(p.referredBy){
        try {
          const sysSnap = await getDoc(doc(db,'system','settings')).catch(()=>null);
          const eligible = sysSnap?.data()?.referralRewardPackages;
          // No explicit list → reward on every package (back-compat).
          const ok = !Array.isArray(eligible) || !eligible.length
            || (p.packageId && eligible.includes(p.packageId));
          if(ok){
            const refUserDoc = await getDoc(doc(db,'users', p.referredBy));
            if(refUserDoc.exists()){
              const cur = refUserDoc.data();
              const baseline = Math.max(now, cur.rewardEnd || 0, cur.trialEnd || 0);
              await updateDoc(doc(db,'users', p.referredBy), {
                rewardEnd: baseline + REWARD_MS,
              });
              referralCredited = true;
              if(cur.referralCode){
                try {
                  const r = await getDoc(doc(db,'referrals', cur.referralCode));
                  const used = (r.exists() ? r.data().used : 0) + 1;
                  await setDoc(doc(db,'referrals', cur.referralCode), { used }, { merge:true });
                } catch(e){}
              }
            }
          }
        } catch(e){ console.warn('referral credit failed', e); }
      }
      toast('Approved → user upgraded' + (referralCredited ? ' + referrer credited' : ''));
    }));
    tb.querySelectorAll('[data-pay-no]').forEach(b => b.addEventListener('click', async () => {
      await updateDoc(doc(db,'payment_requests', b.dataset.payNo), { status:'rejected' });
      toast('Rejected','error');
    }));
  });
}

// ============ AI QUESTIONS CACHE ============
async function loadQuestionsCache(){
  const root = $('cache-tbody');
  try {
    const snap = await getDocs(query(collection(db,'syllabus_questions'), orderBy('updatedAt','desc')));
    if(snap.empty){ root.innerHTML = `<tr><td colspan="5" class="empty">No cache yet</td></tr>`; return; }
    root.innerHTML = snap.docs.map(d => {
      const q = d.data();
      const revs = (q.revisions||[]).length;
      return `<tr>
        <td>${esc(q.class||'—')}</td>
        <td>${esc(q.subject||'—')}</td>
        <td>${esc(q.chapter||'—')}</td>
        <td>${revs}</td>
        <td><button class="btn btn-sm btn-danger" data-cache-del="${d.id}">Clear cache</button></td>
      </tr>`;
    }).join('');
    root.querySelectorAll('[data-cache-del]').forEach(b => b.addEventListener('click', async () => {
      await deleteDoc(doc(db,'syllabus_questions', b.dataset.cacheDel));
      toast('Cache cleared'); loadQuestionsCache();
    }));
  } catch(e){ root.innerHTML = `<tr><td colspan="5" class="empty">${e.message}</td></tr>`; }
}

// ============================================================================
// Phase 2/3 — Dashboard charts, schools, quiz campaigns, friends/DM moderation,
// finance overview. All use Chart.js loaded from admin.html.
// ============================================================================

const dayKey = (d) => new Date(d).toISOString().slice(0,10);
const monthKey = (d) => new Date(d).toISOString().slice(0,7);

async function loadDashboardCharts(){
  if(typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
  await Promise.allSettled([
    renderActiveUsersChart(),
    renderRevenueChart(),
    renderApiUsageChart(),
    renderPackageChart(),
  ]);
}

async function renderActiveUsersChart(){
  // Pull global study_logs (created when user finishes a focus session).
  const labels = [];
  const counts = {};
  const now = new Date();
  for(let i=29; i>=0; i--){
    const d = new Date(now); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    labels.push(k.slice(5));
    counts[k] = new Set();
  }
  try {
    const snap = await getDocs(query(collection(db,'study_logs'), orderBy('createdAt','desc')));
    snap.docs.forEach(doc => {
      const x = doc.data();
      const t = x.createdAt?.toMillis?.() || (x.createdAt?.seconds ? x.createdAt.seconds*1000 : Date.now());
      const k = dayKey(t);
      if(counts[k]) counts[k].add(x.uid);
    });
  } catch(e){ console.warn(e); }
  const data = labels.map((_, i) => {
    const k = dayKey(new Date(now.getTime() - (29-i)*86400000));
    return counts[k]?.size || 0;
  });
  const ctx = $('chart-dau');
  if(!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Daily Active', data, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,.15)', tension:.35, fill:true }] },
    options: { plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{precision:0}}} }
  });
}

async function renderRevenueChart(){
  const labels = []; const data = {};
  const now = new Date();
  for(let i=11; i>=0; i--){
    const d = new Date(now); d.setMonth(d.getMonth() - i);
    const k = monthKey(d);
    labels.push(k); data[k] = 0;
  }
  try {
    const snap = await getDocs(collection(db,'payment_requests'));
    snap.docs.forEach(doc => {
      const x = doc.data();
      if(x.status !== 'approved') return;
      const t = x.approvedAt?.toMillis?.() || x.createdAt?.toMillis?.() || Date.now();
      const k = monthKey(t);
      if(data[k] != null) data[k] += Number(x.amount || 0);
    });
  } catch(e){ console.warn(e); }
  const ctx = $('chart-revenue'); if(!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Revenue (৳)', data: labels.map(k => data[k]), backgroundColor:'#10b981' }] },
    options: { plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
  });
}

async function renderApiUsageChart(){
  // Sum apiUsage across all users — quick approximation. Per-day data
  // would require a write hook; for now we show top users.
  try {
    const snap = await getDocs(query(collection(db,'users'), orderBy('apiUsage','desc')));
    const top = snap.docs.slice(0, 10).map(d => d.data());
    const ctx = $('chart-api'); if(!ctx) return;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top.map(u => (u.name || u.email || '').slice(0, 12)),
        datasets: [{ label:'AI calls', data: top.map(u => Number(u.apiUsage||0)), backgroundColor:'#7c3aed' }]
      },
      options: { plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
    });
  } catch(e){ console.warn(e); }
}

async function renderPackageChart(){
  try {
    const snap = await getDocs(collection(db,'users'));
    const counts = {};
    snap.docs.forEach(d => {
      const p = d.data().packageId || d.data().plan || 'free';
      counts[p] = (counts[p]||0) + 1;
    });
    const labels = Object.keys(counts);
    const data = labels.map(k => counts[k]);
    const ctx = $('chart-pkg'); if(!ctx) return;
    new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor:['#3b82f6','#7c3aed','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6'] }] },
      options: { plugins:{legend:{position:'bottom'}} }
    });
  } catch(e){ console.warn(e); }
}

// ============ SCHOOLS ============
async function loadSchools(){
  const tbody = $('schools-tbody'); if(!tbody) return;
  try {
    const snap = await getDocs(collection(db,'schools'));
    if(!snap.docs.length){ tbody.innerHTML = `<tr><td colspan="5" class="empty">No schools yet</td></tr>`; return; }
    tbody.innerHTML = snap.docs.map(d => {
      const x = d.data();
      return `<tr>
        <td>${esc(x.name||'')}</td>
        <td>${esc(x.type||'school')}</td>
        <td>${esc(x.district||'')}</td>
        <td>${x.approved ? 'Yes' : 'No'}</td>
        <td>
          <button class="btn btn-sm btn-success" data-sc-toggle="${d.id}" data-on="${!x.approved}">${x.approved ? 'Disable' : 'Approve'}</button>
          <button class="btn btn-sm btn-danger" data-sc-del="${d.id}">Delete</button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-sc-toggle]').forEach(b => b.addEventListener('click', async () => {
      await updateDoc(doc(db,'schools', b.dataset.scToggle), { approved: b.dataset.on === 'true' });
      toast('Updated'); loadSchools();
    }));
    tbody.querySelectorAll('[data-sc-del]').forEach(b => b.addEventListener('click', async () => {
      if(!confirm('Delete this institution?')) return;
      await deleteDoc(doc(db,'schools', b.dataset.scDel));
      toast('Deleted'); loadSchools();
    }));
  } catch(e){ tbody.innerHTML = `<tr><td colspan="5" class="empty">${e.message}</td></tr>`; }
}

async function loadSchoolRequests(){
  const tbody = $('school-req-tbody'); if(!tbody) return;
  try {
    const snap = await getDocs(query(collection(db,'school_requests'), where('status','==','pending')));
    if(!snap.docs.length){ tbody.innerHTML = `<tr><td colspan="5" class="empty">No pending requests</td></tr>`; return; }
    tbody.innerHTML = snap.docs.map(d => {
      const x = d.data();
      return `<tr>
        <td>${esc(x.name||'')}</td>
        <td>${esc(x.type||'')}</td>
        <td>${esc(x.district||'')}</td>
        <td>${esc(x.requestedByEmail||x.requestedByUid||'')}</td>
        <td>
          <button class="btn btn-sm btn-success" data-req-approve="${d.id}">Approve</button>
          <button class="btn btn-sm btn-danger" data-req-reject="${d.id}">Reject</button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-req-approve]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.reqApprove;
      const reqDoc = await getDoc(doc(db,'school_requests', id));
      const x = reqDoc.data();
      await addDoc(collection(db,'schools'), { name:x.name, type:x.type, district:x.district, upazila:x.upazila || '', approved:true, createdAt: serverTimestamp() });
      await updateDoc(doc(db,'school_requests', id), { status:'approved', approvedAt: serverTimestamp() });
      toast('Approved'); loadSchools(); loadSchoolRequests();
    }));
    tbody.querySelectorAll('[data-req-reject]').forEach(b => b.addEventListener('click', async () => {
      await updateDoc(doc(db,'school_requests', b.dataset.reqReject), { status:'rejected' });
      toast('Rejected'); loadSchoolRequests();
    }));
  } catch(e){ tbody.innerHTML = `<tr><td colspan="5" class="empty">${e.message}</td></tr>`; }
}

// ============ QUIZZES ============
async function loadQuizCampaigns(){
  const tbody = $('quizzes-tbody'); if(!tbody) return;
  try {
    const snap = await getDocs(query(collection(db,'quiz_campaigns'), orderBy('startAt','desc')));
    if(!snap.docs.length){ tbody.innerHTML = `<tr><td colspan="8" class="empty">No campaigns</td></tr>`; return; }
    // Pull attempt counts in parallel.
    const attemptsCount = {};
    try {
      const at = await getDocs(collection(db,'quiz_attempts'));
      at.docs.forEach(d => {
        const cid = d.data().campaignId;
        if(cid) attemptsCount[cid] = (attemptsCount[cid]||0) + 1;
      });
    } catch(e){}
    tbody.innerHTML = snap.docs.map(d => {
      const x = d.data();
      const start = x.startAt?.toMillis?.() || x.startAt;
      const end = x.endAt?.toMillis?.() || x.endAt;
      return `<tr>
        <td>${esc(x.title||'')}</td>
        <td>${esc(x.category||'')}</td>
        <td>${esc(x.classLevel||'all')}</td>
        <td>${start ? new Date(start).toLocaleDateString('en-BD') : '—'} → ${end ? new Date(end).toLocaleDateString('en-BD') : '—'}</td>
        <td>${(x.questions||[]).length}</td>
        <td>${x.active ? '✅' : '⏸'}</td>
        <td>${attemptsCount[d.id]||0}</td>
        <td>
          <button class="btn btn-sm" data-qz-toggle="${d.id}" data-on="${!x.active}">${x.active?'Pause':'Activate'}</button>
          <button class="btn btn-sm btn-danger" data-qz-del="${d.id}">Delete</button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-qz-toggle]').forEach(b => b.addEventListener('click', async () => {
      await updateDoc(doc(db,'quiz_campaigns', b.dataset.qzToggle), { active: b.dataset.on === 'true' });
      toast('Updated'); loadQuizCampaigns();
    }));
    tbody.querySelectorAll('[data-qz-del]').forEach(b => b.addEventListener('click', async () => {
      if(!confirm('Delete this quiz?')) return;
      await deleteDoc(doc(db,'quiz_campaigns', b.dataset.qzDel));
      toast('Deleted'); loadQuizCampaigns();
    }));
  } catch(e){ tbody.innerHTML = `<tr><td colspan="8" class="empty">${e.message}</td></tr>`; }
}

// ============ FRIENDS / DM MODERATION ============
async function loadFriendsMod(){
  const tF = $('friendships-tbody');
  if(tF){
    try {
      const snap = await getDocs(query(collection(db,'friendships'), orderBy('createdAt','desc')));
      tF.innerHTML = snap.docs.length ? snap.docs.map(d => {
        const x = d.data();
        const [a, b] = x.uids || [];
        const [na, nb] = x.names || [];
        return `<tr>
          <td>${esc(na||a||'?')}</td>
          <td>${esc(nb||b||'?')}</td>
          <td>${esc(x.classLevel||'')}</td>
          <td>${fmt(x.createdAt)}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="4" class="empty">No friendships yet</td></tr>`;
    } catch(e){ tF.innerHTML = `<tr><td colspan="4" class="empty">${e.message}</td></tr>`; }
  }
  const tD = $('dm-tbody');
  if(tD){
    try {
      const snap = await getDocs(query(collection(db,'direct_messages'), orderBy('createdAt','desc')));
      const docs = snap.docs.slice(0, 100);
      tD.innerHTML = docs.length ? docs.map(d => {
        const x = d.data();
        return `<tr>
          <td>${esc(x.fromName||x.fromUid||'')}</td>
          <td>${esc(x.toUid||'')}</td>
          <td style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.text||'')}</td>
          <td>${fmt(x.createdAt)}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="4" class="empty">No messages yet</td></tr>`;
    } catch(e){ tD.innerHTML = `<tr><td colspan="4" class="empty">${e.message}</td></tr>`; }
  }
}

// ============ FINANCE ============
async function loadFinance(){
  const tbody = $('fi-tbody');
  let total = 0, month = 0, week = 0, today = 0;
  const now = Date.now();
  const t0 = new Date(); t0.setHours(0,0,0,0);
  const w0 = new Date(); w0.setDate(w0.getDate() - 7);
  const m0 = new Date(); m0.setDate(1); m0.setHours(0,0,0,0);
  // Build a per-month series for the chart.
  const monthly = {};
  for(let i=11; i>=0; i--){
    const d = new Date(); d.setMonth(d.getMonth() - i);
    monthly[monthKey(d)] = 0;
  }
  try {
    const snap = await getDocs(query(collection(db,'payment_requests'), orderBy('createdAt','desc')));
    const approved = snap.docs.filter(d => d.data().status === 'approved');
    if(tbody){
      tbody.innerHTML = approved.length ? approved.map(d => {
        const x = d.data();
        return `<tr>
          <td>${esc(x.email||x.uid||'')}</td>
          <td>${esc(x.packageId||x.plan||'')}</td>
          <td>${esc(x.method||'')}</td>
          <td>৳${esc(x.amount||0)}</td>
          <td>${fmt(x.approvedAt || x.createdAt)}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="5" class="empty">No approved payments yet</td></tr>`;
    }
    approved.forEach(d => {
      const x = d.data();
      const amt = Number(x.amount || 0);
      const t = x.approvedAt?.toMillis?.() || x.createdAt?.toMillis?.() || now;
      total += amt;
      if(t >= t0.getTime()) today += amt;
      if(t >= w0.getTime()) week += amt;
      if(t >= m0.getTime()) month += amt;
      const k = monthKey(t);
      if(monthly[k] != null) monthly[k] += amt;
    });
  } catch(e){ if(tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty">${e.message}</td></tr>`; }
  if($('fi-total')) $('fi-total').textContent = `৳${total.toLocaleString('en-BD')}`;
  if($('fi-month')) $('fi-month').textContent = `৳${month.toLocaleString('en-BD')}`;
  if($('fi-week')) $('fi-week').textContent = `৳${week.toLocaleString('en-BD')}`;
  if($('fi-today')) $('fi-today').textContent = `৳${today.toLocaleString('en-BD')}`;
  if(typeof Chart !== 'undefined'){
    const ctx = $('chart-finance');
    if(ctx){
      new Chart(ctx, {
        type: 'line',
        data: { labels: Object.keys(monthly), datasets: [{ label: 'Revenue (৳)', data: Object.values(monthly), borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.18)', tension:.35, fill:true }] },
        options: { plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
      });
    }
  }
}

// ============ Form bindings (Schools + Quizzes) ============
function bindSocialForms(){
  $('sc-add-btn')?.addEventListener('click', async () => {
    const name = $('sc-name').value.trim();
    if(!name){ toast('Name দিন','warn'); return; }
    await addDoc(collection(db,'schools'), {
      name,
      type: $('sc-type').value,
      district: $('sc-district').value.trim(),
      upazila: $('sc-upazila')?.value.trim() || '',
      approved: true,
      createdAt: serverTimestamp(),
    });
    $('sc-name').value=''; $('sc-district').value=''; if($('sc-upazila')) $('sc-upazila').value='';
    toast('Added'); loadSchools();
  });
  initQuizBuilder();
  $('qz-add-btn')?.addEventListener('click', async () => {
    // Form-builder questions take priority. If empty, fall back to the
    // advanced text/JSON textarea so existing workflows still work.
    let questions = collectBuilderQuestions();
    if(!questions.length){
      try { questions = parseQuizInput($('qz-json').value || '[]'); }
      catch(e){ toast('Invalid questions: ' + e.message, 'error'); return; }
    }
    if(!Array.isArray(questions) || !questions.length){
      toast('At least 1 question দিন','error'); return;
    }
    const startVal = $('qz-start').value;
    const endVal = $('qz-end').value;
    await addDoc(collection(db,'quiz_campaigns'), {
      title: $('qz-title').value.trim() || 'Quiz',
      category: $('qz-category').value.trim() || 'general',
      classLevel: $('qz-class').value.trim() || 'all',
      startAt: startVal ? new Date(startVal).getTime() : null,
      endAt: endVal ? new Date(endVal).getTime() : null,
      active: $('qz-active').value === 'true',
      questions,
      createdAt: serverTimestamp(),
    });
    $('qz-title').value=''; $('qz-category').value=''; $('qz-json').value='';
    document.getElementById('qz-builder').innerHTML = '';
    addBuilderQuestion();
    toast('Quiz created'); loadQuizCampaigns();
  });
}

// === Manual quiz builder (Section 8 — replace JSON-only workflow). ===
function initQuizBuilder(){
  const root = document.getElementById('qz-builder');
  if(!root) return;
  root.innerHTML = '';
  addBuilderQuestion();
  document.getElementById('qz-builder-add-btn')?.addEventListener('click', () => addBuilderQuestion());
  document.getElementById('qz-toggle-json-btn')?.addEventListener('click', () => {
    const g = document.getElementById('qz-json-group');
    if(g) g.style.display = g.style.display === 'none' ? '' : 'none';
  });
}

function addBuilderQuestion(prefill){
  const root = document.getElementById('qz-builder');
  if(!root) return;
  const idx = root.children.length;
  const card = document.createElement('div');
  card.className = 'qz-q-card';
  card.innerHTML = `
    <div class="qz-q-head">
      <strong>Q${idx+1}</strong>
      <button type="button" class="btn btn-danger btn-sm" data-qz-remove>Remove</button>
    </div>
    <div class="form-group"><label>Question</label><input class="qz-q-text" placeholder="Question text" value="${prefill?.q ? prefill.q.replace(/"/g,'&quot;') : ''}"/></div>
    <div class="qz-q-opts">
      ${[0,1,2,3].map(i => `
        <label class="qz-q-opt">
          <input type="radio" name="qz-correct-${idx}-${Date.now()}" value="${i}" class="qz-q-correct" ${prefill?.correct===i?'checked':(!prefill && i===0?'checked':'')}/>
          <input type="text" class="qz-q-opt-text" placeholder="Option ${String.fromCharCode(65+i)}" value="${prefill?.options?.[i] ? prefill.options[i].replace(/"/g,'&quot;') : ''}"/>
        </label>
      `).join('')}
    </div>
    <div class="form-group"><label>Explanation (shown after submit)</label><input class="qz-q-explain" placeholder="Why the correct answer is correct" value="${prefill?.explain ? prefill.explain.replace(/"/g,'&quot;') : ''}"/></div>
  `;
  card.querySelector('[data-qz-remove]')?.addEventListener('click', () => card.remove());
  root.appendChild(card);
}

function collectBuilderQuestions(){
  const root = document.getElementById('qz-builder');
  if(!root) return [];
  const out = [];
  root.querySelectorAll('.qz-q-card').forEach(card => {
    const q = card.querySelector('.qz-q-text')?.value.trim() || '';
    const opts = Array.from(card.querySelectorAll('.qz-q-opt-text')).map(i => i.value.trim()).filter(Boolean);
    const correct = parseInt(card.querySelector('.qz-q-correct:checked')?.value || '0', 10);
    const explain = card.querySelector('.qz-q-explain')?.value.trim() || '';
    if(q && opts.length >= 2){
      // The user-facing player at js/quiz.js reads the correct index from
      // `q.a` (matching the legacy text-block parser below); keep both keys
      // in sync so builder-created questions actually score correctly.
      out.push({ q, options: opts, a: Math.min(correct, opts.length-1), explain });
    }
  });
  return out;
}

function parseQuizInput(raw){
  const text = raw.trim();
  if(!text) return [];
  if(text.startsWith('[')) return JSON.parse(text);
  return text.split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
    const q = lines.shift();
    const options = [];
    let answer = 0;
    lines.forEach(line => {
      const ans = line.match(/^answer\s*:\s*([A-D]|[0-3])/i);
      if(ans){
        const v = ans[1].toUpperCase();
        answer = /^[A-D]$/.test(v) ? v.charCodeAt(0) - 65 : Number(v);
        return;
      }
      const opt = line.replace(/^[A-D][\).\:-]\s*/i, '');
      if(opt) options.push(opt);
    });
    if(!q || options.length < 2) throw new Error('Each question needs a title and at least 2 options');
    return { q, options, a: Math.max(0, Math.min(answer, options.length - 1)) };
  });
}

initAuthUI();

// ===== Custom Notifications =====
(function(){
  function $(id){ return document.getElementById(id); }

  // Target dropdown wiring
  const targetSel = $('notif-target');
  if(targetSel){
    targetSel.addEventListener('change', () => {
      const v = targetSel.value;
      const cw = $('notif-class-wrap'); if(cw) cw.style.display = v==='class'?'':'none';
      const uw = $('notif-user-wrap'); if(uw) uw.style.display = v==='user'?'':'none';
    });
  }

  // Send button
  $('cn-send-btn')?.addEventListener('click', async () => {
    const title  = $('notif-title')?.value.trim();
    const body   = $('notif-body')?.value.trim();
    const type   = $('notif-type')?.value || 'info';
    const target = $('notif-target')?.value || 'all';
    const link   = $('notif-link')?.value.trim() || '';
    const clsVal = $('notif-class')?.value.trim() || '';
    const uidVal = $('notif-uid')?.value.trim()   || '';
    const status = $('cn-status');

    if(!title||!body){ if(status) status.textContent='⚠️ Title ও Message দিন'; return; }

    const { db, collection, addDoc, serverTimestamp } = await import('./admin-firebase.js');
    const notif = {
      title, body, type, link,
      target, classLevel: clsVal, targetUid: uidVal,
      createdAt: serverTimestamp(),
      active: true,
    };
    try {
      await addDoc(collection(db,'admin_notifications'), notif);
      if(status){ status.style.color='var(--accent3)'; status.textContent='✅ Notification পাঠানো হয়েছে'; }
      $('notif-title').value=''; $('notif-body').value='';
      loadCNHistory();
    } catch(e){
      if(status){ status.style.color='var(--danger)'; status.textContent='Error: '+e.message; }
    }
  });

  // Revision notif disable requests
  async function loadRevNotifRequests(){
    const root = $('rev-notif-requests');
    if(!root) return;
    try {
      const { db, collection, query, where, getDocs, updateDoc, doc } = await import('./admin-firebase.js');
      const q = query(collection(db,'notif_disable_requests'), where('status','==','pending'));
      const snap = await getDocs(q);
      if(snap.empty){ root.innerHTML='<p style="font-size:.8rem;color:var(--text2)">কোনো pending request নেই</p>'; return; }
      root.innerHTML = snap.docs.map(d => {
        const r = d.data();
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px">
          <div style="flex:1"><strong>${r.userName||r.userEmail||r.uid}</strong><br><small>${r.reason||'No reason given'}</small></div>
          <button class="btn btn-success btn-sm" onclick="approveRevNotifReq('${d.id}')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectRevNotifReq('${d.id}')">Reject</button>
        </div>`;
      }).join('');
    } catch(e){ root.innerHTML='<p>Load failed</p>'; }
  }

  window.approveRevNotifReq = async function(id){
    const { db, doc, updateDoc } = await import('./admin-firebase.js');
    await updateDoc(doc(db,'notif_disable_requests',id), { status:'approved' });
    loadRevNotifRequests();
  };
  window.rejectRevNotifReq = async function(id){
    const { db, doc, updateDoc } = await import('./admin-firebase.js');
    await updateDoc(doc(db,'notif_disable_requests',id), { status:'rejected' });
    loadRevNotifRequests();
  };

  async function loadCNHistory(){
    const root = $('cn-history');
    if(!root) return;
    try {
      const { db, collection, query, orderBy, limit, getDocs } = await import('./admin-firebase.js');
      const q = query(collection(db,'admin_notifications'), orderBy('createdAt','desc'), limit(20));
      const snap = await getDocs(q);
      if(snap.empty){ root.innerHTML='<p style="font-size:.8rem;color:var(--text2)">কোনো notification নেই</p>'; return; }
      root.innerHTML = snap.docs.map(d => {
        const n = d.data();
        return `<div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:.82rem">
          <strong>${n.title}</strong> <span style="color:var(--text2)">(${n.type}, ${n.target})</span><br>
          <span style="color:var(--text2)">${n.body?.slice(0,80)}</span>
        </div>`;
      }).join('');
    } catch(e){}
  }

  // Load on section switch
  document.addEventListener('click', e => {
    if(e.target.dataset.sec === 'custom-notif'){
      loadCNHistory();
      loadRevNotifRequests();
    }
  });

  // Icon link field show/hide
  document.getElementById('cf-icon')?.addEventListener('change', function(){
    const grp = document.getElementById('cf-iconlink-group');
    if(grp) grp.style.display = this.value === 'i-custom-img' ? '' : 'none';
  });

  // Save iconLink along with custom feature
  const origSave = window._cfSave;
  document.getElementById('cf-save-btn')?.addEventListener('click', function(){
    const iconLink = document.getElementById('cf-iconlink')?.value.trim() || '';
    // Store iconLink in the feature data
    if(iconLink) window._pendingIconLink = iconLink;
  }, true);

})();
