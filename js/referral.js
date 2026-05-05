// referral.js — referral program logic.
//
// On register:
//   1. Generate a unique referral code for the new user (auth.js does this).
//   2. Write /referrals/{code} → { uid, used: 0 } so we can resolve a code → uid.
//   3. If the URL had ?ref=XYZ, look up that code → store referredBy on profile.
//
// When a referred friend's payment is approved, the admin panel writes
// /users/{referrerUid}.rewardEnd = max(now, rewardEnd) + 30 days, so the
// referrer enjoys 1 month of full access on top of whatever they had.
//
// This file just renders the user-facing "Refer & Earn" page and wires up
// share/copy buttons.
import { db, doc, getDoc, setDoc, collection, query, where, getDocs }
  from './firebase-init.js';
import { state, esc, icon, generateReferralCode } from './store.js';
import { toast } from './toast.js';

export function getReferralLink(){
  if(!state.profile?.referralCode) return location.origin;
  return `${location.origin}${location.pathname}?ref=${encodeURIComponent(state.profile.referralCode)}`;
}

export async function ensureReferralCode(uid){
  // Called from auth.ensureProfile after register/login. Generates + stores
  // a unique code if the user doesn't have one yet.
  if(state.profile?.referralCode) return state.profile.referralCode;
  let code, taken = true, tries = 0;
  while(taken && tries++ < 10){
    code = generateReferralCode();
    try {
      const snap = await getDoc(doc(db, 'referrals', code));
      taken = snap.exists();
    } catch(e){ taken = false; }
  }
  if(!code) code = generateReferralCode();
  try {
    await setDoc(doc(db, 'referrals', code), {
      uid, used: 0, createdAt: Date.now()
    }, { merge: true });
    await setDoc(doc(db, 'users', uid), { referralCode: code }, { merge: true });
  } catch(e){ /* offline ok */ }
  state.profile = { ...(state.profile || {}), referralCode: code };
  return code;
}

export async function resolveReferrer(code){
  if(!code) return null;
  try {
    const snap = await getDoc(doc(db, 'referrals', String(code).toUpperCase()));
    if(snap.exists()) return snap.data().uid;
  } catch(e){}
  return null;
}

export async function loadReferredFriends(){
  // Lists users who registered with this user's referral code.
  if(!state.user || !state.profile?.referralCode) return [];
  try {
    const q = query(collection(db, 'users'), where('referredBy', '==', state.user.uid));
    const snap = await getDocs(q);
    state.referredFriends = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch(e){
    state.referredFriends = [];
  }
  return state.referredFriends;
}

export async function paintReferPage(){
  const root = document.getElementById('view-refer');
  if(!root) return;
  const code = state.profile?.referralCode || '—';
  const link = getReferralLink();
  const friends = await loadReferredFriends();
  const purchased = friends.filter(f => f.plan === 'pro' || f.plan === 'paid').length;
  const rewardEnd = state.profile?.rewardEnd || 0;
  const rewardActive = rewardEnd > Date.now();
  const rewardDays = rewardActive ? Math.ceil((rewardEnd - Date.now()) / 86400000) : 0;

  root.innerHTML = `
    <div class="section-header"><div class="section-title">${icon('gift')} Refer & Earn</div></div>

    <div class="refer-hero">
      <div class="refer-hero-icon">${icon('gift','xl')}</div>
      <h2>Friend invite করে ১ মাস free full access নিন</h2>
      <p>আপনার referral link শেয়ার করুন। কোনো বন্ধু এই link দিয়ে register করে কোনো একটা package কিনলে আপনি পাবেন <strong>৩০ দিন full access</strong> (current trial/plan এর সাথে যোগ হবে)। বন্ধুও পাবে full trial।</p>
    </div>

    <div class="refer-stats">
      <div class="refer-stat"><div class="refer-stat-num">${friends.length}</div><div class="refer-stat-lbl">Friends invited</div></div>
      <div class="refer-stat"><div class="refer-stat-num">${purchased}</div><div class="refer-stat-lbl">Purchased</div></div>
      <div class="refer-stat ${rewardActive?'green':''}"><div class="refer-stat-num">${rewardDays}</div><div class="refer-stat-lbl">Reward days left</div></div>
    </div>

    <div class="manage-grid">
      <div class="manage-card">
        <div class="card-title">${icon('tag')} Your referral code</div>
        <div class="refer-code">${esc(code)}</div>
        <button class="btn btn-secondary btn-block" id="copy-refer-code">${icon('copy')} Copy code</button>
      </div>

      <div class="manage-card">
        <div class="card-title">${icon('link')} Share link</div>
        <input id="refer-link-input" readonly value="${esc(link)}"/>
        <div class="refer-share">
          <button class="btn btn-secondary" id="copy-refer-link">${icon('copy')} Copy</button>
          <a class="btn btn-secondary share-btn" data-share="whatsapp">${icon('whatsapp')} WhatsApp</a>
          <a class="btn btn-secondary share-btn" data-share="telegram">${icon('telegram')} Telegram</a>
          <a class="btn btn-secondary share-btn" data-share="facebook">${icon('facebook')} Facebook</a>
        </div>
      </div>
    </div>

    <div class="manage-card" style="margin-top:14px">
      <div class="card-title">${icon('users')} Your invited friends</div>
      ${friends.length ? `
        <table class="refer-table">
          <thead><tr><th>Name</th><th>Class</th><th>Joined</th><th>Status</th></tr></thead>
          <tbody>${friends.map(f => `
            <tr>
              <td><strong>${esc(f.name||'—')}</strong><br><small>${esc(f.email||'')}</small></td>
              <td>${esc(f.classLevel||'—')}</td>
              <td>${esc(fmtJoined(f.createdAt))}</td>
              <td>${(f.plan==='pro'||f.plan==='paid') ? '<span class="badge green">Purchased</span>' : '<span class="badge">Joined</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : `<p class="mini-note">এখনও কেউ join করেনি — link টা share করে দেখুন!</p>`}
    </div>
  `;

  document.getElementById('copy-refer-code')?.addEventListener('click', () => copy(code));
  document.getElementById('copy-refer-link')?.addEventListener('click', () => copy(link));
  root.querySelectorAll('.share-btn').forEach(a => {
    a.href = shareUrl(a.dataset.share, link);
    a.target = '_blank';
    a.rel = 'noopener';
  });
}

function fmtJoined(d){
  if(!d) return '—';
  if(typeof d === 'object' && d.toDate) d = d.toDate();
  return new Date(d).toLocaleDateString('en-BD', { day:'2-digit', month:'short', year:'numeric' });
}

function copy(text){
  navigator.clipboard?.writeText(text).then(
    () => toast('Copied!','success'),
    () => toast('Copy failed','error')
  );
}

function shareUrl(platform, link){
  const txt = encodeURIComponent('Second Brain — best student PWA. Join with my link:');
  const u = encodeURIComponent(link);
  switch(platform){
    case 'whatsapp': return `https://wa.me/?text=${txt}%20${u}`;
    case 'telegram': return `https://t.me/share/url?url=${u}&text=${txt}`;
    case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    default: return link;
  }
}
