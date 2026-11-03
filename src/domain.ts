export function settlement(totals: Record<string, number>, members: string[]) {
  const [a, b] = members;
  const difference = (totals[a] || 0) - (totals[b] || 0);
  return {
    fromUid: difference > 0 ? b : a,
    toUid: difference > 0 ? a : b,
    amountYen: Math.floor(Math.abs(difference) / 2),
  };
}
export function validateExpense(
  data: Record<string, unknown>,
  members: string[],
) {
  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.length > 120
  )
    throw new Error("件名は1〜120文字で入力してください");
  if (
    !Number.isSafeInteger(data.amountYen) ||
    Number(data.amountYen) < 1 ||
    Number(data.amountYen) > 100000000
  )
    throw new Error("金額は1〜100,000,000円の整数にしてください");
  if (typeof data.payerUid !== "string" || !members.includes(data.payerUid))
    throw new Error("支払った人を選んでください");
  if (
    typeof data.occurredAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.occurredAt) ||
    data.occurredAt.startsWith("0000-") ||
    new Date(data.occurredAt).toISOString().slice(0, 10) !== data.occurredAt
  )
    throw new Error("日付が正しくありません");
  return {
    title: data.title.trim(),
    amountYen: Number(data.amountYen),
    payerUid: data.payerUid,
    occurredAt: data.occurredAt,
  };
}
