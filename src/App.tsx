import { ExpenseList } from "./ExpenseList";
import { ExpenseForm } from "./ExpenseForm";
import React, { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  User,
} from "firebase/auth";
import { doc, onSnapshot, collection } from "firebase/firestore";
import { auth, db, configured, command } from "./firebase";
import {
  Home,
  Expense,
  Settlement,
  yen,
  today,
  balance,
  byDate,
  previous,
  matches,
} from "./model";
import "./style.css";
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(false),
    [home, setHome] = useState<Home | null>(null),
    [hid, setHid] = useState<string | null | undefined>(undefined),
    [expenses, setExpenses] = useState<Expense[]>([]),
    [settlements, setSettlements] = useState<Settlement[]>([]),
    [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("home"),
    [screen, setScreen] = useState(""),
    [selected, setSelected] = useState<Expense | null>(null),
    [chosen, setChosen] = useState<Settlement | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [title, setTitle] = useState(""),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(today()),
    [payer, setPayer] = useState(""),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [confirmation, setConfirmation] = useState<{
    revision: number;
    cycleId: string;
    amountYen: number;
    fromUid: string;
    toUid: string;
    items: Expense[];
  } | null>(null);
  useEffect(
    () =>
      configured
        ? onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthReady(true);
            setHid(undefined);
            setHome(null);
            setExpenses([]);
            setSettlements([]);
            setLoaded(false);
            setScreen("");
          })
        : undefined,
    [],
  );
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, "users", user.uid),
      (s) => setHid(s.exists() ? s.data().householdId : null),
      () => setError("家計への接続に失敗しました。再読み込みしてください"),
    );
  }, [user]);
  useEffect(() => {
    if (!hid) return;
    let a = false,
      b = false;
    const stops = [
      onSnapshot(
        doc(db, "households", hid),
        (s) => setHome(s.exists() ? (s.data() as Home) : null),
        () => setError("家計を読み込めません"),
      ),
      onSnapshot(
        collection(db, "households", hid, "expenses"),
        (s) => {
          setExpenses(
            s.docs
              .map((d) => ({ id: d.id, ...d.data() }) as Expense)
              .filter((x) => !x.deleted),
          );
          a = true;
          setLoaded(a && b);
        },
        () => setError("明細を読み込めません"),
      ),
      onSnapshot(
        collection(db, "households", hid, "settlements"),
        (s) => {
          setSettlements(
            s.docs
              .map((d) => ({ id: d.id, ...d.data() }) as Settlement)
              .sort(
                (a, b) =>
                  (b.settledAt?.seconds ?? 0) - (a.settledAt?.seconds ?? 0),
              ),
          );
          b = true;
          setLoaded(a && b);
        },
        () => setError("精算履歴を読み込めません"),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [hid]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "操作に失敗しました";
      setError(
        raw.includes("auth/")
          ? "認証に失敗しました。メールアドレス・パスワード・通信状態を確認してください。"
          : raw,
      );
    } finally {
      setBusy(false);
    }
  }
  function openForm(x: Expense | null = null) {
    setSelected(x);
    setTitle(x?.title ?? "");
    setAmount(x ? String(x.amountYen) : "");
    setDate(x?.occurredAt ?? today());
    const last = localStorage.getItem("lastPayer");
    setPayer(
      x?.payerUid ??
        (home?.memberUids.includes(last ?? "") ? last! : user!.uid),
    );
    setScreen("form");
  }
  const current = home
    ? expenses.filter((x) => x.cycleId === home.currentCycleId).sort(byDate)
    : [];
  const due = home ? balance(home) : null;
  const last = previous(expenses, title, selected?.id);
  const route = (r: { fromUid: string; toUid: string }) =>
    home ? `${home.names[r.fromUid]} → ${home.names[r.toUid]}` : "";
  const settledDate = (s: Settlement) =>
    s.settledAt
      ? new Date(s.settledAt.seconds * 1000).toLocaleDateString("ja-JP", {
          timeZone: "Asia/Tokyo",
        })
      : "処理中";
  const rows = (items: Expense[]) => (
    <ExpenseList
      items={items}
      names={home?.names ?? {}}
      onSelect={(x) => {
        setSelected(x);
        setScreen("detail");
      }}
    />
  );
  const submitExpense = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await command({
        action: selected ? "edit" : "add",
        id: selected?.id,
        title,
        amountYen: Number(amount),
        payerUid: payer,
        occurredAt: date,
      });
      localStorage.setItem("lastPayer", payer);
      setScreen("");
      setTab("home");
      setNotice(
        `${title} ${yen(Number(amount))}を${selected ? "更新" : "登録"}しました`,
      );
    });
  };
  if (!configured)
    return (
      <main className="setup">
        <div className="brand">◒ ふたりの立替</div>
        <h1>接続設定が必要です</h1>
        <p>
          Firebase の設定後、この端末とパートナーの端末で立替を共有できます。
        </p>
        <p>
          README の手順で .env.local を設定してください。ローカル検証には
          Firebase Emulator を利用できます。
        </p>
      </main>
    );
  return (
    <div className="app">
      <header>
        <span className="brand">◒ ふたりの立替</span>
        <span className="version">Ver.1</span>
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
          <button aria-label="エラーを閉じる" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="toast">
          ✓ {notice}
        </div>
      )}
      {!authReady ? (
        <p className="empty">読み込み中…</p>
      ) : !user ? (
        <main>
          <h1>おかえりなさい</h1>
          <p className="muted">ふたりの立替を、すっきりと。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await signInWithEmailAndPassword(auth, email, password);
              });
            }}
          >
            <label>
              メールアドレス
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              パスワード
              <input
                type="password"
                minLength={6}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              ログイン
            </button>
          </form>
          <button
            className="text"
            disabled={busy || !email}
            onClick={() =>
              void run(async () => {
                await sendPasswordResetEmail(auth, email);
                setNotice("再設定メールを送信しました");
              })
            }
          >
            パスワードを再設定
          </button>
        </main>
      ) : hid === undefined ? (
        <p className="empty">家計を確認中…</p>
      ) : hid === null ? (
        <main>
          <h1>メンバー登録を確認してください</h1>
          <p>
            このアプリは、あらかじめ登録した2人だけが利用できます。登録済みのアカウントでログインしてください。
          </p>
          <button
            className="text"
            onClick={() =>
              void run(async () => {
                await signOut(auth);
              })
            }
          >
            ログアウト
          </button>
        </main>
      ) : !home || !loaded ? (
        <p className="empty">データを読み込み中…</p>
      ) : (
        <>
          <main>
            {screen && (
              <button
                className="back"
                disabled={busy}
                onClick={() => {
                  setScreen("");
                  setSelected(null);
                }}
              >
                ‹ 戻る
              </button>
            )}
            {screen === "form" ? (
              <ExpenseForm
                home={home}
                selected={selected}
                title={title}
                amount={amount}
                date={date}
                payer={payer}
                last={last}
                busy={busy}
                setTitle={setTitle}
                setAmount={setAmount}
                setDate={setDate}
                setPayer={setPayer}
                onSubmit={submitExpense}
              />
            ) : screen === "detail" && selected ? (
              <>
                <h1>{selected.title}</h1>
                <div className="large">{yen(selected.amountYen)}</div>
                <p>{home.names[selected.payerUid]} が支払い</p>
                <p>{selected.occurredAt}</p>
                {selected.cycleId === home.currentCycleId ? (
                  <>
                    <span className="badge">未精算</span>
                    <button
                      className="primary"
                      onClick={() => openForm(selected)}
                    >
                      編集する
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("この立替を削除しますか？"))
                          void run(async () => {
                            await command({
                              action: "delete",
                              id: selected.id,
                            });
                            setScreen("");
                            setNotice("立替を削除しました");
                          });
                      }}
                    >
                      削除する
                    </button>
                  </>
                ) : (
                  <aside>
                    ✓ 精算済み
                    <p>
                      {settlements.find((s) => s.cycleId === selected.cycleId)
                        ? settledDate(
                            settlements.find(
                              (s) => s.cycleId === selected.cycleId,
                            )!,
                          )
                        : ""}{" "}
                      の精算に含まれています
                    </p>
                    <p>
                      修正は現在の立替に「差額調整」として登録してください。
                    </p>
                  </aside>
                )}
              </>
            ) : screen === "confirm" && confirmation ? (
              <>
                <h1>まとめて精算</h1>
                <p className="direction">{route(confirmation)}</p>
                <div className="large">{yen(confirmation.amountYen)}</div>
                <p>この精算に含まれる立替：{confirmation.items.length}件</p>
                <details>
                  <summary>内容を見る</summary>
                  {rows(confirmation.items)}
                </details>
                <p className="muted">
                  実際の送金が済んでから、精算済みにしてください。このアプリは送金を行いません。
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await command({
                        action: "settle",
                        revision: confirmation.revision,
                        cycleId: confirmation.cycleId,
                      });
                      setScreen("");
                      setTab("home");
                      setNotice("精算が完了しました");
                    })
                  }
                >
                  {busy
                    ? "精算中…"
                    : `${yen(confirmation.amountYen)}を精算済みにする`}
                </button>
                <button onClick={() => setScreen("")}>キャンセル</button>
              </>
            ) : screen === "settlement" && chosen ? (
              <>
                <h1>{settledDate(chosen)} の精算</h1>
                <p className="direction">{route(chosen)}</p>
                <div className="large">{yen(chosen.amountYen)}</div>
                <p>
                  対象立替{" "}
                  {expenses.filter((x) => x.cycleId === chosen.cycleId).length}
                  件
                </p>
                <aside>
                  {home.memberUids.map((id) => (
                    <p key={id}>
                      {home.names[id]} の支払総額：
                      {yen(chosen.paidTotalsSnapshot[id] || 0)}
                    </p>
                  ))}
                </aside>
                <h2>対象の明細</h2>
                {rows(
                  expenses
                    .filter((x) => x.cycleId === chosen.cycleId)
                    .sort(byDate),
                )}
              </>
            ) : tab === "home" ? (
              <>
                <p className="eyebrow">CURRENT BALANCE</p>
                <h1>現在の精算</h1>
                {home.memberUids.length < 2 ? (
                  <section className="balance">
                    <h2>メンバー登録を確認してください</h2>
                    <p>この家計は2人の初期登録が必要です。</p>
                    <button onClick={() => setTab("settings")}>設定へ</button>
                  </section>
                ) : (
                  <section className="balance">
                    <div className="balance-icon">↔</div>
                    {due!.amountYen > 0 ? (
                      <>
                        <p className="direction">{route(due!)}</p>
                        <div className="large">{yen(due!.amountYen)}</div>
                        <p className="muted">支払額の差を50:50で精算</p>
                      </>
                    ) : (
                      <h2>現在、精算はありません</h2>
                    )}
                    <button
                      className="primary"
                      disabled={busy || due!.amountYen < 1}
                      onClick={() =>
                        void run(async () => {
                          const preview = await command({ action: "preview" });
                          setConfirmation({
                            ...preview,
                            items: preview.items.sort(byDate),
                          });
                          setScreen("confirm");
                        })
                      }
                    >
                      まとめて精算
                    </button>
                  </section>
                )}
                <div className="totals">
                  {home.memberUids.map((id) => (
                    <div key={id}>
                      <small>{home.names[id]} の支払合計</small>
                      <strong>{yen(home.currentPaidTotals[id] || 0)}</strong>
                    </div>
                  ))}
                </div>
                <div className="heading">
                  <h2>未精算の立替</h2>
                  <span>{current.length}件</span>
                </div>
                {rows(current.slice(0, 5))}
                {current.length > 5 && (
                  <button className="text" onClick={() => setTab("history")}>
                    履歴ですべて見る
                  </button>
                )}
              </>
            ) : tab === "history" ? (
              <>
                <h1>履歴</h1>
                <label className="search">
                  検索
                  <input
                    type="search"
                    placeholder="件名・金額・支払った人"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </label>
                <details className="filters">
                  <summary>絞り込み</summary>
                  <label>
                    支払った人
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="">すべて</option>
                      {home.memberUids.map((id) => (
                        <option key={id} value={id}>
                          {home.names[id]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    開始日
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    終了日
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setFilter("");
                      setFrom("");
                      setTo("");
                      setQ("");
                    }}
                  >
                    条件をクリア
                  </button>
                </details>
                <h2>現在の未精算</h2>
                {rows(
                  current.filter((x) => matches(x, home, q, filter, from, to)),
                )}
                {settlements.map((s) => (
                  <section key={s.id}>
                    <button
                      className="settlement"
                      onClick={() => {
                        setChosen(s);
                        setScreen("settlement");
                      }}
                    >
                      <small>✓ {settledDate(s)} まとめて精算</small>
                      <strong>
                        {route(s)}　{yen(s.amountYen)}　›
                      </strong>
                    </button>
                    {rows(
                      expenses
                        .filter(
                          (x) =>
                            x.cycleId === s.cycleId &&
                            matches(x, home, q, filter, from, to),
                        )
                        .sort(byDate),
                    )}
                  </section>
                ))}
              </>
            ) : (
              <>
                <h1>設定</h1>
                <h2>メンバー</h2>
                {home.memberUids.map((id) => (
                  <p key={id}>
                    {home.names[id]}
                    {id === user.uid ? "（あなた）" : ""}
                  </p>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await command({ action: "rename", name });
                      setName("");
                      setNotice("表示名を変更しました");
                    });
                  }}
                >
                  <label>
                    自分の表示名
                    <input
                      maxLength={30}
                      placeholder={home.names[user.uid]}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button disabled={busy || !name.trim()}>表示名を変更</button>
                </form>
                <h2>アカウント</h2>
                <p>{user.email}</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await sendPasswordResetEmail(auth, user.email!);
                      setNotice("パスワード再設定メールを送信しました");
                    })
                  }
                >
                  パスワード変更・再設定
                </button>
                <button
                  className="text danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await signOut(auth);
                    })
                  }
                >
                  ログアウト
                </button>
                <hr />
                <p className="muted">
                  ふたりの立替 Ver.1.0.0
                  <br />
                  夫婦2人のための、50:50の立替精算。
                </p>
              </>
            )}
          </main>
          {!screen && (
            <>
              {tab !== "settings" && home.memberUids.length === 2 && (
                <button
                  className="fab"
                  aria-label="立替を登録"
                  onClick={() => openForm()}
                >
                  ＋
                </button>
              )}
              <nav aria-label="メインナビゲーション">
                {[
                  ["home", "⌂", "ホーム"],
                  ["history", "☷", "履歴"],
                  ["settings", "⚙", "設定"],
                ].map(([id, icon, label]) => (
                  <button
                    key={id}
                    aria-current={tab === id ? "page" : undefined}
                    className={tab === id ? "active" : ""}
                    onClick={() => setTab(id)}
                  >
                    <span aria-hidden="true">{icon}</span>
                    {label}
                  </button>
                ))}
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
