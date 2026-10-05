// Firebase web config: Firebase console → Project settings → General → Your apps → Web app.
// These values are not secrets. Access is controlled by firestore.rules and the
// "allowed" collection. Leave as null to keep data on this phone only.
window.FIREBASE_CONFIG = null;

// Web Push certificate key: Project settings → Cloud Messaging → Web Push certificates.
window.FIREBASE_VAPID_KEY = BK43vDHQ_NmZHBY9QIUw9eVG1_RNvBw1Ay-8zRSyf8yLbhWJLUsSsMmkrvIuFzbuYPtDz8aUctdFKeEmVU7--VQ;

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBkMRrGReuFQoswE2gS6wyPnKU5MusYqag",
  authDomain: "growthtracker-b4f0a.firebaseapp.com",
  projectId: "growthtracker-b4f0a",
  storageBucket: "growthtracker-b4f0a.firebasestorage.app",
  messagingSenderId: "335895253012",
  appId: "1:335895253012:web:cec817b9193b0583d45701"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

