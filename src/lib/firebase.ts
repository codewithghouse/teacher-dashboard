import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// Fail fast at module load if required config is missing. Firebase's
// initializeApp accepts undefined fields and only errors out later with
// cryptic messages from downstream SDK calls — easier to debug here.
const requiredEnv = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;
const missing = requiredEnv.filter((k) => !import.meta.env[k]);
if (missing.length > 0) {
  throw new Error(
    `[firebase] Missing required env vars: ${missing.join(", ")}. ` +
    `Check your .env file or deployment environment.`,
  );
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

if (typeof window !== "undefined") {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (siteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn("[AppCheck] init failed:", err);
    }
  } else if (import.meta.env.PROD) {
    // Loud warning — in production, missing App Check means Firestore/Functions
    // calls may be rejected (if enforcement is on) or unprotected (if off).
    console.error(
      "[AppCheck] VITE_RECAPTCHA_SITE_KEY is not set in production. " +
      "App Check is disabled — backend calls may be unprotected or rejected.",
    );
  }
}

export const auth = getAuth(app);
// Offline persistence: caches Firestore data in IndexedDB so the app works
// when the teacher has no internet. Multi-tab manager keeps tabs in sync.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);
// Region aligns with Cloud Functions deployment (default us-central1).
// If functions are ever moved to another region, update both sides together.
export const functions = getFunctions(app);

export default app;