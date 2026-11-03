import { execute } from "./wallet";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
const e = import.meta.env;
export const emulator = e.DEV && e.VITE_USE_EMULATORS === "true";
export const configured =
  emulator ||
  Boolean(
    e.VITE_FIREBASE_API_KEY &&
    e.VITE_FIREBASE_AUTH_DOMAIN &&
    e.VITE_FIREBASE_PROJECT_ID &&
    e.VITE_FIREBASE_APP_ID &&
    e.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
  );
const app = initializeApp({
  apiKey: e.VITE_FIREBASE_API_KEY || "demo-key",
  authDomain:
    e.VITE_FIREBASE_AUTH_DOMAIN || "demo-couple-wallet.firebaseapp.com",
  projectId: e.VITE_FIREBASE_PROJECT_ID || "demo-couple-wallet",
  appId: e.VITE_FIREBASE_APP_ID || "demo-app",
});
export const auth = getAuth(app),
  db = getFirestore(app);
if (emulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
} else if (configured)
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      e.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
    ),
    isTokenAutoRefreshEnabled: true,
  });
export async function command(data: Record<string, unknown>) {
  if (!navigator.onLine)
    throw new Error("通信できません。接続を確認して再度お試しください");
  if (!auth.currentUser) throw new Error("ログインしてください");
  return execute(db, auth.currentUser.uid, data);
}
