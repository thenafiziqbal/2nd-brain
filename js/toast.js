// toast.js — non-blocking notifications.
import { icon, esc } from './store.js';

const ICONS = { success:'check', error:'x', warn:'warning', info:'info' };

export function toast(msg, type='info', duration=3500){
  const wrap = document.getElementById('toast-container');
  if(!wrap) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(ICONS[type] || 'info')}<span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

// Convenience for confirm dialogs without blocking with native confirm().
export function confirmDialog(message){
  // For now the native confirm is fine — keeps the bundle small.
  return Promise.resolve(window.confirm(message));
}
