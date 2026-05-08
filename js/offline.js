// offline.js — online/offline UX layer + persistent offline pill.
import { state, emit, icon } from './store.js';

export function initOffline(){
  const badge = document.getElementById('offline-badge');
  if(badge) badge.innerHTML = `${icon('wifi-off')} <span>Offline Mode</span>`;

  // Persistent pill at the top of the viewport — stays visible the whole
  // time the user is offline so they understand why writes might be queued.
  let pill = document.getElementById('sb-offline-pill');
  if(!pill){
    pill = document.createElement('div');
    pill.id = 'sb-offline-pill';
    pill.className = 'sb-offline-pill';
    pill.innerHTML = '⚠️ Offline — changes saved locally, will sync when online';
    document.body.appendChild(pill);
  }

  let offlineTimer = null;

  const update = () => {
    state.online = navigator.onLine;
    document.querySelectorAll('[data-needs-online]').forEach(el => {
      el.disabled = !state.online;
      el.title = state.online ? '' : 'Internet প্রয়োজন';
    });
    emit('online-change', state.online);

    pill.classList.toggle('on', !state.online);

    if(!state.online && badge){
      badge.classList.remove('fade-out');
      badge.classList.add('show');
      clearTimeout(offlineTimer);
      offlineTimer = setTimeout(() => {
        badge.classList.add('fade-out');
        setTimeout(() => badge.classList.remove('show','fade-out'), 600);
      }, 4000);
    } else if(badge){
      clearTimeout(offlineTimer);
      badge.classList.remove('show','fade-out');
    }
  };

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
