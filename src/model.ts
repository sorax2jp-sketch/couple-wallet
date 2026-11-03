export interface Expense {
  deleted?: boolean;
  id: string;
  title: string;
  amountYen: number;
  payerUid: string;
  occurredAt: string;
  cycleId: string;
  createdAt?: { seconds: number };
}
export interface Home {
  memberUids: string[];
  names: Record<string, string>;
  currentCycleId: string;
  currentPaidTotals: Record<string, number>;
  revision: number;
}
export interface Settlement {
  id: string;
  cycleId: string;
  fromUid: string;
  toUid: string;
  amountYen: number;
  settledAt?: { seconds: number };
  paidTotalsSnapshot: Record<string, number>;
}
export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
export function balance(h: Home) {
  const [a, b] = h.memberUids;
  const diff = (h.currentPaidTotals[a] || 0) - (h.currentPaidTotals[b] || 0);
  return {
    fromUid: diff > 0 ? b : a,
    toUid: diff > 0 ? a : b,
    amountYen: Math.floor(Math.abs(diff) / 2),
  };
}
export const byDate = (a: Expense, b: Expense) =>
  b.occurredAt.localeCompare(a.occurredAt) ||
  (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
export function previous(items: Expense[], title: string, exclude?: string) {
  return title.trim()
    ? items
        .filter(
          (x) =>
            x.id !== exclude &&
            x.title
              .toLocaleLowerCase()
              .includes(title.trim().toLocaleLowerCase()),
        )
        .sort(
          (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
        )[0]
    : undefined;
}
export function matches(
  x: Expense,
  h: Home,
  q: string,
  payer: string,
  from: string,
  to: string,
) {
  const text = q.trim().toLocaleLowerCase().replace(/,/g, "");
  return (
    (!text ||
      [x.title, String(x.amountYen), h.names[x.payerUid]].some((v) =>
        v?.toLocaleLowerCase().includes(text),
      )) &&
    (!payer || x.payerUid === payer) &&
    (!from || x.occurredAt >= from) &&
    (!to || x.occurredAt <= to)
  );
}
