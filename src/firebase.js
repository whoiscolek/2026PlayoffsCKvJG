import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDlosWVU5hbDNCkt-aWcRqpC4mn3Xzgvmg",
  authDomain: "nba-playoff-betting.firebaseapp.com",
  projectId: "nba-playoff-betting",
  storageBucket: "nba-playoff-betting.firebasestorage.app",
  messagingSenderId: "827094077934",
  appId: "1:827094077934:web:25a6edf4bf07f8a1e17eff",
  measurementId: "G-9RE4VZ3J95"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
};
