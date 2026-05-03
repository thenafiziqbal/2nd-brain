// study-tracker.js — persists focus-session totals to Firestore so the
// leaderboard works across devices and other users can see the rankings.
//
// Listens for the global "focus-session-end" event fired by focus-timer.js,
// then increments users/{uid}.totalStudySeconds AND writes a study log
// document so admins can see daily/weekly totals if they want.
import {
  db, doc, collection, addDoc, updateDoc, getDoc, setDoc,
  serverTimestamp
} from './firebase-init.js';
import { state } from './store.js';
import { syncPublicProfile } from './public-profile.js';

export function initStudyTracker(){
  window.addEventListener('focus-session-end', e => recordSession(e.detail));
}

async function recordSession({ duration, note, start, end }){
  if(!state.user || !duration) return;
  const uid = state.user.uid;
  // Best-effort: don't block UI if the network is down.
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref).catch(() => null);
    const cur = (snap?.data()?.totalStudySeconds) || 0;
    await updateDoc(ref, {
      totalStudySeconds: cur + duration,
      lastStudyAt: serverTimestamp(),
    }).catch(async () => {
      // doc may not exist yet — create it.
      await setDoc(ref, { totalStudySeconds: duration, lastStudyAt: serverTimestamp() }, { merge:true });
    });
    state.profile = { ...(state.profile||{}), totalStudySeconds: cur + duration };
    await syncPublicProfile({ totalStudySeconds: cur + duration, lastStudyAt: serverTimestamp() });

    await addDoc(collection(db,'users', uid, 'study_logs'), {
      duration, note: note || '', start, end,
      classLevel: state.profile?.classLevel || '',
      institution: state.profile?.institution || '',
      schoolId: state.profile?.schoolId || '',
      createdAt: serverTimestamp(),
    });
    // Also write a global log (used by admin dashboard for DAU charts).
    await addDoc(collection(db,'study_logs'), {
      uid, duration,
      classLevel: state.profile?.classLevel || '',
      schoolId: state.profile?.schoolId || '',
      createdAt: serverTimestamp(),
    }).catch(()=>{});
  } catch(e){
    console.warn('study-tracker write failed', e);
  }
}
