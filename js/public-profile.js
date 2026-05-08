import { db, doc, setDoc, serverTimestamp } from './firebase-init.js';
import { state } from './store.js';

export async function syncPublicProfile(extra = {}){
  if(!state.user) return;
  const p = state.profile || {};
  const data = {
    uid: state.user.uid,
    name: p.name || state.user.displayName || 'Student',
    institution: p.institution || '',
    classLevel: p.classLevel || '',
    district: p.district || '',
    upazila: p.upazila || '',
    photoUrl: p.photoUrl || null,
    totalStudySeconds: p.totalStudySeconds || 0,
    lastStudyAt: p.lastStudyAt || null,
    ...extra,
    updatedAt: serverTimestamp(),
  };
  try { await setDoc(doc(db, 'public_profiles', state.user.uid), data, { merge:true }); }
  catch(e){ console.warn('public profile sync failed', e); }
}
