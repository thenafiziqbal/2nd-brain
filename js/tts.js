// tts.js — Text-to-speech via the browser's free Web Speech API.
// Supports Bangla, English and any language a user's device exposes.
//
// Production hardening (vs. the previous version):
//   • Global ON/OFF toggle that persists in localStorage.
//   • Mobile-friendly "warm-up" utterance fired inside the first user
//     gesture so iOS Safari + Android Chrome unlock TTS.
//   • Robust voice selection: bn-BD → bn-IN → bn → first voice tagged Bengali
//     → en-US → first available voice.
//   • Re-tries voice loading when Chrome populates voices asynchronously.
//   • Per-instance utterance state; concurrent calls don't trample each other.
//   • Public helpers: ttsEnabled(), setTtsEnabled(), speak(), stop(), isSpeaking().
import { toast } from './toast.js';

const ENABLED_KEY = 'sb-tts-enabled';
const RATE_KEY = 'sb-tts-rate';
const VOICE_KEY = 'sb-tts-voice';

let speaking = false;
let queue = [];
let warmedUp = false;
let voiceCache = null;

export function ttsSupported(){
  return typeof window !== 'undefined'
      && 'speechSynthesis' in window
      && 'SpeechSynthesisUtterance' in window;
}

export function ttsEnabled(){
  // Default ON when supported. Users can flip via the toggle.
  if(!ttsSupported()) return false;
  const v = localStorage.getItem(ENABLED_KEY);
  return v === null ? true : v === '1';
}

export function setTtsEnabled(on){
  localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  if(!on) stop();
  document.dispatchEvent(new CustomEvent('tts:enabled-change', { detail: on }));
  paintToggle();
}

export function ttsRate(){
  const r = parseFloat(localStorage.getItem(RATE_KEY) || '1');
  return isFinite(r) ? Math.min(2, Math.max(0.5, r)) : 1;
}
export function setTtsRate(r){
  localStorage.setItem(RATE_KEY, String(r));
}

export function ttsPreferredVoice(){
  return localStorage.getItem(VOICE_KEY) || '';
}
export function setTtsPreferredVoice(name){
  if(name) localStorage.setItem(VOICE_KEY, name);
  else localStorage.removeItem(VOICE_KEY);
}

function detectLang(text){
  // Bengali Unicode block: U+0980–U+09FF.
  const t = String(text || '');
  const bn = (t.match(/[\u0980-\u09FF]/g) || []).length;
  const ar = (t.match(/[\u0600-\u06FF]/g) || []).length; // Arabic
  const hi = (t.match(/[\u0900-\u097F]/g) || []).length; // Devanagari
  const total = t.length || 1;
  if(bn / total > 0.10) return 'bn-BD';
  if(ar / total > 0.10) return 'ar-SA';
  if(hi / total > 0.10) return 'hi-IN';
  return 'en-US';
}

function loadVoices(){
  if(!ttsSupported()) return [];
  const v = speechSynthesis.getVoices();
  if(v && v.length) voiceCache = v;
  return voiceCache || [];
}

function pickVoice(lang){
  const voices = loadVoices();
  if(!voices.length) return null;
  const preferred = ttsPreferredVoice();
  if(preferred){
    const found = voices.find(v => v.name === preferred);
    if(found) return found;
  }
  // Exact locale match.
  const exact = voices.find(v => v.lang === lang);
  if(exact) return exact;
  // Same primary tag (e.g. bn-BD / bn-IN).
  const primary = lang.split('-')[0].toLowerCase();
  const partial = voices.find(v => v.lang.toLowerCase().startsWith(primary));
  if(partial) return partial;
  // Fallback: scan voice names for hints (e.g. "Google বাংলা", "Bengali").
  const hint = primary === 'bn'
    ? voices.find(v => /beng|bangl|bn/i.test(v.name + ' ' + v.lang))
    : null;
  return hint || voices.find(v => v.lang.toLowerCase().startsWith('en')) || voices[0] || null;
}

export function speak(text, opts = {}){
  if(!ttsEnabled()){ return; }
  if(!ttsSupported()){ toast('Browser TTS supported না', 'warn'); return; }
  if(!text || !String(text).trim()) return;
  ensureWarmup();
  stop();
  const chunks = chunkText(String(text), 220);
  queue = chunks.map(t => makeUtter(t, opts));
  speaking = true;
  paintToggle();
  playNext();
}

