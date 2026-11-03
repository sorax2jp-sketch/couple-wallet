import { Expense, Home, yen } from "./model";
export interface ExpenseFormProps {
  home: Home;
  selected: Expense | null;
  title: string;
  amount: string;
  date: string;
  payer: string;
  last?: Expense;
  busy: boolean;
  setTitle: (s: string) => void;
  setAmount: (s: string) => void;
  setDate: (s: string) => void;
  setPayer: (s: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}
export function ExpenseForm(p: ExpenseFormProps) {
  return (
    <>
      <h1>{p.selected ? "立替を編集" : "立替を登録"}</h1>
      <form onSubmit={p.onSubmit}>
        <fieldset>
          <legend>支払った人</legend>
          <div className="segmented">
            {p.home.memberUids.map((id) => (
              <button
                type="button"
                key={id}
                className={p.payer === id ? "active" : ""}
                aria-pressed={p.payer === id}
                onClick={() => p.setPayer(id)}
              >
                {p.home.names[id]}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          件名
          <input
            required
            maxLength={120}
            placeholder="電気10月、オーケーなど"
            value={p.title}
            onChange={(e) => p.setTitle(e.target.value)}
          />
        </label>
        {p.last && (
          <aside>
            <small>前回の登録</small>
            <strong>
              {p.last.title}　{yen(p.last.amountYen)}
            </strong>
            <small>
              {p.last.occurredAt} · {p.home.names[p.last.payerUid]}
            </small>
          </aside>
        )}
        <label>
          金額（円）
          <input
            required
            type="number"
            inputMode="numeric"
            min="1"
            max="100000000"
            step="1"
            value={p.amount}
            onChange={(e) => p.setAmount(e.target.value)}
          />
        </label>
        <label>
          日付
          <input
            required
            type="date"
            value={p.date}
            onChange={(e) => p.setDate(e.target.value)}
          />
        </label>
        <button className="primary" disabled={p.busy}>
          {p.busy ? "保存中…" : p.selected ? "変更を保存" : "登録する"}
        </button>
      </form>
    </>
  );
}
