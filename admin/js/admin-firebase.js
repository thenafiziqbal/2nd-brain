// admin-firebase.js — admin uses the same Firebase project as the user app.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache,
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, onSnapshot, collectionGroup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(()=>{});

export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, onSnapshot, collectionGroup
};

// === Configure your admin email(s) here. Only these accounts can access the panel. ===
export const ADMIN_EMAILS = [
  "fztech166@gmail.com",
];
