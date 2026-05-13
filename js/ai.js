// ai.js - thin wrappers around Groq + Gemini.
// Users can paste their own API key in Settings. Admin-owned keys must never
// be exposed to browser JavaScript; use a backend proxy for shared AI quota.
import { state } from './store.js';
import { db, doc, updateDoc } from './firebase-init.js';
import { quotaFor } from './quota.js';

const GROQ_DEFAULT_MODEL = 'llama-3.1-8b-instant';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_DEFAULT_VISION_MODEL = 'gemini-2.5-flash';

export function getActiveKey(){
  if(state.apiKeys?.gemini) return { provider:'gemini', key: state.apiKeys.gemini };
  if(state.apiKeys?.groq) return { provider:'groq', key: state.apiKeys.groq };
  return null;
}

export function isTrialActive(){
  if(state.trial.plan === 'pro' || state.trial.plan === 'paid') return true;
  if((state.profile?.rewardEnd || 0) > Date.now()) return true;
  return state.trial.expiresAt && Date.now() < state.trial.expiresAt;
}

export function trialDaysLeft(){
  if(!state.trial.expiresAt) return 0;
  return Math.max(0, Math.ceil((state.trial.expiresAt - Date.now()) / 86400000));
}

export async function aiChat(messages, opts={}){
  const auth = getActiveKey();
  if(!auth) throw new Error('NO_KEY');
  enforceAiQuota();
  await bumpUsage();
  if(auth.provider === 'groq') return chatGroq(auth.key, messages, opts);
  if(auth.provider === 'gemini') return chatGemini(auth.key, messages, opts);
  throw new Error('No AI provider');
}

async function chatGroq(key, messages, { model, max_tokens=700, temperature=0.7 } = {}){
  const res = await fetch(GROQ_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
    body: JSON.stringify({
      model: model || state.appSettings?.groqModel || GROQ_DEFAULT_MODEL,
      messages, max_tokens, temperature
    })
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || '';
}

async function chatGemini(key, messages, { model, max_tokens=700, temperature=0.7 } = {}){
  const useModel = model || state.appSettings?.geminiModel || GEMINI_DEFAULT_MODEL;
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const systemInstruction = messages.find(m => m.role === 'system');
  const body = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens, temperature }
  };
  if(systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
  const res = await fetch(GEMINI_URL(useModel, key), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Gemini Vision call — used by the syllabus OCR feature. Accepts a base64
// image (without the data:URL prefix), the MIME type, and a prompt.
export async function geminiVision({ base64, mime, prompt }){
  if(!state.apiKeys?.gemini) throw new Error('Gemini API key দরকার — Settings এ paste করুন');
  enforceAiQuota();
  const model = state.appSettings?.geminiVisionModel || state.appSettings?.geminiModel || GEMINI_DEFAULT_VISION_MODEL;
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: mime || 'image/jpeg', data: base64 } },
      ],
    }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
  };
  const res = await fetch(GEMINI_URL(model, state.apiKeys.gemini), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function enforceAiQuota(){
  const limit = quotaFor('ai') ?? quotaFor('aiChat') ?? quotaFor('aiExplain');
  if(limit != null && Number(limit) >= 0 && (state.apiUsage || 0) >= Number(limit)){
    throw new Error(`AI usage limit reached (${limit}). Upgrade package or ask admin to increase the limit.`);
  }
}

async function bumpUsage(){
  state.apiUsage = (state.apiUsage || 0) + 1;
  const el = document.getElementById('stat-ai');
  if(el) el.textContent = state.apiUsage;
  const usageEl = document.getElementById('settings-api-usage');
  if(usageEl) usageEl.textContent = state.apiUsage;
  if(!state.user) return;
  try { await updateDoc(doc(db,'users',state.user.uid), { apiUsage: state.apiUsage }); }
  catch(e){ /* offline ok */ }
}
