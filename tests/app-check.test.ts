import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  initialize: vi.fn(),
  provider: vi.fn(function (this: { siteKey: string }, key: string) {
    this.siteKey = key;
  }),
  authEmulator: vi.fn(),
  firestoreEmulator: vi.fn(),
}));
vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({}),
  connectAuthEmulator: mock.authEmulator,
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: () => ({}),
  connectFirestoreEmulator: mock.firestoreEmulator,
}));
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: mock.initialize,
  ReCaptchaEnterpriseProvider: mock.provider,
}));
vi.mock("../src/wallet", () => ({ execute: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_USE_EMULATORS", "false");
  for (const name of [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_APP_ID",
  ])
    vi.stubEnv(name, "public-test-config");
  vi.stubEnv(
    "VITE_RECAPTCHA_ENTERPRISE_SITE_KEY",
    "public-enterprise-test-site-key",
  );
});
afterEach(() => vi.unstubAllEnvs());
it("uses the Enterprise provider with automatic token refresh in production", async () => {
  const { configured, emulator } = await import("../src/firebase");
  expect(configured).toBe(true);
  expect(emulator).toBe(false);
  expect(mock.provider).toHaveBeenCalledWith("public-enterprise-test-site-key");
  expect(mock.initialize).toHaveBeenCalledWith(expect.anything(), {
    provider: expect.objectContaining({
      siteKey: "public-enterprise-test-site-key",
    }),
    isTokenAutoRefreshEnabled: true,
  });
  expect(mock.authEmulator).not.toHaveBeenCalled();
  expect(mock.firestoreEmulator).not.toHaveBeenCalled();
});
it("does not accept a legacy v3 site key as an Enterprise configuration", async () => {
  vi.stubEnv("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY", "");
  vi.stubEnv("VITE_RECAPTCHA_V3_SITE_KEY", "legacy-v3-key");
  const { configured } = await import("../src/firebase");
  expect(configured).toBe(false);
  expect(mock.initialize).not.toHaveBeenCalled();
});
it("skips App Check only for explicitly selected local development emulators", async () => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_USE_EMULATORS", "true");
  vi.stubEnv("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY", "");
  const { configured, emulator } = await import("../src/firebase");
  expect(configured).toBe(true);
  expect(emulator).toBe(true);
  expect(mock.initialize).not.toHaveBeenCalled();
  expect(mock.authEmulator).toHaveBeenCalled();
  expect(mock.firestoreEmulator).toHaveBeenCalled();
});
it("cannot bypass production App Check by setting the emulator environment flag", async () => {
  vi.stubEnv("VITE_USE_EMULATORS", "true");
  const { emulator } = await import("../src/firebase");
  expect(emulator).toBe(false);
  expect(mock.initialize).toHaveBeenCalled();
  expect(mock.authEmulator).not.toHaveBeenCalled();
  expect(mock.firestoreEmulator).not.toHaveBeenCalled();
});
