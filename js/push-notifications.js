// push-notifications.js — Section 3.
// Unified user-facing prompt to enable browser/desktop notifications,
// plus helpers to schedule the upcoming prayer-time notification and to
// surface admin announcements as OS notifications. Everything goes
// through the standard Notification API + the active service worker —
// no third-party push service required.
import { state, on } from './store.js';
import { toast } from './toast.js';

let prayerTimer = null;
let prayerWatchActive = false;

export function initPushNotifications(){
  // Show a friendly prompt the first time the user opens the app.
  on('auth-ready', () => {
    setTimeout(maybeShowPrompt, 4000);
    schedulePrayerNotification();
    on('prayer-update', schedulePrayerNotification);
  });
  // Re-schedule when the tab becomes visible (timers can drift while
  // throttled in background tabs).
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) schedulePrayerNotification();
  });
}

function maybeShowPrompt(){
  if(!('Notification' in window)) return;
  if(Notification.permission !== 'default') return;
  if(localStorage.getItem('sb-notif-prompt-seen') === '1') return;
  localStorage.setItem('sb-notif-prompt-seen', '1');
  const ok = confirm('🔔 Allow Second Brain to send notifications?\n\n' +
    'You will get reminders for prayer times, revision, announcements & quizzes. ' +
    'You can change this any time from your browser settings.');
  if(ok){
    Notification.requestPermission().then(perm => {
      if(perm === 'granted') toast('Notifications enabled', 'success');
    }).catch(()=>{});
  }
}

// Show a notification. Prefers the active service-worker registration so
// notifications still appear when the page is hidden.
export async function notify(title, opts = {}){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = opts.body || '';
  const icon = opts.icon || '/assets/logo.svg';
  const tag = opts.tag || 'sb-notif';
  try {
    if(navigator.serviceWorker?.ready){
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon, badge: icon, tag, data: opts.data || {} });
      return;
    }
  } catch(e){ /* fall through */ }
  try { new Notification(title, { body, icon, tag }); } catch(e){}
}

function schedulePrayerNotification(){
  clearTimeout(prayerTimer);
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const times = state.prayer?.times;
  if(!times) return;
  const now = new Date();
  const ymd = now.toISOString().slice(0,10);
  const order = ['Fajr','Dhuhr','Asr','Maghrib','Isha'];
  let nextAt = null, nextName = null;
  for(const name of order){
    const t = times[name];
    if(!t) continue;
    const [h,m] = String(t).split(':').map(n => parseInt(n, 10));
    const d = new Date(`${ymd}T${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00`);
    if(d > now){ nextAt = d; nextName = name; break; }
  }
  if(!nextAt) return;
  const ms = nextAt.getTime() - now.getTime();
  if(ms < 1000) return;
  prayerTimer = setTimeout(() => {
    notify(`🕋 ${nextName} prayer time`, {
      body: `It's time for ${nextName}.`,
      tag: `prayer-${nextName}-${ymd}`,
    });
    schedulePrayerNotification();
  }, Math.min(ms, 6 * 60 * 60 * 1000)); // safety cap at 6h
  prayerWatchActive = true;
}

export function isPushReady(){
  return ('Notification' in window) && Notification.permission === 'granted';
}
