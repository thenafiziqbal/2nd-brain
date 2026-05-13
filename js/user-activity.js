// user-activity.js — Track and display user activity
// Records: notes created/updated, syllabus work, community messages, quiz attempts
import { db, doc, collection, serverTimestamp, updateDoc, addDoc, getDocs, query, orderBy, limit } from './firebase-init.js';
import { state } from './store.js';

let activityCache = {};

export async function recordActivity(type, data = {}){
  if(!state.user) return;
  try {
    const activity = {
      type, // 'note', 'syllabus', 'community', 'quiz', 'question_bank', 'prayer', 'task'
      title: data.title || '',
      description: data.description || '',
      metadata: data.metadata || {},
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, 'users', state.user.uid, 'activity_log'), activity);
    
    // Also update the public profile with last activity for leaderboard/profiles
    await updateDoc(doc(db, 'users', state.user.uid), {
      lastActivityAt: serverTimestamp(),
      lastActivityType: type,
    }).catch(()=>{});
  } catch(e) {
    console.warn('Activity recording failed:', e);
  }
}

export async function getUserActivity(uid, limit_count = 20){
  if(activityCache[uid]) return activityCache[uid];
  try {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'activity_log'),
      orderBy('createdAt', 'desc'),
      limit(limit_count)
    ));
    const activities = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.() || new Date(d.data().createdAt)
    }));
    activityCache[uid] = activities;
    return activities;
  } catch(e) {
    console.warn('Failed to load user activity:', e);
    return [];
  }
}

export function clearActivityCache(uid){
  if(uid) delete activityCache[uid];
  else activityCache = {};
}

export function getActivityIcon(type){
  const icons = {
    'note': 'i-notes',
    'syllabus': 'i-book-open',
    'community': 'i-users',
    'quiz': 'i-sparkles',
    'question_bank': 'i-book-open',
    'prayer': 'i-prayer',
    'task': 'i-tasks',
    'friend': 'i-users',
  };
  return icons[type] || 'i-activity';
}

export function getActivityLabel(type){
  const labels = {
    'note': 'Created/Updated note',
    'syllabus': 'Added syllabus content',
    'community': 'Posted in community',
    'quiz': 'Attempted quiz',
    'question_bank': 'Used question bank',
    'prayer': 'Viewed prayer times',
    'task': 'Created/Updated task',
    'friend': 'Added friend',
  };
  return labels[type] || type;
}
