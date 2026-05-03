// firebase-init.js — single source of truth for the Firebase app.
// Uses the v10 modular SDK loaded from gstatic CDN. Safe to import anywhere.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence,
  onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// === EDIT THESE TO YOUR PROJECT ===
const firebaseConfig = {
  apiKey:"AIzaSyD12CKuKR0pr6LZVPNvm8DIvyMACWUddWc",
  authDomain:"focosmood.firebaseapp.com",
  databaseURL:"https://focosmood-default-rtdb.firebaseio.com",
  projectId:"focosmood",
  storageBucket:"focosmood.firebasestorage.app",
  messagingSenderId:"709940101855",
  appId:"1:709940101855:web:e07ee9007c64669e8bdf6a",
  measurementId:"G-REWDH6YYLD"
};

export const app = initializeApp(firebaseConfig);

// Persistent offline cache — works across multiple open tabs.
// This replaces the old enableIndexedDbPersistence and is the only way to
// guarantee the app keeps working when there is no network.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Auth — make login persist across browser restarts so the user only
// registers once and only logs in once per device.
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(()=>{ /* ignore */ });

// Re-export Firestore helpers so feature modules don't need to import the
// SDK directly. Keeps the dependency surface tight.
export {
  onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile,
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp,
  onSnapshot
};

// User-scoped data path helpers. Every write/read for student data goes
// through these helpers so we never accidentally read another user's data.
export function userDoc(uid){ return doc(db, "users", uid); }
export function userCol(uid, name){ return collection(db, "users", uid, name); }
