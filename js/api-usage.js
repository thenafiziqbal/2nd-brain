// api-usage.js — paints the user's cumulative AI request usage on the
// Settings tab and the Dashboard mini-stat. State.apiUsage is bumped by
// ai.js whenever a request fires.
import { state, on } from './store.js';

export function initApiUsage(){
  paint();
  on('auth-ready', paint);
  on('api-usage', paint);
}

export function paint(){
  const usage = state.apiUsage || 0;
  document.querySelectorAll('[data-api-usage]').forEach(el => { el.textContent = usage; });
  const stat = document.getElementById('stat-ai');
  if(stat) stat.textContent = usage;
  const brain = document.getElementById('brain-ai-count');
  if(brain) brain.textContent = usage;
  const settings = document.getElementById('settings-api-usage');
  if(settings) settings.textContent = usage;
}
