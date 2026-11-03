import { describe, it, expect } from "vitest";
import { settlement, validateExpense } from "../src/domain";
import {
  balance,
  matches,
  previous,
  byDate,
  Home,
  Expense,
} from "../src/model";
const h: Home = {
  memberUids: ["a", "b"],
  names: { a: "みーみ", b: "たくと" },
  currentCycleId: "now",
  currentPaidTotals: { a: 100000, b: 60000 },
  revision: 0,
};
const item: Expense = {
  id: "1",
  title: "電気9月",
  amountYen: 10085,
  payerUid: "a",
  occurredAt: "2026-10-16",
  cycleId: "old",
  createdAt: { seconds: 10 },
};
describe("50:50 settlement", () => {
  it("shows the debtor and creditor", () =>
    expect(settlement(h.currentPaidTotals, h.memberUids)).toEqual({
      fromUid: "b",
      toUid: "a",
      amountYen: 20000,
    }));
  it("floors the absolute difference in both directions", () => {
    expect(balance({ ...h, currentPaidTotals: { a: 0, b: 44485 } })).toEqual({
      fromUid: "a",
      toUid: "b",
      amountYen: 22242,
    });
    expect(
      balance({ ...h, currentPaidTotals: { a: 44485, b: 0 } }).amountYen,
    ).toBe(22242);
  });
  it("handles equal and sub-yen balances", () => {
    expect(settlement({ a: 1, b: 0 }, ["a", "b"]).amountYen).toBe(0);
    expect(balance({ ...h, currentPaidTotals: { a: 0, b: 0 } }).amountYen).toBe(
      0,
    );
  });
});
describe("expense validation", () => {
  it("accepts integer yen and real dates", () =>
    expect(
      validateExpense({ ...item, title: " 電気 " }, ["a", "b"]).title,
    ).toBe("電気"));
  it.each([
    { amountYen: 0 },
    { amountYen: -1 },
    { amountYen: 0.5 },
    { amountYen: 100000001 },
    { payerUid: "outsider" },
    { title: " " },
    { occurredAt: "2026-02-30" },
    { occurredAt: "oops" },
  ])("rejects invalid input %o", (bad) =>
    expect(() => validateExpense({ ...item, ...bad }, ["a", "b"])).toThrow(),
  );
});
describe("history", () => {
  it("finds the last created match across cycles, regardless of expense date", () =>
    expect(
      previous(
        [
          item,
          {
            ...item,
            id: "2",
            occurredAt: "2026-01-01",
            createdAt: { seconds: 20 },
          },
        ],
        "電気",
      )?.id,
    ).toBe("2"));
  it("excludes the edited item", () =>
    expect(previous([item], "電気", "1")).toBeUndefined());
  it("searches title, amount and renamed payer", () => {
    for (const q of ["電気", "10085", "10,085", "みーみ"])
      expect(matches(item, h, q, "", "", "")).toBe(true);
    expect(matches(item, h, "", "b", "", "")).toBe(false);
    expect(matches(item, h, "", "", "2026-11-01", "")).toBe(false);
  });
  it("sorts expense dates within a cycle", () =>
    expect(
      [item, { ...item, id: "2", occurredAt: "2026-09-01" }].sort(byDate)[0].id,
    ).toBe("1"));
});
