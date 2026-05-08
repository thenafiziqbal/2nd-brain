// prayer.js — prayer times with countdown.
// Optimised: countdown tick only updates 3 text nodes per second (not the
// whole grid). Grid is re-rendered every minute, not every second.
import { state, esc, icon, fmtTime, emit } from './store.js';

const ISLAM_NAMES = { Fajr:'ফজর', Sunrise:'সূর্যোদয়', Dhuhr:'যোহর', Asr:'আসর', Maghrib:'মাগরিব', Isha:'ইশা' };
const ISLAM_ICONS = { Fajr:'sun', Sunrise:'sun', Dhuhr:'sun', Asr:'sun', Maghrib:'moon', Isha:'moon' };
const ISLAM_ORDER = ['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'];

const ALT = {
  hindu:    { names:{Morning:'সকালের পূজা',Noon:'দুপুরের প্রার্থনা',Evening:'সন্ধ্যা আরতি',Night:'রাতের ধ্যান'},
              icons:{Morning:'sun',Noon:'sun',Evening:'moon',Night:'moon'},
              times:{Morning:'06:00',Noon:'12:30',Evening:'18:15',Night:'21:00'},
              location:'Hindu prayer/reminder schedule' },
  christian:{ names:{Morning:'Morning Prayer',Noon:'Midday Prayer',Evening:'Evening Prayer',Night:'Night Prayer'},
              icons:{Morning:'sun',Noon:'sun',Evening:'moon',Night:'moon'},
              times:{Morning:'06:30',Noon:'12:00',Evening:'18:30',Night:'21:30'},
              location:'Christian prayer/reminder schedule' },
  buddhist: { names:{Morning:'Morning Meditation',Noon:'Mindful Pause',Evening:'Evening Chant',Night:'Night Meditation'},
              icons:{Morning:'sun',Noon:'sun',Evening:'moon',Night:'moon'},
              times:{Morning:'05:45',Noon:'12:15',Evening:'18:00',Night:'21:00'},
              location:'Buddhist meditation/reminder schedule' },
  other:    { names:{Study:'Study Intention',Break:'Mindful Break',Reflect:'Reflection'},
              icons:{Study:'target',Break:'lightbulb',Reflect:'moon'},
              times:{Study:'09:00',Break:'15:00',Reflect:'21:00'},
              location:'Custom reflection schedule' },
};

let times = null, names = ISLAM_NAMES, iconsMap = ISLAM_ICONS, order = ISLAM_ORDER;
let countdownInterval = null;
let gridInterval = null;

export async function loadPrayer(){
  const profile = state.profile;
  if(!profile) return;
  const enabled = profile.prayerEnabled !== false;
  ['prayer-mini-widget','prayer-countdown-main','prayer-grid'].forEach(id => {
    document.getElementById(id)?.classList.toggle('prayer-disabled', !enabled);
  });
  if(!enabled){
    setText('prayer-location','Prayer times turned off');
    return;
  }
  const religion = profile.religion || 'islam';
  if(religion !== 'islam'){
    const sch = ALT[religion] || ALT.other;
    names = sch.names; iconsMap = sch.icons; order = Object.keys(sch.times);
    times = sch.times;
    paint(); setText('prayer-location', sch.location);
    return;
  }
  names = ISLAM_NAMES; iconsMap = ISLAM_ICONS; order = ISLAM_ORDER;
  try {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2,'0');
    const mm = String(today.getMonth()+1).padStart(2,'0');
    const yyyy = today.getFullYear();
    const city = encodeURIComponent(profile.upazila || profile.district || 'Dhaka');
    const method = encodeURIComponent(profile.prayerMethod || '1');
    const school = encodeURIComponent(profile.prayerSchool || '0');
    const res = await fetch(`https://api.aladhan.com/v1/timingsByCity/${dd}-${mm}-${yyyy}?city=${city}&country=Bangladesh&method=${method}&school=${school}`);
    const data = await res.json();
    if(data.code === 200){
      times = data.data.timings;
      paint();
      setText('prayer-location',`${profile.upazila || profile.district || 'Dhaka'}, Bangladesh`);
      // Expose to other modules (push notifications, dashboard widgets).
      state.prayer = { times, location: profile.upazila || profile.district || 'Dhaka' };
      emit('prayer-update', state.prayer);
    }
  } catch(e){
    document.getElementById('prayer-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1">${icon('wifi-off','xl')}<div class="empty-title">Could not load</div><div class="empty-text">Check internet</div></div>`;
  }
}

