// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
const mock = vi.hoisted(() => ({
  command: vi.fn(),
  home: {
    memberUids: ["a", "b"],
    names: { a: "みーみ", b: "たくと" },
    currentCycleId: "now",
    currentPaidTotals: { a: 100000, b: 60000 },
    revision: 2,
  },
  items: [
    {
      id: "e",
      title: "電気9月",
      amountYen: 100000,
      payerUid: "a",
      occurredAt: "2026-09-01",
      cycleId: "now",
      createdAt: { seconds: 20 },
    },
    {
      id: "old",
      title: "電気8月",
      amountYen: 10000,
      payerUid: "b",
      occurredAt: "2026-08-01",
      cycleId: "closed",
      createdAt: { seconds: 10 },
    },
  ],
  settled: [
    {
      id: "closed",
      cycleId: "closed",
      fromUid: "a",
      toUid: "b",
      amountYen: 5000,
      settledAt: { seconds: 1790000000 },
      paidTotalsSnapshot: { a: 0, b: 10000 },
    },
  ],
}));
vi.mock("../src/firebase", () => ({
  auth: {},
  db: {},
  configured: true,
  command: mock.command,
}));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_: unknown, cb: Function) => {
    cb({ uid: "a", email: "a@example.test" });
    return () => {};
  },
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  doc: (_: unknown, ...s: string[]) => s.join("/"),
  collection: (_: unknown, ...s: string[]) => s.join("/"),
  onSnapshot: (path: string, cb: Function) => {
    if (path === "users/a")
      cb({ exists: () => true, data: () => ({ householdId: "h" }) });
    else if (path === "households/h")
      cb({ exists: () => true, data: () => mock.home });
    else
      cb({
        docs: (path.endsWith("expenses") ? mock.items : mock.settled).map(
          (x) => ({ id: x.id, data: () => x }),
        ),
      });
    return () => {};
  },
}));
beforeEach(() => {
  mock.command.mockReset();
  localStorage.clear();
});
afterEach(cleanup);
it("shows a human-readable balance and registers an expense with previous match", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByText("たくと → みーみ")).toBeTruthy();
  expect(screen.getByText("20,000円")).toBeTruthy();
  await user.click(screen.getByLabelText("立替を登録"));
  await user.type(screen.getByLabelText("件名"), "電気");
  expect(screen.getByText("前回の登録")).toBeTruthy();
  expect(screen.getByText(/電気9月\s+100,000円/)).toBeTruthy();
  await user.type(screen.getByLabelText("金額（円）"), "9840");
  mock.command.mockResolvedValue({ id: "new" });
  await user.click(screen.getByRole("button", { name: "登録する" }));
  await waitFor(() =>
    expect(mock.command).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "add",
        title: "電気",
        amountYen: 9840,
        payerUid: "a",
      }),
    ),
  );
  expect(await screen.findByRole("status")).toBeTruthy();
});
it("keeps settled items immutable and preserves settlement boundaries during search", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "履歴" }));
  await user.type(screen.getByRole("searchbox"), "電気8月");
  expect(screen.queryByText("電気9月")).toBeNull();
  expect(screen.getByText(/まとめて精算/)).toBeTruthy();
  await user.click(screen.getByText("電気8月"));
  expect(screen.getByText("✓ 精算済み")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "編集する" })).toBeNull();
  expect(screen.queryByRole("button", { name: "削除する" })).toBeNull();
});
it("uses authoritative confirmation and never reports a failed settlement as successful", async () => {
  const user = userEvent.setup();
  render(<App />);
  mock.command.mockResolvedValueOnce({
    fromUid: "b",
    toUid: "a",
    amountYen: 20000,
    cycleId: "now",
    revision: 2,
    items: [mock.items[0]],
  });
  await user.click(await screen.findByRole("button", { name: "まとめて精算" }));
  await screen.findByRole("button", { name: "20,000円を精算済みにする" });
  mock.command.mockRejectedValueOnce(
    new Error("明細が変更されました。内容を再確認してください"),
  );
  await user.click(
    screen.getByRole("button", { name: "20,000円を精算済みにする" }),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(mock.command).toHaveBeenLastCalledWith({
    action: "settle",
    revision: 2,
    cycleId: "now",
  });
});
it("keeps form input after a failed save", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByLabelText("立替を登録"));
  await user.type(screen.getByLabelText("件名"), "通信失敗");
  await user.type(screen.getByLabelText("金額（円）"), "100");
  mock.command.mockRejectedValue(new Error("登録できませんでした"));
  await user.click(screen.getByRole("button", { name: "登録する" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("件名") as HTMLInputElement).value).toBe(
    "通信失敗",
  );
  expect(screen.queryByRole("status")).toBeNull();
});
