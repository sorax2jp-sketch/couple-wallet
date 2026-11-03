import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
  runTransaction,
  serverTimestamp,
  Firestore,
  DocumentData,
} from "firebase/firestore";
import { balance, Home, Expense } from "./model";
import { validateExpense } from "./domain";
export interface CommandResult {
  code?: string;
  id?: string;
  revision: number;
  cycleId: string;
  amountYen: number;
  fromUid: string;
  toUid: string;
  items: Expense[];
}
export async function execute(
  db: Firestore,
  uid: string,
  data: Record<string, unknown>,
): Promise<CommandResult> {
  const mapping = await getDocFromServer(doc(db, "users", uid));
  if (!mapping.exists())
    throw new Error(
      "メンバー登録が必要です。READMEの初期連携手順を確認してください",
    );
  const ref = doc(db, "households", mapping.data().householdId);
  if (data.action === "preview") {
    for (let attempt = 0; attempt < 3; attempt++) {
      const first = await getDocFromServer(ref),
        h = first.data() as Home;
      const items = await getDocsFromServer(
        query(
          collection(ref, "expenses"),
          where("cycleId", "==", h.currentCycleId),
        ),
      );
      const after = await getDocFromServer(ref);
      if (after.data()?.revision === h.revision)
        return {
          ...balance(h),
          revision: h.revision,
          cycleId: h.currentCycleId,
          items: items.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Expense)
            .filter((e) => !e.deleted),
        };
    }
    throw new Error("明細が変更されました。内容を再確認してください");
  }
  const expenseRef =
    data.action === "add"
      ? doc(collection(ref, "expenses"))
      : typeof data.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(data.id)
        ? doc(ref, "expenses", data.id)
        : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    let attemptedRevision = -1;
    try {
      return await runTransaction(db, async (tx) => {
        const snapshot = await tx.get(ref),
          h = snapshot.data() as Home;
        if (!h || h.memberUids.length !== 2 || !h.memberUids.includes(uid))
          throw new Error("この家計にアクセスできません");
        attemptedRevision = h.revision;
        const revision = h.revision + 1;
        if (data.action === "rename") {
          if (
            typeof data.name !== "string" ||
            !data.name.trim() ||
            data.name.trim().length > 30
          )
            throw new Error("表示名は1〜30文字にしてください");
          tx.update(ref, {
            names: { ...h.names, [uid]: data.name.trim() },
            revision,
            mutation: { kind: "rename", id: uid },
          });
        } else if (data.action === "settle") {
          if (data.revision !== h.revision || data.cycleId !== h.currentCycleId)
            throw new Error("明細が変更されました。内容を再確認してください");
          const due = balance(h);
          if (due.amountYen < 1) throw new Error("精算する金額がありません");
          tx.set(doc(ref, "settlements", h.currentCycleId), {
            ...due,
            cycleId: h.currentCycleId,
            settledAt: serverTimestamp(),
            paidTotalsSnapshot: h.currentPaidTotals,
          });
          tx.update(ref, {
            revision,
            mutation: { kind: "settle", id: h.currentCycleId },
            currentCycleId: doc(collection(db, "_ids")).id,
            currentPaidTotals: Object.fromEntries(
              h.memberUids.map((id) => [id, 0]),
            ),
          });
        } else if (
          ["add", "edit", "delete"].includes(String(data.action)) &&
          expenseRef
        ) {
          let old: DocumentData | undefined;
          if (data.action !== "add") {
            old = (await tx.get(expenseRef)).data();
            if (!old || old.deleted || old.cycleId !== h.currentCycleId)
              throw new Error("精算済み、削除済み、または存在しない明細です");
          }
          const totals = { ...h.currentPaidTotals };
          if (old) totals[old.payerUid] -= old.amountYen;
          if (data.action === "delete")
            tx.update(expenseRef, {
              deleted: true,
              updatedAt: serverTimestamp(),
            });
          else {
            const valid = validateExpense(data, h.memberUids);
            totals[valid.payerUid] += valid.amountYen;
            if (!Number.isSafeInteger(totals[valid.payerUid]))
              throw new Error("合計金額が大きすぎます");
            tx.set(expenseRef, {
              ...valid,
              cycleId: h.currentCycleId,
              createdByUid: old?.createdByUid ?? uid,
              createdAt: old?.createdAt ?? serverTimestamp(),
              updatedAt: serverTimestamp(),
              deleted: false,
            });
          }
          tx.update(ref, {
            revision,
            mutation: { kind: "expense", id: expenseRef.id },
            currentPaidTotals: totals,
          });
        } else throw new Error("操作が正しくありません");
        return { id: expenseRef?.id } as CommandResult;
      });
    } catch (error) {
      // Rules may observe a competing commit before the SDK reports a conflict.
      // Retry only after proving the shared revision changed; never bypass Rules.
      if (
        data.action !== "settle" &&
        (error as { code?: string }).code === "permission-denied" &&
        attempt < 4
      ) {
        const latest = await getDocFromServer(ref);
        if (latest.data()?.revision !== attemptedRevision) continue;
      }
      throw error;
    }
  }
  throw new Error("同時更新が続いています。少し待って再度お試しください");
}