function parseTime(str){
  const [h,m] = str.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0); return d;
}

function paint(){
  if(!times) return;
  renderGrid();
  updateMini();
  startCountdown();
}

function getNext(){
  const now = new Date();
  for(const k of order){
    const t = parseTime(times[k]);
    if(t > now) return { name: k, time: t, str: times[k] };
  }
  return { name: order[0], time: null, str: times[order[0]], tomorrow: true };
}
function getCurrent(){
  const now = new Date();
  let cur = null;
  for(const k of order){ if(parseTime(times[k]) <= now) cur = k; }
  return cur;
}

function renderGrid(){
  const grid = document.getElementById('prayer-grid');
  if(!grid) return;
  const now = new Date();
  const next = getNext();
  const cur = getCurrent();
  grid.innerHTML = order.map(k => {
    const t = parseTime(times[k]);
    const passed = t < now && k !== cur;
    const isCur = k === cur;
    const isNext = next && k === next.name && !next.tomorrow;
    let cls = 'prayer-card';
    if(isCur) cls += ' active-prayer';
    else if(isNext) cls += ' next-prayer';
    else if(passed) cls += ' passed';
    const status = isCur ? '<div class="prayer-status" style="color:var(--accent3)">Current</div>'
                : isNext ? '<div class="prayer-status" style="color:var(--accent)">Next</div>'
                : passed ? '<div class="prayer-status" style="color:var(--text3)">Passed</div>' : '';
    return `<div class="${cls}">
      ${icon(iconsMap[k] || 'prayer','xl')}
      <div class="prayer-name">${esc(names[k])}</div>
      <div class="prayer-time-val">${fmtTime(parseTime(times[k]))}</div>
      ${status}
    </div>`;
  }).join('');
}

function updateMini(){
  const next = getNext();
  if(!next) return;
  setText('prayer-mini-name', names[next.name] + (next.tomorrow ? ' (Tomorrow)' : ''));
  setText('prayer-mini-time', fmtTime(parseTime(next.str)));
  // Dashboard widget mirror.
  setText('dash-prayer-name', names[next.name] + (next.tomorrow ? ' (Tomorrow)' : ''));
  setText('dash-prayer-time', fmtTime(parseTime(next.str)));
  const profile = state.profile || {};
  setText('dash-prayer-loc', profile.upazila || profile.district || 'Bangladesh');
}

function startCountdown(){
  // Tick: only updates 3 text nodes; grid re-render moved to per-minute.
  clearInterval(countdownInterval);
  clearInterval(gridInterval);
  countdownInterval = setInterval(() => {
    const next = getNext();
    if(!next || !next.time) return;
    const diff = Math.max(0, Math.floor((next.time - Date.now())/1000));
    const h = Math.floor(diff/3600), m = Math.floor((diff%3600)/60), s = diff%60;
    const str = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    setText('prayer-countdown-val', str);
    setText('prayer-countdown-name', names[next.name]);
    setText('prayer-mini-countdown', '⏳ ' + str);
    setText('dash-prayer-countdown', '⏳ ' + str);
    if(diff === 0) notifyPrayer(next.name);
  }, 1000);
  // Repaint grid only every 60s.
  gridInterval = setInterval(() => { renderGrid(); updateMini(); }, 60000);
}

function setText(id, v){ const el = document.getElementById(id); if(el) el.textContent = v; }

let lastPrayerNotifyKey = '';
function notifyPrayer(name){
  if(state.profile?.prayerEnabled === false) return;
  const key = `${new Date().toDateString()}-${name}`;
  if(lastPrayerNotifyKey === key) return;
  lastPrayerNotifyKey = key;
  if('Notification' in window && Notification.permission === 'granted'){
    try { new Notification(names[name] || 'Prayer time', { body:'Prayer time has started', icon:'/assets/logo.svg' }); } catch(e){}
  }
}
