import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Firestore,
  getDocs,
  collection,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { execute } from "../src/wallet";
let env: RulesTestEnvironment;
const database = (uid: string) =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;
const initial = {
  memberUids: ["alice", "bob"],
  names: { alice: "みーみ", bob: "たくと" },
  currentCycleId: "start",
  currentPaidTotals: { alice: 0, bob: 0 },
  revision: 0,
  mutation: { kind: "init", id: "init" },
};
const expense = (amount = 100001, payer = "alice") => ({
  action: "add",
  title: "電気9月",
  amountYen: amount,
  payerUid: payer,
  occurredAt: "2026-09-01",
});
const cmd = (uid: string, data: Record<string, unknown>) =>
  execute(database(uid), uid, data);
const h = async () =>
  (await getDoc(doc(database("alice"), "households/h"))).data()!;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-couple-wallet",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
}, 60000);
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "households/h"), initial);
    for (const uid of ["alice", "bob"])
      await setDoc(doc(db, "users", uid), { householdId: "h" });
  });
});
afterAll(async () => env?.cleanup());
it("members can read but outsiders and anonymous users cannot", async () => {
  const id = (await cmd("alice", expense())).id!;
  const preview = await cmd("alice", { action: "preview" });
  await cmd("alice", {
    action: "settle",
    revision: preview.revision,
    cycleId: preview.cycleId,
  });
  for (const path of [
    "households/h",
    `households/h/expenses/${id}`,
    "households/h/settlements/start",
  ]) {
    for (const uid of ["alice", "bob"])
      await assertSucceeds(getDoc(doc(database(uid), path)));
    await assertFails(getDoc(doc(database("mallory"), path)));
    await assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), path)),
    );
  }
});
it("denies household creation, mapping changes, member replacement and invites, even by members", async () => {
  for (const uid of ["alice", "mallory"]) {
    const db = database(uid);
    for (const path of ["households/new", "users/mallory", "invites/code"])
      await assertFails(setDoc(doc(db, path), initial));
    await assertFails(
      updateDoc(doc(db, "households/h"), {
        ...initial,
        memberUids: ["alice", "mallory"],
        revision: 1,
      }),
    );
  }
  await assertFails(getDoc(doc(database("bob"), "users/alice")));
  await assertFails(deleteDoc(doc(database("alice"), "users/alice")));
});
it("CRUD adjusts both totals and only allows self rename", async () => {
  const x = await cmd("alice", expense());
  await cmd("bob", { ...expense(400, "bob"), action: "edit", id: x.id });
  expect((await h()).currentPaidTotals).toEqual({ alice: 0, bob: 400 });
  await cmd("alice", { action: "delete", id: x.id });
  expect((await h()).currentPaidTotals).toEqual({ alice: 0, bob: 0 });
  expect(
    (
      await getDoc(doc(database("alice"), "households/h/expenses", x.id!))
    ).data()?.deleted,
  ).toBe(true);
  await expect(
    cmd("alice", { ...expense(), action: "edit", id: x.id }),
  ).rejects.toThrow();
  await cmd("alice", { action: "rename", name: "新しい名前" });
  expect((await h()).names.alice).toBe("新しい名前");
  await assertFails(
    updateDoc(doc(database("alice"), "households/h"), {
      names: { alice: "新しい名前", bob: "改ざん" },
      revision: (await h()).revision + 1,
      mutation: { kind: "rename", id: "alice" },
    }),
  );
});
it("rejects totals-only updates and expenses without matching atomic totals", async () => {
  const db = database("alice");
  await assertFails(
    updateDoc(doc(db, "households/h"), {
      currentPaidTotals: { alice: 100, bob: 0 },
      revision: 1,
      mutation: { kind: "expense", id: "missing" },
    }),
  );
  await assertFails(
    setDoc(doc(db, "households/h/expenses/solo"), {
      title: "missing aggregate",
    }),
  );
  const batch = writeBatch(db);
  batch.set(doc(db, "households/h/expenses/forged"), {
    title: "不正",
    amountYen: 10,
    payerUid: "alice",
    occurredAt: "2026-01-01",
    cycleId: "start",
    createdByUid: "alice",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deleted: false,
  });
  batch.update(doc(db, "households/h"), {
    revision: 1,
    mutation: { kind: "expense", id: "forged" },
    currentPaidTotals: { alice: 1000, bob: 0 },
  });
  await assertFails(batch.commit());
});
it("prevents multiple expenses being hidden in one aggregate update", async () => {
  const db = database("alice"),
    batch = writeBatch(db);
  for (const id of ["one", "two"])
    batch.set(doc(db, "households/h/expenses", id), {
      title: id,
      amountYen: 10,
      payerUid: "alice",
      occurredAt: "2026-01-01",
      cycleId: "start",
      createdByUid: "alice",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deleted: false,
    });
  batch.update(doc(db, "households/h"), {
    revision: 1,
    mutation: { kind: "expense", id: "one" },
    currentPaidTotals: { alice: 10, bob: 0 },
  });
  await assertFails(batch.commit());
});
it("settles atomically, floors the half yen, preserves records and rejects edits", async () => {
  const x = await cmd("alice", expense(100001)),
    y = await cmd("bob", expense(60000, "bob"));
  const p = await cmd("alice", { action: "preview" });
  expect(p.amountYen).toBe(20000);
  expect(p.items.length).toBe(2);
  await cmd("bob", {
    action: "settle",
    revision: p.revision,
    cycleId: p.cycleId,
  });
  const home = await h();
  expect(home.currentPaidTotals).toEqual({ alice: 0, bob: 0 });
  expect(home.currentCycleId).not.toBe("start");
  const db = database("alice"),
    s = (await getDoc(doc(db, "households/h/settlements/start"))).data()!;
  expect(s.amountYen).toBe(20000);
  expect(s.fromUid).toBe("bob");
  expect(s.paidTotalsSnapshot).toEqual({ alice: 100001, bob: 60000 });
  for (const action of ["edit", "delete"])
    await expect(
      cmd("alice", { ...expense(2), action, id: x.id }),
    ).rejects.toThrow();
  await assertFails(
    updateDoc(doc(db, "households/h/expenses", y.id!), { amountYen: 1 }),
  );
  await assertFails(deleteDoc(doc(db, "households/h/expenses", y.id!)));
  await assertFails(
    updateDoc(doc(db, "households/h/settlements/start"), { amountYen: 1 }),
  );
  await assertFails(deleteDoc(doc(db, "households/h/settlements/start")));
  const back = await cmd("alice", {
    ...expense(300),
    occurredAt: "2025-01-01",
  });
  expect(
    (await getDoc(doc(db, "households/h/expenses", back.id!))).data()?.cycleId,
  ).toBe(home.currentCycleId);
});
it("rejects a forged settlement and reset without a settlement record", async () => {
  await cmd("alice", expense());
  const db = database("alice"),
    before = await h();
  await assertFails(
    updateDoc(doc(db, "households/h"), {
      revision: before.revision + 1,
      currentCycleId: "new",
      currentPaidTotals: { alice: 0, bob: 0 },
      mutation: { kind: "settle", id: "start" },
    }),
  );
  const batch = writeBatch(db);
  batch.set(doc(db, "households/h/settlements/start"), {
    cycleId: "start",
    fromUid: "alice",
    toUid: "bob",
    amountYen: 1,
    settledAt: serverTimestamp(),
    paidTotalsSnapshot: before.currentPaidTotals,
  });
  batch.update(doc(db, "households/h"), {
    revision: before.revision + 1,
    currentCycleId: "new",
    currentPaidTotals: { alice: 0, bob: 0 },
    mutation: { kind: "settle", id: "start" },
  });
  await assertFails(batch.commit());
});
it("rejects a stale confirmation", async () => {
  await cmd("alice", expense());
  const p = await cmd("alice", { action: "preview" });
  await cmd("bob", expense(1, "bob"));
  await expect(
    cmd("alice", {
      action: "settle",
      revision: p.revision,
      cycleId: p.cycleId,
    }),
  ).rejects.toThrow(/変更/);
});
it("concurrent additions serialize and preserve totals", async () => {
  await Promise.all([
    cmd("alice", expense(200)),
    cmd("bob", expense(100, "bob")),
  ]);
  expect((await h()).currentPaidTotals).toEqual({ alice: 200, bob: 100 });
});
it("concurrent settlement and addition leave every expense in a valid cycle", async () => {
  await cmd("alice", expense(200));
  const p = await cmd("alice", { action: "preview" });
  const results = await Promise.allSettled([
    cmd("alice", {
      action: "settle",
      revision: p.revision,
      cycleId: p.cycleId,
    }),
    cmd("bob", expense(20, "bob")),
  ]);
  expect(results[1].status).toBe("fulfilled");
  const db = database("alice"),
    home = await h(),
    items = (await getDocs(collection(db, "households/h/expenses"))).docs.map(
      (d) => d.data(),
    ),
    settled = (
      await getDocs(collection(db, "households/h/settlements"))
    ).docs.map((d) => d.id);
  for (const e of items)
    expect(
      e.cycleId === home.currentCycleId || settled.includes(e.cycleId),
    ).toBe(true);
  for (const uid of ["alice", "bob"])
    expect(home.currentPaidTotals[uid]).toBe(
      items
        .filter(
          (e) =>
            !e.deleted &&
            e.cycleId === home.currentCycleId &&
            e.payerUid === uid,
        )
        .reduce((n, e) => n + e.amountYen, 0),
    );
}, 30000);
it("rejects invalid input even if a modified client bypasses all UI validation", async () => {
  const db = database("alice");
  for (const bad of [
    { amountYen: 0 },
    { amountYen: -1 },
    { amountYen: 1.5 },
    { amountYen: 100000001 },
    { payerUid: "mallory" },
    { createdByUid: "bob" },
    { title: "  " },
    { title: "x".repeat(121) },
    { occurredAt: "2026-02-30" },
    { occurredAt: "2026-02-29" },
    { occurredAt: "0000-01-01" },
    { cycleId: "old" },
    { extra: "injected" },
    { deleted: true },
  ]) {
    const batch = writeBatch(db);
    batch.set(doc(db, "households/h/expenses/raw"), {
      title: "入力検証",
      amountYen: 10,
      payerUid: "alice",
      occurredAt: "2026-01-01",
      cycleId: "start",
      createdByUid: "alice",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deleted: false,
      ...bad,
    });
    batch.update(doc(db, "households/h"), {
      revision: 1,
      mutation: { kind: "expense", id: "raw" },
      currentPaidTotals: {
        alice: "amountYen" in bad ? bad.amountYen : 10,
        bob: 0,
      },
    });
    await assertFails(batch.commit());
  }
  await cmd("alice", { ...expense(10), occurredAt: "2024-02-29" });
});
it("rejects resurrection and a forged delete that also changes the amount", async () => {
  const db = database("alice"),
    x = await cmd("alice", expense(100));
  let before = await h();
  let batch = writeBatch(db);
  batch.update(doc(db, "households/h/expenses", x.id!), {
    deleted: true,
    amountYen: 1,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, "households/h"), {
    revision: before.revision + 1,
    mutation: { kind: "expense", id: x.id },
    currentPaidTotals: { alice: 0, bob: 0 },
  });
  await assertFails(batch.commit());
  await cmd("bob", { action: "delete", id: x.id });
  before = await h();
  batch = writeBatch(db);
  batch.update(doc(db, "households/h/expenses", x.id!), {
    deleted: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, "households/h"), {
    revision: before.revision + 1,
    mutation: { kind: "expense", id: x.id },
    currentPaidTotals: { alice: 100, bob: 0 },
  });
  await assertFails(batch.commit());
});
it("checks opposite payment direction, rejects zero settlement and closed-cycle reuse", async () => {
  await cmd("bob", expense(44485, "bob"));
  let p = await cmd("alice", { action: "preview" });
  expect(p).toMatchObject({ fromUid: "alice", toUid: "bob", amountYen: 22242 });
  await cmd("alice", {
    action: "settle",
    cycleId: p.cycleId,
    revision: p.revision,
  });
  await expect(
    cmd("alice", {
      action: "settle",
      cycleId: (await h()).currentCycleId,
      revision: (await h()).revision,
    }),
  ).rejects.toThrow(/金額/);
  await cmd("alice", expense(100));
  const db = database("alice"),
    before = await h(),
    batch = writeBatch(db);
  batch.set(doc(db, "households/h/settlements", before.currentCycleId), {
    cycleId: before.currentCycleId,
    fromUid: "bob",
    toUid: "alice",
    amountYen: 50,
    settledAt: serverTimestamp(),
    paidTotalsSnapshot: before.currentPaidTotals,
  });
  batch.update(doc(db, "households/h"), {
    revision: before.revision + 1,
    mutation: { kind: "settle", id: before.currentCycleId },
    currentCycleId: "start",
    currentPaidTotals: { alice: 0, bob: 0 },
  });
  await assertFails(batch.commit());
});

