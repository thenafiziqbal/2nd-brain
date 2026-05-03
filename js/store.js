// store.js — tiny global state + helpers used across modules.
// Avoids leaking everything onto window; modules import what they need.

export const state = {
  user: null,                  // firebase auth user or null
  profile: null,               // doc(users/uid) — { name, institution, classLevel, religion, referralCode, referredBy, rewardEnd, ... }
  notes: [],
  syllabus: [],
  tasks: [],
  filter: 'all',
  currentNoteId: null,
  online: navigator.onLine,
  trial: { startedAt: null, expiresAt: null, plan: 'trial', rewardEnd: null, packageId: null },
  apiKeys: { gemini:'', groq:'' },
  apiUsage: 0,
  appSettings: {},             // mirror of /system/settings
  features: {},                // global feature flags from admin
  branding: {},                // appName, tagline, logoUrl, faviconUrl
  community: [],               // [{ name, url, icon }]
  social: [],                  // [{ platform, url }]
  packages: [],                // active subscription packages from /packages
  trialPackage: null,          // /system/trial_package
  freeTier: null,              // /system/free_tier
  paymentMethods: [],          // [{ id, name, type, number, instructions, link, enabled }]
  referredFriends: [],         // friends who used my code (for refer page counter)
  notices: [],                 // admin-broadcast notices
};

// Listeners for state changes — modules can subscribe instead of polling.
const listeners = new Map();
export function on(event, cb){
  if(!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event)?.delete(cb);
}
export function emit(event, data){
  listeners.get(event)?.forEach(cb => { try{ cb(data); } catch(e){ console.error(e); }});
}

// HTML escape — every render path goes through this to avoid XSS.
export function esc(s){
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                       .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Cheap unique id (timestamp + random) for local optimistic inserts.
export function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

// Date formatting that Bengali users are used to: 12-hour with seconds.
export function fmtDateTime(d){
  if(!d) return '';
  if(typeof d.toDate === 'function') d = d.toDate();
  return new Date(d).toLocaleString('en-BD', {
    year:'numeric', month:'short', day:'numeric',
    hour:'numeric', minute:'2-digit', hour12:true
  });
}
export function fmtTime(d){
  if(!d) return '';
  if(typeof d.toDate === 'function') d = d.toDate();
  return new Date(d).toLocaleTimeString('en-BD', { hour:'numeric', minute:'2-digit', hour12:true });
}
export function fmtSeconds(secs){
  const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60), s = secs%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// SVG sprite reference shorthand. <svg><use href="#i-…"></use></svg>
export function icon(name, cls=''){
  return `<svg class="ico ${cls}"><use href="assets/icons.svg#i-${name}"></use></svg>`;
}

// Subject colour palette shared by all rendering paths.
export const SUBJECT_COLORS = {
  Physics:    {bg:'rgba(79,142,247,.15)', color:'#4f8ef7', dot:'#4f8ef7'},
  Chemistry:  {bg:'rgba(124,58,237,.15)', color:'#a78bfa', dot:'#a78bfa'},
  Math:       {bg:'rgba(6,214,160,.15)',  color:'#06d6a0', dot:'#06d6a0'},
  Biology:    {bg:'rgba(34,197,94,.15)',  color:'#4ade80', dot:'#4ade80'},
  English:    {bg:'rgba(251,191,36,.15)', color:'#fbbf24', dot:'#fbbf24'},
  Bangla:     {bg:'rgba(249,115,22,.15)', color:'#fb923c', dot:'#fb923c'},
  ICT:        {bg:'rgba(20,184,166,.15)', color:'#2dd4bf', dot:'#2dd4bf'},
  History:    {bg:'rgba(236,72,153,.15)', color:'#f472b6', dot:'#f472b6'},
  Geography:  {bg:'rgba(59,130,246,.15)', color:'#60a5fa', dot:'#60a5fa'},
  Other:      {bg:'rgba(107,114,128,.15)',color:'#9ca3af', dot:'#9ca3af'},
};
export function subjectStyle(s){ return SUBJECT_COLORS[s] || SUBJECT_COLORS.Other; }

// Class levels for registration dropdown — covers school through job-seekers.
export const CLASS_LEVELS = [
  'Class 1','Class 2','Class 3','Class 4','Class 5',
  'Class 6','Class 7','Class 8','Class 9','Class 10',
  'SSC','HSC (Class 11)','HSC (Class 12)',
  'Diploma / Polytechnic','Honours / University','Masters',
  'Job Seeker','BCS / Govt Job Prep','Other'
];

// Default trial length (used as fallback if /system/trial_package isn't set).
export const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;
// Referral reward — friend buys a package → referrer gets this much extra time.
export const REFERRAL_REWARD_MS = 30 * 24 * 60 * 60 * 1000;

// Generates a short, easy-to-share referral code (8 alnum chars, no ambiguity).
export function generateReferralCode(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for(let i=0;i<8;i++) s += alphabet[Math.floor(Math.random()*alphabet.length)];
  return s;
}
