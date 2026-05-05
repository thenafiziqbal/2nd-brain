// chat.js — floating AI chat panel + support chat (user → admin).
import { state, esc, icon } from './store.js';
import { aiChat, isTrialActive, trialDaysLeft } from './ai.js';
import { db, addDoc, collection, query, where, orderBy, onSnapshot, serverTimestamp, auth, signInAnonymously } from './firebase-init.js';
import { toast } from './toast.js';

const history = []; // last N messages with the AI
let mode = 'ai';     // 'ai' or 'support'
let supportUnsub = null;

export function initChat(){
  document.getElementById('chat-fab')?.addEventListener('click', toggle);
  document.querySelectorAll('.chat-tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.chatMode)));
  document.getElementById('chat-send-btn')?.addEventListener('click', send);
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if(e.key === 'Enter') { e.preventDefault(); send(); }
  });
  document.getElementById('chat-close-btn')?.addEventListener('click', toggle);
}

function toggle(){
  const panel = document.getElementById('chat-panel');
  const fab = document.getElementById('chat-fab');
  const open = panel.classList.toggle('open');
  fab.style.display = open ? 'none' : 'grid';
  if(open) setTimeout(() => document.getElementById('chat-input')?.focus(), 150);
  if(open && mode === 'support') subscribeSupport();
  if(!open && supportUnsub){ supportUnsub(); supportUnsub = null; }
}

function setMode(m){
  mode = m;
  document.querySelectorAll('.chat-tab').forEach(t => t.classList.toggle('active', t.dataset.chatMode === m));
  if(m === 'support'){ subscribeSupport(); paintSupportEmpty(); }
  else { if(supportUnsub){ supportUnsub(); supportUnsub = null; } }
  const placeholder = m === 'ai' ? 'AI কে কিছু জিজ্ঞাসা করুন...' : 'Admin-কে message লিখুন...';
  const inp = document.getElementById('chat-input');
  if(inp) inp.placeholder = placeholder;
}

async function send(){
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if(!msg) return;
  input.value = '';
  if(mode === 'ai') return sendAI(msg);
  return sendSupport(msg);
}

// ========== AI MODE ==========
async function sendAI(msg){
  const c = document.getElementById('chat-messages');
  c.insertAdjacentHTML('beforeend', `<div class="chat-msg user">${esc(msg)}</div>`);
  c.scrollTop = c.scrollHeight;

  if(!isTrialActive() && !state.apiKeys.gemini && !state.apiKeys.groq){
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg ai"><div class="ai-label">${icon('ai','sm')} AI</div>আপনার free trial শেষ। Settings-এ নিজের Gemini/Groq API key দিন অথবা subscription নিন।</div>`);
    return;
  }

  c.insertAdjacentHTML('beforeend',
    `<div class="chat-msg ai" id="chat-typing"><div class="ai-thinking" style="margin:0"><div class="thinking-dots"><span></span><span></span><span></span></div></div></div>`);
  c.scrollTop = c.scrollHeight;

  history.push({ role:'user', content: msg });
  const notesContext = (state.notes || []).slice(0, 8)
    .map(n => `[${n.subject}] ${n.title}: ${(n.content||'').slice(0,100)}`).join('\n');
  const sysTpl = state.appSettings?.sysChat ||
    `You are a helpful AI assistant for a Bengali student. The user has these notes:\n{{notes}}\nRespond in a mix of Bengali and English. Be concise and helpful.`;
  const messages = [
    { role:'system', content: sysTpl.replace('{{notes}}', notesContext) },
    ...history.slice(-10),
  ];
  try {
    const reply = await aiChat(messages, { max_tokens: 500 });
    history.push({ role:'assistant', content: reply });
    document.getElementById('chat-typing')?.remove();
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg ai"><div class="ai-label">${icon('ai','sm')} AI</div>${esc(reply).replace(/\n/g,'<br>')}</div>`);
    c.scrollTop = c.scrollHeight;
  } catch(e){
    document.getElementById('chat-typing')?.remove();
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg ai"><div class="ai-label">${icon('ai','sm')} AI</div>${icon('warning','sm')} ${esc(e.message)}</div>`);
  }
}

// ========== SUPPORT MODE ==========
function paintSupportEmpty(){
  const c = document.getElementById('chat-messages');
  if(!c) return;
  c.innerHTML = `<div class="chat-msg system">${icon('chat','sm')} Admin-এর সাথে চ্যাট</div>`;
}

async function sendSupport(msg){
  if(!state.online){ toast('Internet নেই — পরে চেষ্টা করুন','warn'); return; }
  // Section 11 — let logged-out visitors talk to support too. We sign
  // them in anonymously so the message gets a stable uid and Firestore
  // security rules can still scope them to their own conversation.
  if(!state.user){
    try {
      const cred = await signInAnonymously(auth);
      state.user = cred.user;
      toast('Anonymous chat session started', 'info');
    } catch(e){
      toast('Could not start anonymous session: ' + e.message, 'error');
      return;
    }
  }
  try {
    await addDoc(collection(db, 'support_chats'), {
      uid: state.user.uid,
      anonymous: !!state.user.isAnonymous,
      name: state.profile?.name || state.user.email || 'Guest',
      from: 'user',
      text: msg,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch(e){ toast('Send failed: ' + e.message, 'error'); }
}

function subscribeSupport(){
  if(!state.user || supportUnsub) return;
  const q = query(collection(db,'support_chats'), where('uid','==', state.user.uid), orderBy('createdAt','asc'));
  supportUnsub = onSnapshot(q, snap => {
    const c = document.getElementById('chat-messages');
    if(!c) return;
    if(snap.empty){ paintSupportEmpty(); return; }
    c.innerHTML = snap.docs.map(d => {
      const m = d.data();
      const cls = m.from === 'admin' ? 'admin' : 'user';
      const label = m.from === 'admin' ? `<div class="ai-label">${icon('shield','sm')} Admin</div>` : '';
      return `<div class="chat-msg ${cls}">${label}${esc(m.text).replace(/\n/g,'<br>')}</div>`;
    }).join('');
    c.scrollTop = c.scrollHeight;
  });
}