// Attacks below bypass execute() and submit valid-looking writes directly.
const rawExpense = (overrides: Record<string, unknown> = {}) => ({
  title: "直接操作",
  amountYen: 100,
  payerUid: "alice",
  occurredAt: "2026-01-01",
  cycleId: "start",
  createdByUid: "alice",
  deleted: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});
it("denies anonymous get, list, create, update and delete on every protected collection", async () => {
  const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
  const id = (await cmd("alice", expense(100))).id!;
  await cmd("alice", {
    action: "settle",
    revision: (await h()).revision,
    cycleId: "start",
  });
  for (const path of [
    "users/alice",
    "households/h",
    `households/h/expenses/${id}`,
    "households/h/settlements/start",
    "invites/token",
    "unknown/document",
  ]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), { value: "unauthorized" }));
    await assertFails(updateDoc(doc(db, path), { value: "unauthorized" }));
    await assertFails(deleteDoc(doc(db, path)));
  }
  for (const path of [
    "users",
    "households",
    "households/h/expenses",
    "households/h/settlements",
    "invites",
  ])
    await assertFails(getDocs(collection(db, path)));
});
it("denies cross-household list and atomic writes from a member of another household", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "households/other"), {
      ...initial,
      memberUids: ["mallory", "eve"],
      names: { mallory: "M", eve: "E" },
      currentPaidTotals: { mallory: 0, eve: 0 },
    });
    await setDoc(doc(c.firestore(), "users/mallory"), { householdId: "other" });
  });
  const db = database("mallory");
  await assertSucceeds(getDoc(doc(db, "households/other")));
  for (const path of ["households/h/expenses", "households/h/settlements"])
    await assertFails(getDocs(collection(db, path)));
  const batch = writeBatch(db);
  batch.set(
    doc(db, "households/h/expenses/cross"),
    rawExpense({ createdByUid: "mallory" }),
  );
  batch.update(doc(db, "households/h"), {
    revision: 1,
    mutation: { kind: "expense", id: "cross" },
    currentPaidTotals: { alice: 100, bob: 0 },
  });
  await assertFails(batch.commit());
  await assertFails(
    updateDoc(doc(db, "households/h"), {
      revision: 1,
      names: { alice: "侵入", bob: "たくと" },
      mutation: { kind: "rename", id: "mallory" },
    }),
  );
  expect((await h()).revision).toBe(0);
});
it.each([
  ["replace", { memberUids: ["alice", "mallory"] }],
  ["add third", { memberUids: ["alice", "bob", "mallory"] }],
  ["remove", { memberUids: ["alice"] }],
  ["reorder", { memberUids: ["bob", "alice"] }],
  ["duplicate", { memberUids: ["alice", "alice"] }],
])(
  "blocks memberUids change even alongside a valid rename: %s",
  async (_, change) => {
    await assertFails(
      updateDoc(doc(database("alice"), "households/h"), {
        ...change,
        revision: 1,
        names: initial.names,
        mutation: { kind: "rename", id: "alice" },
      }),
    );
    expect((await h()).memberUids).toEqual(["alice", "bob"]);
  },
);
it("rejects valid-looking amount and payer edits with stale or one-sided totals", async () => {
  const db = database("alice"),
    x = await cmd("alice", expense(100)),
    before = await h();
  for (const [change, totals] of [
    [{ amountYen: 200 }, { alice: 100, bob: 0 }],
    [{ payerUid: "bob" }, { alice: 100, bob: 0 }],
    [{ payerUid: "bob" }, { alice: 0, bob: 0 }],
    [{ payerUid: "mallory" }, { alice: 0, bob: 100 }],
    [{ amountYen: 200 }, { alice: 200, bob: 0, extra: 1 }],
    [{ amountYen: 200 }, { alice: 200, bob: -1 }],
  ] as [Record<string, unknown>, Record<string, number>][]) {
    const batch = writeBatch(db);
    batch.update(doc(db, "households/h/expenses", x.id!), {
      ...change,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "households/h"), {
      revision: before.revision + 1,
      mutation: { kind: "expense", id: x.id },
      currentPaidTotals: totals,
    });
    await assertFails(batch.commit());
  }
  expect((await h()).currentPaidTotals).toEqual({ alice: 100, bob: 0 });
  expect(
    (await getDoc(doc(db, "households/h/expenses", x.id!))).data()?.payerUid,
  ).toBe("alice");
  // A genuine unpaid correction with both totals adjusted remains allowed.
  await cmd("bob", { ...expense(200, "bob"), action: "edit", id: x.id });
  expect((await h()).currentPaidTotals).toEqual({ alice: 0, bob: 200 });
});
it("rejects closed expense migration and deletion even with a matching aggregate batch", async () => {
  const x = await cmd("alice", expense(100));
  await cmd("alice", {
    action: "settle",
    cycleId: "start",
    revision: (await h()).revision,
  });
  await cmd("alice", expense(200));
  const before = await h(),
    db = database("alice");
  for (const change of [
    { cycleId: before.currentCycleId, amountYen: 200 },
    { deleted: true },
  ]) {
    const batch = writeBatch(db);
    batch.update(doc(db, "households/h/expenses", x.id!), {
      ...change,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "households/h"), {
      revision: before.revision + 1,
      mutation: { kind: "expense", id: x.id },
      currentPaidTotals: { alice: "deleted" in change ? 100 : 300, bob: 0 },
    });
    await assertFails(batch.commit());
  }
  expect(
    (await getDoc(doc(db, "households/h/expenses", x.id!))).data()?.cycleId,
  ).toBe("start");
});
it("independently rejects forged settlement fields, revisions, cycles and partial resets", async () => {
  await cmd("alice", expense(101));
  const db = database("alice"),
    before = await h();
  const valid = {
    cycleId: "start",
    fromUid: "bob",
    toUid: "alice",
    amountYen: 50,
    settledAt: serverTimestamp(),
    paidTotalsSnapshot: before.currentPaidTotals,
  };
  const update = {
    revision: before.revision + 1,
    mutation: { kind: "settle", id: "start" },
    currentCycleId: "next",
    currentPaidTotals: { alice: 0, bob: 0 },
  };
  const attacks: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ amountYen: 51 }, {}],
    [{ fromUid: "alice", toUid: "bob" }, {}],
    [{ fromUid: "mallory" }, {}],
    [{ paidTotalsSnapshot: { alice: 100, bob: 0 } }, {}],
    [{ cycleId: "different" }, {}],
    [{ settledAt: new Date(0) }, {}],
    [{ extra: true }, {}],
    [{}, { currentPaidTotals: { alice: 1, bob: 0 } }],
    [{}, { currentPaidTotals: { alice: 0, bob: 1 } }],
    [{}, { currentCycleId: "start" }],
    [{}, { currentCycleId: "bad/path" }],
    [{}, { revision: before.revision }],
    [{}, { revision: before.revision + 2 }],
  ];
  for (const [record, home] of attacks) {
    const batch = writeBatch(db);
    batch.set(doc(db, "households/h/settlements/start"), {
      ...valid,
      ...record,
    });
    batch.update(doc(db, "households/h"), { ...update, ...home });
    await assertFails(batch.commit());
  }
  expect((await h()).currentCycleId).toBe("start");
  expect(
    (await getDoc(doc(db, "households/h/settlements/start"))).exists(),
  ).toBe(false);
});
it("cannot combine a settlement with a hidden expense in the same batch", async () => {
  await cmd("alice", expense(100));
  const db = database("alice"),
    before = await h(),
    batch = writeBatch(db);
  batch.set(
    doc(db, "households/h/expenses/hidden"),
    rawExpense({ cycleId: "new" }),
  );
  batch.set(doc(db, "households/h/settlements/start"), {
    cycleId: "start",
    fromUid: "bob",
    toUid: "alice",
    amountYen: 50,
    settledAt: serverTimestamp(),
    paidTotalsSnapshot: before.currentPaidTotals,
  });
  batch.update(doc(db, "households/h"), {
    revision: before.revision + 1,
    mutation: { kind: "settle", id: "start" },
    currentCycleId: "new",
    currentPaidTotals: { alice: 0, bob: 0 },
  });
  await assertFails(batch.commit());
});
it("concurrent settlement confirms exactly one record and no double close", async () => {
  await cmd("alice", expense(100));
  const p = await cmd("alice", { action: "preview" });
  const results = await Promise.allSettled(
    ["alice", "bob"].map((uid) =>
      cmd(uid, { action: "settle", cycleId: p.cycleId, revision: p.revision }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await getDocs(collection(database("alice"), "households/h/settlements")))
      .size,
  ).toBe(1);
  expect((await h()).currentPaidTotals).toEqual({ alice: 0, bob: 0 });
}, 30000);
it("fails closed when manual membership provisioning duplicates a UID", async () => {
  await env.withSecurityRulesDisabled(async (c) =>
    setDoc(doc(c.firestore(), "households/h"), {
      ...initial,
      memberUids: ["alice", "alice"],
      names: { alice: "A" },
      currentPaidTotals: { alice: 0 },
    }),
  );
  await assertFails(
    updateDoc(doc(database("alice"), "households/h"), {
      revision: 1,
      names: { alice: "変更" },
      mutation: { kind: "rename", id: "alice" },
    }),
  );
});
it("denies a fully consistent unpaid edit by an outsider or anonymous client", async () => {
  const x = await cmd("alice", expense(100)),
    before = await h();
  for (const db of [
    database("mallory"),
    env.unauthenticatedContext().firestore() as unknown as Firestore,
  ]) {
    const batch = writeBatch(db);
    batch.update(doc(db, "households/h/expenses", x.id!), {
      amountYen: 200,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "households/h"), {
      revision: before.revision + 1,
      mutation: { kind: "expense", id: x.id },
      currentPaidTotals: { alice: 200, bob: 0 },
    });
    await assertFails(batch.commit());
  }
  expect((await h()).currentPaidTotals).toEqual({ alice: 100, bob: 0 });
});
