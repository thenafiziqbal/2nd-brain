// offline.js — small online/offline UX layer.
import { state, emit, icon } from './store.js';

export function initOffline(){
  const badge = document.getElementById('offline-badge');
  if(badge) badge.innerHTML = `${icon('wifi-off')} <span>Offline Mode</span>`;

  let offlineTimer = null;

  const update = () => {
    state.online = navigator.onLine;
    document.querySelectorAll('[data-needs-online]').forEach(el => {
      el.disabled = !state.online;
      el.title = state.online ? '' : 'Internet প্রয়োজন';
    });
    emit('online-change', state.online);

    if(!state.online && badge){
      badge.classList.remove('fade-out');
      badge.classList.add('show');
      // auto-hide after 4 seconds
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
