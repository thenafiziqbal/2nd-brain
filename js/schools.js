// schools.js — institution registry.
//
// Reads /schools (admin-managed) and populates the register-time school
// dropdown. Includes a hard-coded "Charghat Technical School and College"
// as the default option (per user requirement) plus the dynamic list and
// an "Other / এখানে নেই" option that opens a request form.
//
// User submits new school requests to /school_requests, admin can approve
// from the admin panel which adds it to /schools.
import {
  db, collection, query, where, orderBy, onSnapshot,
  addDoc, doc, getDoc, serverTimestamp
} from './firebase-init.js';
import { state, esc, emit } from './store.js';
import { toast } from './toast.js';

export const DEFAULT_SCHOOL = {
  id: 'default-charghat',
  name: 'Charghat Technical School and College',
  type: 'school',
  approved: true,
  district: 'Rajshahi',
  upazila: 'Charghat',
};

let cache = [DEFAULT_SCHOOL];

export function watchSchools(){
  // Live list of approved schools (admin manages these).
  const q = query(collection(db, 'schools'), where('approved','==', true));
  return onSnapshot(q, snap => {
    const fromDb = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cache = mergeUnique([DEFAULT_SCHOOL, ...fromDb]);
    state.schools = cache;
    paintAllDropdowns();
    emit('schools', cache);
  }, err => {
    console.warn('schools watch failed', err);
    state.schools = cache;
    paintAllDropdowns();
  });
}

function mergeUnique(list){
  const seen = new Set();
  return list.filter(s => {
    const key = (s.name || '').toLowerCase().trim();
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function paintAllDropdowns(){
  document.querySelectorAll('select[data-school-select]').forEach(paintDropdown);
}
function paintDropdown(sel){
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select your institution —</option>' +
    cache.map(s => `<option value="${esc(s.name)}" data-id="${esc(s.id)}">${esc(s.name)}</option>`).join('') +
    '<option value="__other__">Other (নতুন স্কুল request করুন)</option>';
  sel.value = cur || cache[0]?.name || '';
}

export function bindSchoolPicker(selectEl, requestFormEl){
  if(!selectEl) return;
  selectEl.addEventListener('change', () => {
    const isOther = selectEl.value === '__other__';
    if(requestFormEl) requestFormEl.style.display = isOther ? 'block' : 'none';
  });
}

export async function submitSchoolRequest({ name, type, district, upazila, requestedByUid, requestedByEmail }){
  if(!name || !name.trim()) throw new Error('School name দিন');
  return addDoc(collection(db, 'school_requests'), {
    name: name.trim(),
    type: type || 'school',
    district: district || '',
    upazila: upazila || '',
    requestedByUid: requestedByUid || null,
    requestedByEmail: requestedByEmail || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function attachUserSchool(uid, schoolName, schoolId){
  if(!uid) return;
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    await import('./firebase-init.js').then(m => m.updateDoc(ref, {
      institution: schoolName,
      schoolId: schoolId || '',
    }));
  } catch(e){ console.warn(e); }
}

export function getSchoolsList(){ return cache.slice(); }