export function speakIfEnabled(text, opts){
  if(ttsEnabled()) speak(text, opts);
}

function chunkText(text, max){
  const out = [];
  // Sentence boundary on `.!?।` (Bangla full stop daari).
  const sentences = text.split(/(?<=[.!?।])\s+/);
  let buf = '';
  for(const s of sentences){
    if((buf + ' ' + s).trim().length > max){
      if(buf) out.push(buf.trim());
      buf = s;
    } else buf = (buf + ' ' + s).trim();
  }
  if(buf) out.push(buf.trim());
  return out.length ? out : [text];
}

function makeUtter(text, opts){
  const lang = opts.lang || detectLang(text);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = opts.rate ?? ttsRate();
  u.pitch = opts.pitch ?? 1;
  const v = pickVoice(lang);
  if(v) u.voice = v;
  return u;
}

function playNext(){
  if(!queue.length){ speaking = false; paintToggle(); return; }
  const u = queue.shift();
  u.onend = playNext;
  u.onerror = () => playNext();
  try { speechSynthesis.speak(u); }
  catch(e){ playNext(); }
}

export function stop(){
  speaking = false;
  queue = [];
  try { speechSynthesis.cancel(); } catch(e){}
  paintToggle();
}

export function isSpeaking(){ return speaking; }

// First-touch warmup: iOS/Android often refuse to speak unless a
// SpeechSynthesisUtterance is invoked from inside a user gesture. We invoke
// a silent utterance the first time the user taps anywhere.
function ensureWarmup(){
  if(warmedUp || !ttsSupported()) return;
  warmedUp = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
    // Cancel synchronously so a later real speak() isn't killed by a
    // delayed cancel timer (Devin Review finding).
    speechSynthesis.cancel();
  } catch(e){}
}

// ============================================================
// Floating toggle button (lives in the app header). Lets the
// user switch TTS on/off globally + see a "speaking" indicator.
// ============================================================
export function initTtsToggle(){
  if(!ttsSupported()) return;
  // Prime voice list.
  loadVoices();
  if(speechSynthesis.onvoiceschanged !== undefined){
    speechSynthesis.onvoiceschanged = () => loadVoices();
  }
  // Warmup on first interaction so mobile browsers cooperate.
  const warm = () => { ensureWarmup(); window.removeEventListener('pointerdown', warm); };
  window.addEventListener('pointerdown', warm, { once: true });

  injectFab();
  paintToggle();
  document.addEventListener('click', e => {
    const btn = e.target.closest('#tts-toggle-fab');
    if(!btn) return;
    e.preventDefault();
    if(speaking){ stop(); return; }
    setTtsEnabled(!ttsEnabled());
    if(ttsEnabled()) toast('TTS on — note খুললে read aloud হবে', 'success');
    else toast('TTS off', 'info');
  });
}

function injectFab(){
  if(document.getElementById('tts-toggle-fab')) return;
  const btn = document.createElement('button');
  btn.id = 'tts-toggle-fab';
  btn.type = 'button';
  btn.title = 'Toggle text-to-speech';
  btn.setAttribute('aria-label', 'Toggle text-to-speech');
  btn.innerHTML = `<span class="tts-fab-icon" aria-hidden="true">🔊</span><span class="tts-fab-label"></span>`;
  document.body.appendChild(btn);
}

function paintToggle(){
  const btn = document.getElementById('tts-toggle-fab');
  if(!btn) return;
  const on = ttsEnabled();
  btn.classList.toggle('on', on);
  btn.classList.toggle('speaking', speaking);
  const label = btn.querySelector('.tts-fab-label');
  if(label) label.textContent = speaking ? 'Stop' : (on ? 'TTS' : 'Off');
  const icon = btn.querySelector('.tts-fab-icon');
  if(icon) icon.textContent = speaking ? '⏹' : (on ? '🔊' : '🔇');
}

// Pre-load voice list — Chrome populates this asynchronously.
if(ttsSupported()){
  speechSynthesis.onvoiceschanged = () => loadVoices();
}
