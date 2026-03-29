import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyDuH5Is9ubnkaZ1FZj59OKUohUF7joX8ZY",
  authDomain: "akshaykotish-aca69.firebaseapp.com",
  projectId: "akshaykotish-aca69",
  storageBucket: "akshaykotish-aca69.firebasestorage.app",
  messagingSenderId: "1036407362609",
  appId: "1:1036407362609:web:c2bdaf8515ad82eb5f3110",
  measurementId: "G-DT1VXX25XW"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

let analytics = null;
if (typeof window !== 'undefined') {
  try { analytics = getAnalytics(app); } catch (e) { /* analytics optional */ }
}
export { analytics };
export default app;
