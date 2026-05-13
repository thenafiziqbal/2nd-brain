// voice.js — Web Speech API → text. Bengali first, English fallback.
// More robust lifecycle than the previous version:
//   • Always create a brand-new recognition instance per start (some browsers
//     reject reusing an instance after onend).
//   • Handle 'aborted' as a non-fatal event (we abort intentionally on stop).
//   • Permission gate via getUserMedia BEFORE creating the recognition object.
//   • Fall back through bn-BD → bn-IN → en-US automatically.
//   • Feature-detect on every initVoice() call so dynamic re-renders still work.
//   • Append voice transcript to whichever textarea is currently focused
//     (defaults to #note-content) — keeps mic useful from any page.
import { icon } from './store.js';
import { toast } from './toast.js';

const FALLBACK_LANGS = ['bn-BD','bn-IN','en-US'];

let recognition = null;
let listening = false;
let restartTimer = null;
let langIdx = 0;
let targetEl = null;        // textarea/input we are dictating into
let baseText = '';

export function initVoice(){
  bindMicButtons();
  // Re-bind whenever new buttons appear (e.g. quiz/note share modals).
  document.addEventListener('focusin', e => {
    if(e.target?.matches?.('textarea, input[type=text]')) targetEl = e.target;
  });
}

function bindMicButtons(){
  const supported = ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
  document.querySelectorAll('[data-mic-btn], #mic-btn').forEach(btn => {
    if(btn.dataset.voiceBound) return;
    btn.dataset.voiceBound = '1';
    if(!supported){
      btn.disabled = true;
      btn.title = 'Voice not supported in this browser';
      return;
    }
    btn.addEventListener('click', () => toggleListening(btn));
    paintBtn(btn);
  });
}

function makeRecognition(lang){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  return r;
}

async function ensureMicPermission(){
  if(!navigator.mediaDevices?.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch(e){
    toast('Mic permission denied — browser settings থেকে allow করুন', 'error');
    return false;
  }
}

async function toggleListening(btn){
  if(listening) return stop();
  // Find the target textarea relative to the button. Honour an explicit
  // `data-mic-target` first (e.g. for a title-only mic button); otherwise
  // pick the closest textarea / text input in the same form group.
  const explicit = btn.dataset.micTarget && document.getElementById(btn.dataset.micTarget);
  targetEl = explicit
          || btn.closest('.form-group, .input-with-action, .voice-target, section, body')?.querySelector('textarea, input[type=text]')
          || document.getElementById('note-content')
          || document.activeElement;
  if(!targetEl){ toast('কোনো textarea active নেই', 'warn'); return; }
  baseText = targetEl.value || '';
  const ok = await ensureMicPermission();
  if(!ok) return;
  start(FALLBACK_LANGS[langIdx]);
}

function start(lang){
  // Always start with a fresh recognition object — reusing the previous one
  // after `onend` causes "InvalidStateError" or silent no-ops in some browsers.
  try { recognition?.abort(); } catch(e){}
  clearTimeout(restartTimer);

  recognition = makeRecognition(lang);
  let finalText = '';

  recognition.onresult = (e) => {
    let interim = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      const r = e.results[i];
      if(r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    if(targetEl){
      targetEl.value = (baseText + ' ' + finalText + ' ' + interim).replace(/\s+/g,' ').trim();
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  recognition.onerror = (e) => {
    if(e.error === 'aborted') return; // intentional stop
    if(e.error === 'no-speech') return; // silent gap; let onend handle restart
    if(e.error === 'language-not-supported' && langIdx < FALLBACK_LANGS.length - 1){
      langIdx++;
      toast(`Trying ${FALLBACK_LANGS[langIdx]}…`, 'info');
      restartTimer = setTimeout(() => start(FALLBACK_LANGS[langIdx]), 200);
      return;
    }
    if(e.error === 'not-allowed' || e.error === 'service-not-allowed'){
      toast('Mic blocked — browser settings এ গিয়ে allow করুন', 'error');
      stop();
      return;
    }
    if(e.error === 'network'){
      toast('Voice: internet নেই — Web Speech API server access দরকার', 'error');
      stop();
      return;
    }
    console.warn('voice err', e.error);
  };

  recognition.onend = () => {
    if(!listening) return;
    // Persist what we have so far, then restart with a fresh instance.
    baseText = targetEl?.value || baseText;
    restartTimer = setTimeout(() => start(FALLBACK_LANGS[langIdx]), 250);
  };

  try {
    recognition.start();
    listening = true;
    paintAllBtns();
    toast('Listening… কথা বলুন', 'info');
  } catch(e){
    if(e.name === 'InvalidStateError'){
      // Something odd happened; force-recreate next tick.
      restartTimer = setTimeout(() => start(FALLBACK_LANGS[langIdx]), 200);
      return;
    }
    toast('Mic start failed: ' + e.message, 'error');
  }
}

function stop(){
  listening = false;
  clearTimeout(restartTimer);
  try { recognition?.stop(); } catch(e){}
  try { recognition?.abort(); } catch(e){}
  recognition = null;
  paintAllBtns();
}

function paintAllBtns(){
  document.querySelectorAll('[data-mic-btn], #mic-btn').forEach(paintBtn);
}
function paintBtn(btn){
  btn.innerHTML = icon(listening ? 'mic' : 'mic-off');
  btn.classList.toggle('btn-danger', listening);
  btn.classList.toggle('mic-listening', listening);
  btn.title = listening ? 'Stop voice (click)' : 'Voice → text (Bangla / English)';
}
