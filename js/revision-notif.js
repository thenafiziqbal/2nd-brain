// revision-notif.js — daily revision reminder + session timer + disable request system
import {
  db, collection, doc, addDoc, getDoc, setDoc, onSnapshot,
  serverTimestamp, query, where, getDocs
} from './firebase-init.js';
import { state, on } from './store.js';
import { toast } from './toast.js';

let revTimer = null;
let sessionInterval = null;
let revNotifUnsub = null;

export function initRevisionNotif(){
  on('auth-ready', () => {
    ensureNotificationPermission();
    loadRevSettings();
    startRevisionCheck();
    watchAdminNotifications();
  });
}

// === Load revision settings ===
async function loadRevSettings(){
  if(!state.user) return;
  try {
    const snap = await getDoc(doc(db,'user_rev_settings', state.user.uid));
    state.revSettings = snap.exists() ? snap.data() : {};
  } catch(e){ state.revSettings = {}; }

  // Load global admin settings
  try {
    const sSnap = await getDoc(doc(db,'system','settings'));
    const d = sSnap.data() || {};
    state.revDurationMin = d.revisionDuration || 60;
    state.revNotifRequireRequest = d.revisionNotifRequireRequest !== false;
  } catch(e){}
}

// === Revision check interval ===
function startRevisionCheck(){
  if(revTimer) clearInterval(revTimer);
  scheduleRevisionReminder();
  // Check every 30 minutes
  revTimer = setInterval(scheduleRevisionReminder, 30 * 60 * 1000);
}

function scheduleRevisionReminder(){
  if(!state.user) return;
  if(state.revSettings?.notifDisabled) return;
  // Check if any notes are due for revision
  const notes = state.notes || [];
  const dueNow = notes.filter(n => {
    const d = n.revisionDate || n.reviseAt;
    const dt = d?.toDate ? d.toDate() : (d ? new Date(d) : null);
    return dt && dt <= new Date() && !n.revised;
  });
  if(!dueNow.length) return;
  showRevisionReminder(dueNow.length);
}

let revReminderShown = false;
function showRevisionReminder(count){
  if(revReminderShown) return;
  revReminderShown = true;
  setTimeout(() => { revReminderShown = false; }, 2 * 60 * 60 * 1000); // reset after 2h

  toast(`📚 ${count}টি note revision-এর জন্য অপেক্ষা করছে!`, 'warn', 10000);

  // Show notification if permitted
  if('Notification' in window && Notification.permission === 'granted'){
    try {
      new Notification('Revision Reminder', {
        body: `${count}টি note revision করার সময় হয়েছে।`,
        icon: '/assets/logo.svg',
      });
    } catch(e){}
  } else if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
}

// === Revision Session Timer ===
export function startRevisionSession(){
  const durationMin = state.revSettings?.customDuration || state.revDurationMin || 60;
  const durationSec = durationMin * 60;

  const overlay = document.getElementById('revision-session-overlay');
  const timer   = document.getElementById('revision-session-timer');
  if(!overlay) return;

  overlay.classList.add('active');
  let remaining = durationSec;

  const update = () => {
    const m = Math.floor(remaining/60);
    const s = remaining % 60;
    if(timer) timer.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  update();

  clearInterval(sessionInterval);
  sessionInterval = setInterval(() => {
    remaining--;
    update();
    if(remaining <= 0){
      clearInterval(sessionInterval);
      overlay.classList.remove('active');
      toast('✅ Revision session শেষ! অনেক ভালো করেছেন!', 'success', 6000);
      markRevisionDone();
    }
  }, 1000);

  document.getElementById('rev-session-stop-btn')?.addEventListener('click', () => {
    clearInterval(sessionInterval);
    overlay.classList.remove('active');
  });
}

async function markRevisionDone(){
  if(!state.user) return;
  try {
    await setDoc(doc(db,'user_rev_settings', state.user.uid), {
      lastRevisionAt: serverTimestamp(),
      uid: state.user.uid,
    }, { merge: true });
  } catch(e){}
}

// === Admin notification watcher ===
function watchAdminNotifications(){
  if(!state.user) return;
  if(revNotifUnsub) revNotifUnsub();
  try {
    const q = query(
      collection(db,'admin_notifications'),
      where('active','==',true)
    );
    revNotifUnsub = onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if(change.type !== 'added') return;
        const n = change.doc.data();
        const target = n.target || 'all';
        const uid = state.user?.uid;
        const cls = state.profile?.classLevel;
        const shouldShow =
          target === 'all' ||
          (target === 'class' && n.classLevel === cls) ||
          (target === 'user' && (n.targetUid === uid || n.targetUid === state.user?.email));
        if(!shouldShow) return;
        // Check not already seen
        const seenKey = `sb-notif-seen-${uid}`;
        const seen = JSON.parse(localStorage.getItem(seenKey)||'[]');
        if(seen.includes(change.doc.id)) return;
        seen.push(change.doc.id);
        localStorage.setItem(seenKey, JSON.stringify(seen.slice(-100)));
        toast(`📣 ${n.title}: ${n.body}`, n.type || 'info', 8000);
        showDeviceNotification(n.title, n.body);
      });
    }, () => {});
  } catch(e){}
}

function ensureNotificationPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default'){
    try { Notification.requestPermission(); } catch(e){}
  }
}

function showDeviceNotification(title, body){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title || 'Second Brain', {
      body: body || '',
      icon: '/assets/logo.svg',
      badge: '/assets/logo.svg'
    });
  } catch(e){}
}

// === Disable notification request ===
export async function requestDisableNotif(reason){
  if(!state.user) return;
  if(!state.revNotifRequireRequest){
    // Admin doesn't require request - just disable locally
    await setDoc(doc(db,'user_rev_settings', state.user.uid), {
      notifDisabled: true,
      uid: state.user.uid,
    }, { merge: true });
    state.revSettings = state.revSettings || {};
    state.revSettings.notifDisabled = true;
    toast('Revision notification বন্ধ করা হয়েছে', 'info');
    return;
  }
  // Submit request for admin approval
  try {
    await addDoc(collection(db,'notif_disable_requests'), {
      uid: state.user.uid,
      userEmail: state.user.email,
      userName: state.profile?.name || '',
      reason: reason || '',
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    toast('Request পাঠানো হয়েছে — অনুমোদনের পর notification বন্ধ হবে', 'success');
  } catch(e){ toast('Failed: '+e.message,'error'); }
}
