// Local demo data only. No Admin SDK, credentials, or production connections.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
const emails = ["miimi@example.test", "takuto@example.test"],
  password = "local-demo-only";
const users = [];
for (const email of emails) {
  const body = JSON.stringify({ email, password, returnSecureToken: true }),
    headers = { "Content-Type": "application/json" };
  let result = await (
    await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key",
      { method: "POST", headers, body },
    )
  ).json();
  if (result.error?.message === "EMAIL_EXISTS")
    result = await (
      await fetch(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
        { method: "POST", headers, body },
      )
    ).json();
  if (!result.localId)
    throw new Error("Local Auth Emulator account creation failed");
  users.push(result.localId);
}
const env = await initializeTestEnvironment({
  projectId: "demo-couple-wallet",
  firestore: { host: "127.0.0.1", port: 8080 },
});
try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(),
      ref = doc(db, "households/demo"),
      existing = await getDoc(ref);
    if (existing.exists()) {
      if (JSON.stringify(existing.data().memberUids) !== JSON.stringify(users))
        throw new Error(
          "Existing local household has other members; refusing to overwrite",
        );
    } else
      await setDoc(ref, {
        memberUids: users,
        names: { [users[0]]: "みーみ", [users[1]]: "たくと" },
        currentCycleId: "initial",
        currentPaidTotals: { [users[0]]: 0, [users[1]]: 0 },
        revision: 0,
        mutation: { kind: "init", id: "initial" },
      });
    for (const uid of users)
      await setDoc(doc(db, "users", uid), { householdId: "demo" });
  });
} finally {
  await env.cleanup();
}
console.log("Local demo accounts:", emails.join(", "), "password:", password);
