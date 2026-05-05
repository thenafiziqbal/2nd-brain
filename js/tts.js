// tts.js — Text-to-speech via the browser's free Web Speech API.
// Used to read a note + its AI explanation aloud. Auto-detects language
// (Bengali vs. English) by character range so Bangla notes get a Bangla
// voice and English notes get an English voice when available.
import { toast } from './toast.js';

let speaking = false;
let queue = [];

export function ttsSupported(){
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function detectLang(text){
  // Bengali Unicode block: U+0980–U+09FF.
  const bn = (text || '').match(/[\u0980-\u09FF]/g)?.length || 0;
  const total = (text || '').length || 1;
  return bn / total > 0.15 ? 'bn-BD' : 'en-US';
}

function pickVoice(lang){
  const voices = speechSynthesis.getVoices();
  const exact = voices.find(v => v.lang === lang);
  if(exact) return exact;
  const prefix = lang.split('-')[0];
  const partial = voices.find(v => v.lang.startsWith(prefix));
  return partial || voices[0] || null;
}

export function speak(text, opts = {}){
  if(!ttsSupported()){ toast('Browser TTS supports করে না', 'warn'); return; }
  if(!text || !text.trim()) return;
  stop();
  // Split very long text into ~250-char chunks at sentence boundaries to
  // avoid the Chrome 250-char synth glitch.
  const chunks = chunkText(text, 250);
  queue = chunks.map(t => makeUtter(t, opts));
  speaking = true;
  playNext();
}

function chunkText(text, max){
  const out = [];
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
  u.rate = opts.rate ?? 1;
  u.pitch = opts.pitch ?? 1;
  const v = pickVoice(lang);
  if(v) u.voice = v;
  return u;
}

function playNext(){
  if(!queue.length){ speaking = false; return; }
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
}

export function isSpeaking(){ return speaking; }

// Pre-load voice list — Chrome populates this asynchronously.
if(ttsSupported()){
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
