// theme.js — light/dark toggle persisted in localStorage.
import { icon } from './store.js';

const KEY = 'sb-theme';

export function initTheme(){
  const saved = localStorage.getItem(KEY) || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  paintIcon(saved);
}

export function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(KEY, next);
  paintIcon(next);
}

function paintIcon(theme){
  const btn = document.getElementById('theme-toggle-btn');
  if(btn) btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
}
